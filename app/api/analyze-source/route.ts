import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import type { ResearchData } from '@/types';
import { type TokenUsage, EMPTY_USAGE, claudeUsage, openaiUsage, geminiUsage } from '@/lib/usage';
import { checkBudgetLock, budgetLockMessage } from '@/lib/budgetGuard';

interface AiResult { text: string; usage: TokenUsage; }

// 일시적 오류(503 과부하 / 429 rate limit)면 지수 백오프로 재시도
async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      const transient = status === 503 || status === 429;
      if (!transient || i === retries - 1) throw e;
      const wait = 1500 * 2 ** i;  // 1.5s → 3s → 6s
      console.warn(`[analyze-source] ${label} ${status} 과부하 — ${wait}ms 후 재시도 (${i + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// 모델 과부하(503/429) 여부 판별 — 사용자에게 안내 메시지를 다르게 주기 위함
function isOverloadError(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return status === 503 || status === 429;
}

// 원작 텍스트에서 IP 분석 보고서 필드를 추출하는 프롬프트
const SYSTEM_PROMPT = `당신은 애니메이션 각색을 돕는 원작 IP 분석 전문가입니다. 사용자가 업로드한 원작 텍스트를 읽고, 원작 IP 분석 보고서에 필요한 정보를 추출하세요.

절대 규칙: 조회수·평점·리뷰 수·독자 반응 통계 등 수치 지표는 원작 텍스트에 존재하지 않으므로 절대 추정하거나 만들어내지 마세요. 해당 정보는 팀원이 플랫폼에서 직접 확인해 입력합니다.

반드시 아래 JSON 형식으로만 응답하세요. 원작 텍스트에서 파악되지 않는 항목은 빈 문자열("")로 두세요. JSON 외의 다른 설명은 붙이지 마세요.

\`\`\`json
{
  "originalTitle": "원작 제목",
  "overviewAuthor": "작가 (텍스트에서 확인되는 경우만)",
  "originalFormat": "원작 형식 (웹툰/웹소설/소설/만화 등)",
  "overviewGenreStatus": "장르 (텍스트 내용으로 판단)",
  "overviewPremise": "핵심 설정 한두 문장",
  "elementEvaluation": "작품 요소별 평가 — 세계관/캐릭터/몰입도/문장·연출 등을 강점·보통·보완으로 구분해 근거와 함께",
  "adaptationInsights": "애니메이션 각색 관점 시사점 — 텍스트에서 관찰한 신호와 그에 따른 각색 전략 제안",
  "fullPlot": "전체 줄거리를 문단으로 요약",
  "episodeSummaries": "회차/장별 주요 내용 요약",
  "mainCharacters": "주요 등장인물과 각각의 특징·외형",
  "characterRelations": "인물 간 관계",
  "keyEvents": "이야기의 핵심 사건 전개 순서",
  "mustKeep": "각색 시 반드시 유지해야 할 핵심 요소",
  "compressible": "축약해도 되는 구간",
  "removable": "삭제해도 되는 구간"
}
\`\`\``;

const USER_PREFIX = '아래 원작 텍스트를 분석해서 각색 리서치 정보를 JSON으로 추출해주세요:\n\n';

// 플랫폼 페이지 붙여넣기 분석 — 사용자가 복사해온 실제 페이지 텍스트에서만 추출 (수치 생성 금지)
const METRICS_PROMPT = `당신은 웹소설/웹툰 플랫폼 페이지에서 복사한 텍스트를 정리하는 분석가입니다. 사용자가 카카오페이지·문피아·리디 등의 작품 페이지나 댓글/리뷰 화면에서 복사해 붙여넣은 텍스트에서, 실제로 적혀 있는 정보만 추출하세요.

절대 규칙: 붙여넣은 텍스트에 없는 수치·평점·반응은 절대 만들어내지 마세요. 파악되지 않는 항목은 빈 문자열("")로 두세요.

반드시 아래 JSON 형식으로만 응답하세요. JSON 외의 다른 설명은 붙이지 마세요.

\`\`\`json
{
  "platforms": [
    { "platform": "플랫폼명 (예: 카카오페이지)", "views": "조회수 (텍스트에 있으면, 예: 4,120만)", "rating": "평점/별점 (텍스트에 있으면, 예: 9.8)" }
  ],
  "overviewPlatforms": "텍스트에서 확인되는 유통 플랫폼 (여러 개면 쉼표로)",
  "metricsInterpretation": "조회수·평점 등 지표가 입력에 있으면 그것이 기획에 시사하는 바를 반드시 한두 문장으로 해석 (지표가 하나도 없을 때만 빈 문자열)",
  "reactionPositive": "긍정 반응 키워드/요지 (댓글·리뷰 텍스트가 포함된 경우만)",
  "reactionNegative": "부정 반응 키워드/요지 (댓글·리뷰 텍스트가 포함된 경우만)",
  "sentiment": { "positive": 긍정 비율 정수, "negative": 부정 비율 정수, "neutral": 중립 비율 정수 },
  "audienceProfile": "독자층 추정과 그 근거 (텍스트에서 관찰되는 신호만)"
}
\`\`\`
platforms 배열은 텍스트에서 확인되는 플랫폼만 넣고, 조회수·평점이 없으면 해당 값은 빈 문자열("")로 두세요. 지표가 전혀 없으면 빈 배열([])로 두세요.
sentiment는 붙여넣은 댓글·리뷰의 전반적 정서를 긍정/부정/중립 백분율로 나눈 값입니다. 세 값의 합은 반드시 100이어야 합니다. 댓글·리뷰가 전혀 없어 판단이 불가능하면 sentiment는 null로 두세요.`;

const METRICS_USER_PREFIX = '아래는 플랫폼 페이지에서 복사한 텍스트입니다. 실제로 적혀 있는 지표와 독자 반응만 JSON으로 추출해주세요:\n\n';

// 작품명만으로 웹 검색해서 게재 플랫폼 + 개요(작가·형식·장르·핵심설정)를 찾는 프롬프트
const DISCOVER_PROMPT = `당신은 웹소설/웹툰 작품을 웹 검색으로 조사해주는 리서치 도우미입니다. 주어진 작품명으로 웹을 검색해서, 검색 결과에 실제로 나온 정보만 정리하세요.

절대 규칙: 검색 결과에 실제로 등장하지 않은 정보(플랫폼, URL, 작가, 줄거리 등)는 절대 만들어내지 마세요. 확신이 없으면 빈 문자열로 두세요. 조회수·평점·리뷰 반응 같은 수치는 이 기능의 대상이 아니니 채우지 마세요.

검색이 끝나면 반드시 아래 JSON 형식으로만 응답하세요. JSON 외의 다른 설명은 붙이지 마세요.

\`\`\`json
{
  "found": true 또는 false,
  "platforms": [
    { "platform": "플랫폼명 (예: 카카오페이지)", "url": "검색 결과에 실제로 나온 정확한 URL — 확실치 않으면 빈 문자열" }
  ],
  "fields": {
    "overviewAuthor": "작가 (검색으로 확인된 경우만)",
    "originalFormat": "원작 형식 (웹툰/웹소설/소설/만화 등)",
    "overviewGenreStatus": "장르 / 연재 상태 (예: 퓨전 판타지 / 완결 · 총 375화)",
    "overviewPlatforms": "유통 플랫폼 (텍스트로, 예: 카카오페이지, 문피아)",
    "overviewPremise": "핵심 설정 한두 문장 (검색 결과에 나온 소개·줄거리 요약 기반)"
  },
  "note": "찾은 경우 한 줄 요약, 못 찾은 경우 이유"
}
\`\`\`
platforms에는 이 작품이 게재된 것으로 검색에서 확인되는 플랫폼을 모두 넣으세요. URL을 정확히 못 찾은 플랫폼도 platform명은 넣고 url만 빈 문자열("")로 두면 됩니다 (지어낸 URL은 금지).`;

type ModelId = 'gemini' | 'claude-haiku' | 'claude-sonnet' | 'claude-fable' | 'gpt-4o-mini' | 'gpt-4o' | 'gpt-4.5' | 'gpt-5.6-sol' | 'gpt-5.6-luna' | 'gpt-5.6-terra';
type AnalyzeMode = 'source' | 'metrics' | 'discover';

interface Prompts { system: string; userPrefix: string; }

// 원작명으로 웹을 검색해서 게재 플랫폼·링크와 개요 필드를 찾음 (Claude web_search 도구, $0.01/회 + 토큰)
async function callClaudeDiscover(title: string): Promise<AiResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: DISCOVER_PROMPT,
    // Haiku는 동적 필터링(코드 실행 기반 호출)을 지원 안 해서 direct 호출로 강제
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3, allowed_callers: ['direct'] } as any],
    // 검색 여부를 모델 판단에 맡기면 가끔 검색을 건너뛰므로, 이 기능은 항상 검색하도록 강제
    tool_choice: { type: 'tool', name: 'web_search' },
    messages: [{ role: 'user', content: `"${title}"를 검색해서 게재 플랫폼과 작품 개요(작가·형식·장르·핵심설정)를 알려주세요.` }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const usage = claudeUsage(response.usage);
  usage.webSearches = (response.usage as any)?.server_tool_use?.web_search_requests ?? 0;
  return { text, usage };
}

async function callGemini(text: string, p: Prompts): Promise<AiResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: p.system,
  });
  const result = await model.generateContent(p.userPrefix + text);
  return { text: result.response.text(), usage: geminiUsage(result.response.usageMetadata) };
}

// ── PDF 네이티브 분석 (텍스트 추출 없이 모델에 PDF를 직접 전달) ──
async function callGeminiPdf(pdfBase64: string, p: Prompts): Promise<AiResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: p.system,
    // JSON 모드로 강제 + 출력 토큰 상향 — 소설 분량 분석 시 JSON이 잘려 파싱 실패하는 것 방지
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 16384 },
  });
  const result = await model.generateContent([
    { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
    { text: p.userPrefix },
  ]);
  const r = result.response;
  const finish = r.candidates?.[0]?.finishReason;
  if (finish && finish !== 'STOP') console.warn('[analyze-source] Gemini PDF finishReason:', finish);
  return { text: r.text(), usage: geminiUsage(r.usageMetadata) };
}

async function callClaudePdf(pdfBase64: string, modelId: string, p: Prompts): Promise<AiResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 16384,  // 소설 분량 분석 시 JSON이 잘리지 않도록 상향
    system: p.system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: p.userPrefix },
        ],
      },
    ],
  });
  if (response.stop_reason === 'max_tokens') console.warn('[analyze-source] Claude PDF hit max_tokens — 출력 잘림 가능');
  const block = response.content.find((b) => b.type === 'text');
  return { text: block?.type === 'text' ? block.text : '', usage: claudeUsage(response.usage) };
}

async function callClaude(text: string, modelId: string, p: Prompts): Promise<AiResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    system: p.system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: p.userPrefix },
          // 원작 텍스트에 프롬프트 캐싱 적용 — 같은 원작으로 이어서 질문하면 재사용되어 저렴
          { type: 'text', text, cache_control: { type: 'ephemeral' } },
        ],
      },
    ],
  });
  const out = response.content[0].type === 'text' ? response.content[0].text : '';
  return { text: out, usage: claudeUsage(response.usage) };
}

async function callOpenAI(text: string, modelId: string, p: Prompts): Promise<AiResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: p.system },
      { role: 'user', content: p.userPrefix + text },
    ],
  });
  return { text: response.choices[0].message.content ?? '', usage: openaiUsage(response.usage) };
}

// Claude 모델 별칭 → 실제 모델 ID
function resolveClaudeModel(model: ModelId): string {
  switch (model) {
    case 'claude-sonnet': return 'claude-sonnet-4-5';
    case 'claude-fable':  return 'claude-fable-5';
    default:              return 'claude-haiku-4-5-20251001';
  }
}

export async function POST(req: NextRequest) {
  try {
    const { text, pdfBase64, model = 'gemini', mode = 'source' }: { text?: string; pdfBase64?: string; fileName?: string; model?: ModelId; mode?: AnalyzeMode } = await req.json();

    if (!pdfBase64 && (!text || !text.trim())) {
      return NextResponse.json({ error: '분석할 내용이 비어 있습니다.' }, { status: 400 });
    }

    // 자동 조사는 항상 Claude Haiku + 웹 검색을 씀 (모델 선택 드롭다운과 무관)
    const lockModel: ModelId = mode === 'discover' ? 'claude-haiku' : model;
    const lock = await checkBudgetLock(lockModel);
    if (lock?.locked) {
      return NextResponse.json({ error: budgetLockMessage(lock) }, { status: 402 });
    }

    if (mode === 'discover') {
      const result = await withRetry(() => callClaudeDiscover(text!), 'Claude Discover');
      const jsonMatch = result.text.match(/```json\s*([\s\S]*?)\s*```/) ?? result.text.match(/\{[\s\S]*\}/);
      let discover: {
        found: boolean;
        platforms: { platform: string; url: string }[];
        fields: Partial<ResearchData>;
        note: string;
      } = { found: false, platforms: [], fields: {}, note: '결과를 파싱하지 못했어요.' };
      if (jsonMatch) {
        try { discover = JSON.parse(jsonMatch[1] ?? jsonMatch[0]); } catch {}
      }
      const filledCount = Object.values(discover.fields ?? {}).filter(Boolean).length;
      console.log(`[discover] title="${text}" found=${discover.found} platforms=${discover.platforms?.length ?? 0} 채운필드=${filledCount}. 원본 앞 400자:\n`, result.text.slice(0, 400));
      // 자동 조사는 항상 Claude Haiku를 사용 — 사용량이 정확한 모델로 기록되도록 usedModel 반환
      return NextResponse.json({ discover, usage: result.usage, usedModel: 'claude-haiku' });
    }

    const p: Prompts = mode === 'metrics'
      ? { system: METRICS_PROMPT, userPrefix: METRICS_USER_PREFIX }
      : { system: SYSTEM_PROMPT, userPrefix: USER_PREFIX };

    let result: AiResult = { text: '', usage: EMPTY_USAGE };
    const usedModel: ModelId = model;  // 실제 사용한 모델 — 사용량 기록 정확도용
    if (pdfBase64) {
      // PDF는 네이티브 지원 모델로만 처리 — Claude 선택 시 Claude, 그 외(Gemini/OpenAI)는 Gemini로
      // 과부하(503)여도 모델을 임의로 바꾸지 않음 — 재시도 후 실패 시 사용자에게 안내(아래 catch)
      result = model.startsWith('claude')
        ? await withRetry(() => callClaudePdf(pdfBase64, resolveClaudeModel(model), p), 'Claude PDF')
        : await withRetry(() => callGeminiPdf(pdfBase64, p), 'Gemini PDF');
    } else {
      const t = text!;
      switch (model) {
        case 'gemini':        result = await callGemini(t, p); break;
        case 'claude-haiku':  result = await callClaude(t, 'claude-haiku-4-5-20251001', p); break;
        case 'claude-sonnet': result = await callClaude(t, 'claude-sonnet-4-5', p); break;
        case 'claude-fable':  result = await callClaude(t, 'claude-fable-5', p); break;
        case 'gpt-4o-mini':   result = await callOpenAI(t, 'gpt-4o-mini', p); break;
        case 'gpt-4o':        result = await callOpenAI(t, 'gpt-4o', p); break;
        case 'gpt-4.5':       result = await callOpenAI(t, 'gpt-4.5-preview', p); break;
        case 'gpt-5.6-sol':   result = await callOpenAI(t, 'gpt-5.6-sol', p); break;
        case 'gpt-5.6-luna':  result = await callOpenAI(t, 'gpt-5.6-luna', p); break;
        case 'gpt-5.6-terra': result = await callOpenAI(t, 'gpt-5.6-terra', p); break;
        default:              result = await callGemini(t, p);
      }
    }

    // JSON 블록 추출 (코드펜스 → 순수 JSON 순으로 시도)
    const jsonMatch = result.text.match(/```json\s*([\s\S]*?)\s*```/) ?? result.text.match(/\{[\s\S]*\}/);
    let extracted: Partial<ResearchData> = {};
    let parseError = false;
    if (jsonMatch) {
      try {
        extracted = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
      } catch {
        parseError = true;
      }
    }

    // 아무것도 못 뽑았으면 원인 진단을 위해 모델 원본 출력을 로그로 남김
    if (Object.keys(extracted).length === 0) {
      console.warn(
        `[analyze-source] 추출 0개 (model=${model}, pdf=${!!pdfBase64}, jsonMatch=${!!jsonMatch}, parseError=${parseError}). 출력 길이=${result.text.length}, 앞 500자:\n`,
        result.text.slice(0, 500),
      );
    }

    return NextResponse.json({ extracted, usage: result.usage, usedModel });
  } catch (e) {
    console.error('원작 분석 실패:', e);
    // 모델 과부하(503/429)는 재시도해도 실패한 경우 — 사용자에게 "잠시 후/다른 모델" 안내
    if (isOverloadError(e)) {
      return NextResponse.json(
        { error: '지금 AI 모델이 혼잡해서 분석에 실패했어요. 잠시 후 다시 시도하거나, 모델 선택에서 다른 모델로 바꿔보세요.' },
        { status: 503 },
      );
    }
    // Claude API는 PDF를 100페이지까지만 받는다 — 사용자가 원인을 알 수 있도록 구체적으로 안내
    const message = (e as { message?: string })?.message ?? '';
    if (message.includes('PDF pages')) {
      return NextResponse.json(
        { error: 'Claude는 PDF를 100페이지까지만 분석할 수 있어요. Gemini로 바꾸거나, 파일을 100페이지 이하로 나눠서 업로드해주세요.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: '분석 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
