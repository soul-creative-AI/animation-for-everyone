import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import type { Message, PlanningData, ResearchData, OriginalArchive } from '@/types';
import { type TokenUsage, EMPTY_USAGE, claudeUsage, openaiUsage, geminiUsage } from '@/lib/usage';
import { checkBudgetLock, budgetLockMessage } from '@/lib/budgetGuard';

interface AiResult { text: string; usage: TokenUsage; }

const PLANNING_SYSTEM_PROMPT = `당신은 애니메이션 기획 전문가 PD입니다. 사용자가 애니메이션 아이디어를 구체화할 수 있도록 대화를 통해 도와주세요.

대화 규칙:
- 한 번에 하나씩만 질문하세요
- 친근하고 따뜻한 말투로 대화하세요
- 사용자의 답변을 바탕으로 자연스럽게 이어가세요
- 아이디어가 구체화될수록 더 깊은 질문을 하세요

정보 추출 규칙:
- 대화 중 파악된 정보가 있으면 반드시 응답 마지막에 아래 형식으로 추가하세요
- 파악된 정보가 없으면 JSON 블록을 포함하지 마세요

\`\`\`json
{
  "title": "제목 (파악된 경우)",
  "workType": "original | adaptation | series | feature | undecided 중 하나",
  "genre": "장르",
  "tone": "톤/분위기",
  "logline": "한줄 소개",
  "theme": "주제",
  "synopsis": "시놉시스",
  "visualStyle": "비주얼 스타일 (예: 2D 감성, 수채화풍)",
  "targetAudience": "파악된 정보만 자유롭게 서술 (예: 15~24세 중심, 판타지 액션 선호 시청자)",
  "episodeCount": "회차 수",
  "runtime": "러닝타임",
  "protagonist": "주인공",
  "keyCharacters": "주요 등장인물"
}
\`\`\`

workType 값 기준: original=오리지널, adaptation=원작 각색, series=시리즈물, feature=장편(극장판), undecided=미정
targetAudience는 파악된 정보만 포함하고, 모르는 부분은 빈 문자열("")로 두세요.
나머지 파악되지 않은 항목도 빈 문자열("")로 두세요.`;

const RESEARCH_SYSTEM_PROMPT = `당신은 애니메이션 원작 IP 분석을 돕는 리서치 전문가입니다. 사용자와 대화하며 원작 IP 분석 보고서에 필요한 정보를 채워나가세요.

대화 규칙:
- 절대로 "~을 조사했습니다", "~를 분석했습니다" 같은 완료형 문장으로 대화를 끝내지 마세요. 응답은 항상 다음 단계로 이어지는 질문이나 구체적인 제안으로 끝내야 합니다.
- 한 번에 하나씩만 질문하세요.
- 대화 맨 처음 "오리지널인지 각색인지" 답변을 참고해서 이후 흐름을 다르게 가져가세요:
  - 각색이라면: 사용자가 원작 제목을 말하거나 "○○ 리서치해줘 / 조사해줘 / 찾아줘 / 알아봐줘"처럼 특정 원작을 조사해달라고 하면, 줄거리·형식·장르를 사용자에게 되묻지 마세요. 그 작품명을 originalTitle에 넣고 needsAutoDiscover를 "yes"로 설정하세요. 그러면 시스템이 곧바로 웹 검색으로 게재처·작가·개요·줄거리 등을 자동 조사해 채웁니다. 답변 텍스트에는 "「○○」을(를) 웹에서 찾아 채워볼게요"처럼 지금 조사를 시작한다고만 짧게 알리세요(완료형·이미 채웠다는 표현 금지 — 실제 조사는 이 뒤에 시스템이 합니다). 원작 파일이 있으면 첨부하면 더 정확하다고 덧붙일 수 있습니다.
  - 오리지널이라면: 장르, 핵심 설정, 타깃 시청자, 유사 작품과의 차별점을 순서대로 물어보세요.
- 조회수·평점·리뷰 반응 같은 수치·통계 데이터는 절대 만들어내지 마세요. 그런 정보가 필요하면 화면의 "플랫폼 데이터 가져오기 도우미"를 이용해 직접 확인해달라고 안내만 하세요.
- 친근하고 따뜻한 말투로 대화하세요.
- 사용자가 특정 필드를 수정해달라고 요청하면(예: "기획 반영 포인트를 더 구체적으로 해줄래?"), 요청을 반영해 해당 필드만 JSON으로 반환하세요. 일반적인 대화는 하지 말고 수정된 JSON 필드만 응답하세요.

정보 추출 규칙:
- 대화 중 파악된 정보가 있으면 반드시 응답 마지막에 아래 형식으로 추가하세요
- 파악된 정보가 없으면 JSON 블록을 포함하지 마세요
- 아래 목록에 없는 항목(플랫폼 지표, 독자 반응, 독자층 프로파일)은 절대 채우지 마세요 — 사용자가 직접 입력하는 영역입니다

\`\`\`json
{
  "similarWorks": "유사 작품/경쟁작",
  "genreTrends": "장르 트렌드",
  "differentiation": "차별화 가능성",
  "planningPoints": "기획 반영 포인트",
  "originalTitle": "원작명 (각색인 경우)",
  "needsAutoDiscover": "특정 원작을 방금 지목해 웹 자동조사가 필요하면 \"yes\", 아니면 \"\"",
  "overviewAuthor": "작가",
  "originalFormat": "원작 형식 (웹툰/웹소설/소설 등)",
  "overviewGenreStatus": "장르 / 연재 상태",
  "overviewPlatforms": "유통 플랫폼",
  "overviewPremise": "핵심 설정",
  "elementEvaluation": "작품 요소/평가/근거요지",
  "adaptationInsights": "각색 관점 시사점",
  "fullPlot": "전체 줄거리",
  "episodeSummaries": "회차별 요약",
  "mainCharacters": "주요 캐릭터",
  "characterRelations": "인물 관계",
  "keyEvents": "주요 사건",
  "mustKeep": "반드시 유지할 요소",
  "compressible": "축약 가능한 구간",
  "removable": "삭제 가능한 구간"
}
\`\`\`

파악되지 않은 항목은 빈 문자열("")로 두세요.`;

const ARCHIVE_QA_SYSTEM_PROMPT = `당신은 정리된 원작 아카이브(권/화별 요약)를 근거로 사용자의 질문에 답하는 도우미입니다. 사용자는 "○○가 각성하는 장면 몇 화야?", "△△가 처음 등장하는 화는?", "마계 침공은 어느 권에서 나와?"처럼 특정 장면·인물·사건이 몇 권 몇 화에 있는지 묻습니다.

답변 규칙:
- 반드시 아래에 제공되는 [원작 권/화별 요약 인덱스]에서만 근거를 찾으세요. 인덱스에 없는 내용은 절대 지어내지 마세요.
- 찾으면 "N권 M화"를 명확히 밝히고, 그 근거가 된 요약을 한두 문장으로 함께 알려주세요. 관련된 화가 여러 개면 모두 나열하세요.
- 인덱스에서 찾지 못하면 "정리된 아카이브에서는 해당 장면을 찾지 못했어요"라고 솔직히 답하고, 검색어를 바꾸거나 원문을 더 올려보라고 안내하세요.
- 친근하고 간결하게 답하세요. JSON이나 코드 블록은 쓰지 마세요.`;

type ModelId = 'gemini' | 'claude-haiku' | 'claude-sonnet' | 'claude-fable' | 'gpt-4o-mini' | 'gpt-4o' | 'gpt-4.5' | 'gpt-5.6-sol' | 'gpt-5.6-luna' | 'gpt-5.6-terra';
type ChatContext = 'planning' | 'research' | 'archive';

async function callGemini(messages: Message[], systemPrompt: string): Promise<AiResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: systemPrompt,
  });

  const allButLast = messages.slice(0, -1);
  const firstUserIdx = allButLast.findIndex((m) => m.role === 'user');
  const trimmed = firstUserIdx === -1 ? [] : allButLast.slice(firstUserIdx);
  const history = trimmed.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(messages[messages.length - 1].content);
  return { text: result.response.text(), usage: geminiUsage(result.response.usageMetadata) };
}

async function callClaude(messages: Message[], modelId: string, systemPrompt: string): Promise<AiResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  });
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return { text, usage: claudeUsage(response.usage) };
}

async function callOpenAI(messages: Message[], modelId: string, systemPrompt: string): Promise<AiResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      })),
    ],
  });
  return { text: response.choices[0].message.content ?? '', usage: openaiUsage(response.usage) };
}

// planning/research 상태 객체에서 채워진 필드만 뽑아 "현재까지 파악된 정보" 텍스트로 정리
function summarizeContext(data?: Record<string, unknown>): string {
  if (!data) return '';
  const lines = Object.entries(data)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => `- ${k}: ${v}`);
  return lines.join('\n');
}

// 원작 아카이브(권/화별 요약)를 "몇 권 몇 화" 질문에 답할 수 있는 인덱스 텍스트로 정리
function summarizeArchive(archive?: OriginalArchive): string {
  if (!archive?.volumes?.length) return '';
  const lines: string[] = [];
  for (const v of archive.volumes) {
    const vLabel = `${v.number || '?'}권${v.title ? ` (${v.title})` : ''}`;
    for (const c of v.chapters ?? []) {
      if (!c.summary?.trim() && !c.title?.trim()) continue;
      const parts = [`${vLabel} ${c.number || '?'}화${c.title ? ` 「${c.title}」` : ''}`];
      if (c.summary?.trim()) parts.push(c.summary.trim());
      const meta: string[] = [];
      if (c.characters?.trim()) meta.push(`등장인물: ${c.characters.trim()}`);
      if (c.sceneTags?.trim()) meta.push(`장면: ${c.sceneTags.trim()}`);
      if (meta.length) parts.push(`(${meta.join(' / ')})`);
      lines.push(parts.join(' — '));
    }
  }
  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const {
      messages, model = 'gemini', context = 'planning', planningData, researchData, archiveData,
    }: {
      messages: Message[]; model?: ModelId; context?: ChatContext;
      planningData?: Partial<PlanningData>; researchData?: Partial<ResearchData>;
      archiveData?: OriginalArchive;
    } = await req.json();

    const lock = await checkBudgetLock(model);
    if (lock?.locked) {
      return NextResponse.json({ error: budgetLockMessage(lock) }, { status: 402 });
    }

    // 아카이브 탭: 권/화 인덱스만 근거로 "몇 권 몇 화" 질문에 답하는 전용 컨텍스트
    let systemPrompt: string;
    if (context === 'archive') {
      const archiveCtx = summarizeArchive(archiveData);
      const indexBlock = archiveCtx
        ? `\n\n[원작 권/화별 요약 인덱스]\n${archiveCtx}`
        : '\n\n[원작 권/화별 요약 인덱스]\n(아직 정리된 아카이브가 없습니다. 원문을 올려 화별로 정리하면 답할 수 있다고 안내하세요.)';
      systemPrompt = ARCHIVE_QA_SYSTEM_PROMPT + indexBlock;
    } else {
      // 기획 탭은 리서치+기획 데이터를, 리서치 탭은 리서치 데이터를 근거로 답하도록 컨텍스트 주입
      const planningCtx = summarizeContext(planningData);
      const researchCtx = summarizeContext(researchData);
      let contextBlock = '';
      if (context === 'planning') {
        if (researchCtx) contextBlock += `\n\n[리서치에서 파악된 정보]\n${researchCtx}`;
        if (planningCtx) contextBlock += `\n\n[현재까지 채워진 기획 정보]\n${planningCtx}`;
      } else {
        if (researchCtx) contextBlock += `\n\n[현재까지 채워진 리서치 정보]\n${researchCtx}`;
      }
      if (contextBlock) {
        contextBlock = `\n\n아래는 이 작품에 대해 이미 파악된 정보입니다. 추천·제안을 할 때 이 정보에 맞게 구체적으로 답하세요 (일반론 금지).${contextBlock}`;
      }

      // 원작 아카이브가 있으면 "몇 화/몇 권" 질문에 근거로 쓰도록 인덱스를 주입 (리서치 탭 한정)
      if (context === 'research') {
        const archiveCtx = summarizeArchive(archiveData);
        if (archiveCtx) {
          contextBlock += `\n\n[원작 권/화별 요약 인덱스]\n사용자가 "~한 장면 몇 화야?", "○○가 나오는 화는?"처럼 물으면 아래 인덱스에서 찾아 "N권 M화"로 정확히 답하세요. 인덱스에 없으면 모른다고 하세요.\n${archiveCtx}`;
        }
      }

      systemPrompt = (context === 'research' ? RESEARCH_SYSTEM_PROMPT : PLANNING_SYSTEM_PROMPT) + contextBlock;
    }

    let result: AiResult = { text: '', usage: EMPTY_USAGE };

    switch (model) {
      case 'gemini':        result = await callGemini(messages, systemPrompt); break;
      case 'claude-haiku':  result = await callClaude(messages, 'claude-haiku-4-5-20251001', systemPrompt); break;
      case 'claude-sonnet': result = await callClaude(messages, 'claude-sonnet-4-5', systemPrompt); break;
      case 'claude-fable':  result = await callClaude(messages, 'claude-fable-5', systemPrompt); break;
      case 'gpt-4o-mini':   result = await callOpenAI(messages, 'gpt-4o-mini', systemPrompt); break;
      case 'gpt-4o':        result = await callOpenAI(messages, 'gpt-4o', systemPrompt); break;
      case 'gpt-4.5':       result = await callOpenAI(messages, 'gpt-4.5-preview', systemPrompt); break;
      case 'gpt-5.6-sol':   result = await callOpenAI(messages, 'gpt-5.6-sol', systemPrompt); break;
      case 'gpt-5.6-luna':  result = await callOpenAI(messages, 'gpt-5.6-luna', systemPrompt); break;
      case 'gpt-5.6-terra': result = await callOpenAI(messages, 'gpt-5.6-terra', systemPrompt); break;
      default:              result = await callGemini(messages, systemPrompt);
    }

    const { text, usage } = result;

    // JSON 블록 추출
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    let extracted: Partial<PlanningData> | Partial<ResearchData> = {};
    let cleanText = text;

    if (jsonMatch) {
      try {
        extracted = JSON.parse(jsonMatch[1]);
        cleanText = text.replace(/```json\n[\s\S]*?\n```/, '').trim();
      } catch {}
    }

    // 리서치 탭에서 "○○ 리서치해줘"처럼 특정 원작 자동조사를 요청받으면,
    // 클라이언트가 이어서 웹 검색(discover)을 실행하도록 action을 내려준다.
    // needsAutoDiscover는 보고서 필드가 아니므로 extracted에서 제거한다.
    let action: { type: 'discover'; title: string } | null = null;
    if (context === 'research') {
      const ex = extracted as Record<string, unknown>;
      const title = typeof ex.originalTitle === 'string' ? ex.originalTitle.trim() : '';
      if (ex.needsAutoDiscover === 'yes' && title) {
        action = { type: 'discover', title };
      }
      delete ex.needsAutoDiscover;
    }

    return NextResponse.json({ text: cleanText, extracted, usage, action });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '오류가 발생했습니다.' }, { status: 500 });
  }
}
