import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import type { ResearchData } from '@/types';
import { type TokenUsage, EMPTY_USAGE, claudeUsage, openaiUsage, geminiUsage, openaiResponsesUsage } from '@/lib/usage';
import { checkBudgetLock, budgetLockMessage } from '@/lib/budgetGuard';
import { PROVIDER_OF_MODEL } from '@/lib/budgets';

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

// 원작 아카이브: 한 화(챕터) 원문 → 요약·등장인물·핵심장면 태그 추출
const CHAPTER_PROMPT = `당신은 원작 소설/웹툰의 한 화(챕터) 원문을 읽고 아카이브용으로 정리하는 분석가입니다. 주어진 텍스트가 담고 있는 내용만 근거로, 아래 JSON을 채우세요.

절대 규칙: 텍스트에 없는 내용을 지어내지 마세요. 파악되지 않는 항목은 빈 문자열("")로 두세요. JSON 외의 다른 설명은 붙이지 마세요.

\`\`\`json
{
  "title": "이 화의 제목 (원문에 있으면 그대로, 없으면 내용을 대표하는 짧은 제목)",
  "summary": "이 화에서 일어난 일을 3~5문장으로 요약",
  "characters": "이 화에 등장하는 주요 인물 이름들 (쉼표로 구분)",
  "sceneTags": "기억할 만한 핵심 장면을 짧은 키워드 태그로 (쉼표로 구분, 예: 첫 각성, 마계 침공, 스승과의 재회)"
}
\`\`\``;

const CHAPTER_USER_PREFIX = '아래는 원작의 한 화 원문입니다. 요약·등장인물·핵심장면 태그를 JSON으로 추출해주세요:\n\n';

// 원작 아카이브: 한 권 분량 원문 → 화(챕터) 목록으로 자동 분할 + 각 화 요약
const ARCHIVE_SPLIT_PROMPT = `당신은 원작 소설/웹툰 한 권 분량의 원문을 읽고, 화(챕터) 단위로 나눠 아카이브로 정리하는 분석가입니다.

규칙:
- 원문에 화/챕터 구분(예: "1화", "제1장", "Chapter 1")이 있으면 그 구분을 그대로 따르세요.
- 명확한 구분이 없으면 내용 흐름상 자연스러운 단위로 나누세요 (너무 잘게 쪼개지 말 것).
- 원문에 없는 내용은 절대 지어내지 마세요. 파악되지 않는 항목은 빈 문자열("")로 두세요.

반드시 아래 JSON 형식으로만 응답하세요. JSON 외의 다른 설명은 붙이지 마세요.

\`\`\`json
{
  "volumeSummary": "이 권(한 권 분량) 전체를 아우르는 요약을 4~6문장으로. 이 권에서 벌어지는 큰 흐름·주요 사건·이 권이 끝날 때의 상황을 담되, 없는 내용은 지어내지 마세요.",
  "chapters": [
    {
      "number": "화 번호 (예: 1)",
      "title": "이 화의 제목 (원문에 있으면 그대로, 없으면 내용을 대표하는 짧은 제목)",
      "summary": "이 화에서 일어난 일을 3~5문장으로 요약",
      "characters": "이 화에 등장하는 주요 인물 (쉼표로 구분)",
      "sceneTags": "핵심 장면을 짧은 키워드 태그로 (쉼표로 구분)"
    }
  ]
}
\`\`\``;

const ARCHIVE_SPLIT_USER_PREFIX = '아래는 원작 한 권 분량의 원문입니다. 화(챕터) 단위로 나눠 각 화의 번호·제목·요약·등장인물·핵심장면을 JSON으로 정리해주세요:\n\n';

// 업로드 문서(기획서/리서치 자료/예전에 내보낸 파일) → 기획·리서치 필드 통합 추출 프롬프트
const DOC_IMPORT_PROMPT = `당신은 애니메이션 기획·리서치 자료를 읽고 정보를 정리하는 전문가입니다. 사용자가 업로드한 문서(기획서, 리서치 자료, 또는 이 앱에서 예전에 내보낸 파일 등)에서 실제로 적혀 있는 정보만 추출해, 기획 항목과 리서치 항목으로 나눠 채우세요.

절대 규칙:
- 문서에 없는 내용을 지어내지 마세요. 파악되지 않는 항목은 빈 문자열("")로 두세요.
- 조회수·평점·리뷰 수 같은 수치나 독자 감정 비율은 이 기능에서 채우지 마세요.
- 반드시 아래 JSON 형식으로만 응답하고, JSON 외의 다른 설명은 붙이지 마세요.

\`\`\`json
{
  "planning": {
    "title": "작품 제목",
    "workType": "다음 중 하나만: undecided | original | adaptation | series | feature (오리지널→original, 원작 각색·웹툰/소설 원작→adaptation, TV/OTT 시리즈→series, 극장판·장편→feature, 판단 불가→undecided)",
    "genre": "장르",
    "tone": "톤/분위기",
    "logline": "로그라인 (한두 문장)",
    "theme": "주제",
    "synopsis": "시놉시스",
    "visualStyle": "비주얼 스타일 (그림체·색감·연출 방향 등)",
    "targetAudience": "타깃 시청자",
    "episodeCount": "회차 수 (예: 12부작)",
    "runtime": "러닝타임 (예: 회당 24분)",
    "protagonist": "주인공 소개",
    "keyCharacters": "주요 등장인물과 각각의 특징"
  },
  "research": {
    "originalTitle": "원작 제목",
    "overviewAuthor": "작가",
    "originalFormat": "원작 형식 (웹툰/웹소설/소설/만화 등)",
    "overviewGenreStatus": "장르 / 연재 상태",
    "overviewPlatforms": "유통 플랫폼",
    "overviewPremise": "핵심 설정",
    "metricsInterpretation": "지표 해석 (기획 관점, 문서에 있으면)",
    "reactionPositive": "긍정 반응 키워드/요지",
    "reactionNegative": "부정 반응 키워드/요지",
    "audienceProfile": "독자층 프로파일",
    "elementEvaluation": "작품 요소별 평가",
    "adaptationInsights": "애니메이션 각색 관점 시사점",
    "similarWorks": "유사 작품/경쟁작",
    "genreTrends": "장르 트렌드",
    "differentiation": "차별화 포인트",
    "planningPoints": "기획 반영 포인트",
    "fullPlot": "전체 줄거리 요약",
    "episodeSummaries": "회차/장별 요약",
    "mainCharacters": "주요 등장인물과 특징",
    "characterRelations": "인물 간 관계",
    "keyEvents": "핵심 사건 전개",
    "mustKeep": "각색 시 유지할 요소",
    "compressible": "축약 가능 구간",
    "removable": "삭제 가능 구간"
  }
}
\`\`\`
문서가 기획 정보만 담고 있으면 research는 대부분 빈 문자열이 되고, 리서치 자료만 담고 있으면 planning이 대부분 빈 문자열이 됩니다 — 그래도 됩니다. 각 항목은 문서에 실제로 있는 내용만 채우세요.`;

const DOC_IMPORT_USER_PREFIX = '아래는 사용자가 업로드한 기획·리서치 문서입니다. 기획 항목과 리서치 항목을 JSON으로 추출해주세요:\n\n';

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
    "overviewPremise": "핵심 설정 한두 문장 (검색 결과에 나온 소개·줄거리 요약 기반)",
    "fullPlot": "전체 줄거리 요약 (검색 결과의 소개·시놉시스에서 확인되는 범위로 한 문단)",
    "mainCharacters": "주요 등장인물과 특징 (검색으로 확인되는 경우만, 한 줄씩)",
    "similarWorks": "유사 작품/경쟁작 — 반드시 실제로 존재하는 구체적인 작품 제목을 2개 이상 「」로 감싸 나열하고, 각 작품이 왜 유사한지(같은 소재·설정·타깃 등) 한 줄 근거를 붙이세요. 예: 「나 혼자만 레벨업」 — 약자가 각성해 성장하는 헌터물 / 「전지적 독자 시점」 — 원작 지식으로 위기를 돌파하는 구조. 실존하지 않는 작품명은 절대 지어내지 마세요.",
    "genreTrends": "장르 트렌드 (이 작품이 속한 장르·소재의 시장 흐름)",
    "differentiation": "차별화 포인트 (이 작품이 유사작 대비 내세우는 지점)"
  },
  "similarWorksList": [
    { "title": "실존하는 유사 작품 제목 (「」 없이 제목만)", "reason": "왜 유사한지 한 줄 (같은 소재·설정·타깃 등)" }
  ],
  "note": "찾은 경우 한 줄 요약, 못 찾은 경우 이유"
}
\`\`\`
platforms에는 이 작품이 게재된 것으로 검색에서 확인되는 플랫폼을 모두 넣으세요. URL을 정확히 못 찾은 플랫폼도 platform명은 넣고 url만 빈 문자열("")로 두면 됩니다 (지어낸 URL은 금지).
fullPlot·mainCharacters는 검색 결과에 실제로 나온 소개·줄거리·인물 정보 범위에서만 채우고, 확인되지 않으면 빈 문자열("")로 두세요. similarWorks·genreTrends·differentiation은 장르 지식과 검색 결과에 근거해 신중히 판단해 채우되, 억지로 지어내지 마세요. 조회수·평점·리뷰 수 등 수치는 여기서 절대 채우지 마세요.
similarWorksList에는 실존하는 유사 작품·경쟁작을 3~5개 넣으세요. 실존이 확실하지 않은 작품은 넣지 마세요. 못 찾으면 빈 배열([])로 두세요.`;

// 경쟁작 1개를 웹 검색으로 조사해 우리 작품 대비 분석하는 프롬프트
const COMPETITOR_PROMPT = `당신은 애니메이션 기획을 위한 경쟁작 분석가입니다. 주어진 경쟁작을 웹에서 검색해 조사하고, 함께 제공되는 "우리 작품 정보"와 비교해 분석하세요.

절대 규칙: 검색 결과와 장르 지식에 근거해 신중히 판단하되, 사실(성과·평가·반응)은 검색에서 확인된 범위에서만 쓰세요. 확신이 없는 항목은 빈 문자열("")로 두세요. 조회수·평점 같은 정확한 수치는 채우지 마세요.

검색이 끝나면 반드시 아래 JSON 형식으로만 응답하세요. JSON 외의 다른 설명은 붙이지 마세요.

\`\`\`json
{
  "found": true 또는 false,
  "summary": "이 작품 한 줄 요약 (무엇이고 어떤 위치의 작품인지)",
  "strengths": "장점 — 이 작품이 잘한 것, 독자·시청자에게 통한 지점 (한 줄씩)",
  "cliches": "클리셰 — 이 장르에서 반복되는 패턴 중 이 작품이 쓴 것들",
  "marketPosition": "시장 포지션 — 주 타깃층, 유통 플랫폼, 장르 내 위치·성과의 대략적 평가",
  "avoid": "피해야 할 것 — 이 작품이 받은 비판·한계·후반 처짐 등 우리가 반복하지 말아야 할 지점",
  "leverage": "활용 방안 — 우리 작품 기획에 참고해 가져올 만한 점 (우리 작품 정보에 맞게 구체적으로)",
  "differentiation": "차별화 방안 — 우리 작품이 이 작품과 다르게 가야 할 지점 (우리 작품 정보에 근거해 구체적으로)",
  "note": "찾은 경우 한 줄 메모, 못 찾은 경우 이유"
}
\`\`\`
leverage와 differentiation은 일반론이 아니라 반드시 "우리 작품 정보"의 설정·장르·방향에 비추어 구체적으로 쓰세요.`;

type ModelId = 'gemini' | 'claude-haiku' | 'claude-sonnet' | 'claude-fable' | 'gpt-4o-mini' | 'gpt-4o' | 'gpt-4.5' | 'gpt-5.6-sol' | 'gpt-5.6-luna' | 'gpt-5.6-terra';
type AnalyzeMode = 'source' | 'metrics' | 'discover' | 'chapter' | 'archive-split' | 'doc-import' | 'competitor';

interface Prompts { system: string; userPrefix: string; }

// 세 provider 모두 동일한 조사 요청 문구를 사용 (필드 목록은 DISCOVER_PROMPT의 JSON 스펙 참고)
function discoverQuery(title: string): string {
  return `"${title}"를 검색해서 게재 플랫폼과 작품 개요(작가·형식·장르·핵심설정), 전체 줄거리, 주요 캐릭터, 유사 작품·장르 트렌드·차별화 포인트를 알려주세요.`;
}

// 웹 검색으로 조사 — discover(원작 자동조사)와 competitor(경쟁작 분석)가 공용으로 사용
// (Claude web_search 도구, $0.01/회 + 토큰)
async function callClaudeSearch(query: string, modelId: string, system: string): Promise<AiResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 2048,
    system,
    // Haiku는 동적 필터링(코드 실행 기반 호출)을 지원 안 해서 direct 호출로 강제
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3, allowed_callers: ['direct'] } as any],
    // 검색 여부를 모델 판단에 맡기면 가끔 검색을 건너뛰므로, 이 기능은 항상 검색하도록 강제
    tool_choice: { type: 'tool', name: 'web_search' },
    messages: [{ role: 'user', content: query }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const usage = claudeUsage(response.usage);
  usage.webSearches = (response.usage as any)?.server_tool_use?.web_search_requests ?? 0;
  return { text, usage };
}

// Gemini의 구글 검색 그라운딩 도구로 조사 (Gemini Flash, 토큰 요금만 — 검색 자체는 별도 과금 없음)
// google_search — 구 googleSearchRetrieval 도구는 폐기됐고(gemini-3.5-flash가 400으로 거부),
// 설치된 SDK(@google/generative-ai 0.24.1) 타입 정의가 아직 신규 도구를 모르므로 as any로 우회
async function callGeminiSearch(query: string, modelId: string, system: string): Promise<AiResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: system,
    tools: [{ googleSearch: {} } as any],
  });
  const result = await model.generateContent(query);
  const r = result.response;
  const usage = geminiUsage(r.usageMetadata);
  // Claude처럼 검색 횟수 과금 API가 없어 실제 검색 수행 여부만 기록(로그·표시용, 비용엔 반영 안 됨)
  usage.webSearches = (r.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0) > 0 ? 1 : 0;
  return { text: r.text(), usage };
}

// OpenAI Responses API의 내장 웹 검색 도구로 조사 (Chat Completions API는 web_search 미지원)
async function callOpenAISearch(query: string, modelId: string, system: string): Promise<AiResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: modelId,
    instructions: system,
    input: query,
    tools: [{ type: 'web_search' }],
    // 검색을 건너뛰지 않도록 강제 (Claude와 동일한 이유)
    tool_choice: 'required',
  });
  const usage = openaiResponsesUsage(response.usage);
  usage.webSearches = response.output.filter((o) => o.type === 'web_search_call').length;
  return { text: response.output_text, usage };
}

// discover 모드는 비용 예측 가능성을 위해 provider별로 저렴한 고정 모델을 씀
// (사용자가 어떤 모델을 선택했든, 그 모델의 provider 안에서만 저비용 모델로 조사)
function resolveDiscoverModel(model: ModelId): { alias: ModelId; apiModel: string } {
  switch (PROVIDER_OF_MODEL[model]) {
    case 'gemini': return { alias: 'gemini',       apiModel: 'gemini-3.5-flash' };
    case 'openai': return { alias: 'gpt-4o-mini',  apiModel: 'gpt-4o-mini' };
    case 'claude':
    default:       return { alias: 'claude-haiku', apiModel: 'claude-haiku-4-5-20251001' };
  }
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

// ── 한 권 분량 텍스트 → 화 목록 분할 (출력 토큰 상향 — 화가 많으면 JSON이 길어짐) ──
async function callGeminiSplit(text: string, p: Prompts): Promise<AiResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: p.system,
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 32768 },
  });
  const r = (await model.generateContent(p.userPrefix + text)).response;
  const finish = r.candidates?.[0]?.finishReason;
  if (finish && finish !== 'STOP') console.warn('[analyze-source] Gemini Split finishReason:', finish);
  return { text: r.text(), usage: geminiUsage(r.usageMetadata) };
}

async function callClaudeSplit(text: string, modelId: string, p: Prompts): Promise<AiResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 16384,
    system: p.system,
    messages: [{ role: 'user', content: p.userPrefix + text }],
  });
  if (response.stop_reason === 'max_tokens') console.warn('[analyze-source] Claude Split hit max_tokens — 출력 잘림 가능');
  const block = response.content.find((b) => b.type === 'text');
  return { text: block?.type === 'text' ? block.text : '', usage: claudeUsage(response.usage) };
}

async function callOpenAISplit(text: string, modelId: string, p: Prompts): Promise<AiResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: modelId,
    max_tokens: 16384,
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
    const { text, pdfBase64, model = 'gemini', mode = 'source', context }: { text?: string; pdfBase64?: string; fileName?: string; model?: ModelId; mode?: AnalyzeMode; context?: string } = await req.json();

    if (!pdfBase64 && (!text || !text.trim())) {
      return NextResponse.json({ error: '분석할 내용이 비어 있습니다.' }, { status: 400 });
    }

    // 자동 조사·경쟁작 분석은 선택한 모델의 provider 안에서 저비용 고정 모델 + 웹 검색을 씀
    const discoverModel = (mode === 'discover' || mode === 'competitor') ? resolveDiscoverModel(model) : null;
    const lockModel: ModelId = discoverModel ? discoverModel.alias : model;
    const lock = await checkBudgetLock(lockModel);
    if (lock?.locked) {
      return NextResponse.json({ error: budgetLockMessage(lock) }, { status: 402 });
    }

    // 웹 검색 실행기 (discover/competitor 공용) — provider별 저비용 모델 사용
    async function runWebSearch(query: string, system: string, label: string): Promise<AiResult> {
      const provider = PROVIDER_OF_MODEL[discoverModel!.alias];
      return withRetry(() => {
        switch (provider) {
          case 'gemini': return callGeminiSearch(query, discoverModel!.apiModel, system);
          case 'openai': return callOpenAISearch(query, discoverModel!.apiModel, system);
          case 'claude':
          default:       return callClaudeSearch(query, discoverModel!.apiModel, system);
        }
      }, label);
    }

    // ── 경쟁작 분석: 경쟁작 1개를 웹 검색으로 조사해 우리 작품 대비 분석 ──
    if (mode === 'competitor' && discoverModel) {
      const query = [
        `경쟁작 「${text}」를 웹에서 검색해 조사하고, 아래 우리 작품 정보와 비교해 장점·클리셰·시장 포지션·피해야 할 것·활용 방안·차별화 방안을 분석해주세요.`,
        '',
        '[우리 작품 정보]',
        context?.trim() || '(아직 정리된 정보 없음 — 일반적인 장르 관점에서 분석)',
      ].join('\n');
      const result = await runWebSearch(query, COMPETITOR_PROMPT, `${PROVIDER_OF_MODEL[discoverModel.alias]} Competitor`);
      const jsonMatch = result.text.match(/```json\s*([\s\S]*?)\s*```/) ?? result.text.match(/\{[\s\S]*\}/);
      let competitor: Record<string, unknown> = { found: false, note: '결과를 파싱하지 못했어요.' };
      if (jsonMatch) {
        try { competitor = JSON.parse(jsonMatch[1] ?? jsonMatch[0]); } catch {}
      }
      console.log(`[competitor] title="${text}" found=${competitor.found}`);
      return NextResponse.json({ competitor, usage: result.usage, usedModel: discoverModel.alias });
    }

    if (mode === 'discover' && discoverModel) {
      const provider = PROVIDER_OF_MODEL[discoverModel.alias];
      const result = await runWebSearch(discoverQuery(text!), DISCOVER_PROMPT, `${provider} Discover`);
      const jsonMatch = result.text.match(/```json\s*([\s\S]*?)\s*```/) ?? result.text.match(/\{[\s\S]*\}/);
      let discover: {
        found: boolean;
        platforms: { platform: string; url: string }[];
        fields: Partial<ResearchData>;
        similarWorksList?: { title: string; reason?: string }[];
        note: string;
      } = { found: false, platforms: [], fields: {}, similarWorksList: [], note: '결과를 파싱하지 못했어요.' };
      if (jsonMatch) {
        try { discover = JSON.parse(jsonMatch[1] ?? jsonMatch[0]); } catch {}
      }
      const filledCount = Object.values(discover.fields ?? {}).filter(Boolean).length;
      console.log(`[discover] title="${text}" provider=${provider} found=${discover.found} platforms=${discover.platforms?.length ?? 0} 채운필드=${filledCount}. 원본 앞 400자:\n`, result.text.slice(0, 400));
      // 사용량이 실제 사용한 모델(별칭)로 정확히 기록되도록 usedModel 반환
      return NextResponse.json({ discover, usage: result.usage, usedModel: discoverModel.alias });
    }

    // 한 권 분량 원문 → 화 목록 자동 분할
    if (mode === 'archive-split') {
      const sp: Prompts = { system: ARCHIVE_SPLIT_PROMPT, userPrefix: ARCHIVE_SPLIT_USER_PREFIX };
      const splitResult: AiResult = pdfBase64
        ? (model.startsWith('claude')
            ? await withRetry(() => callClaudePdf(pdfBase64, resolveClaudeModel(model), sp), 'Claude Split PDF')
            : await withRetry(() => callGeminiPdf(pdfBase64, sp), 'Gemini Split PDF'))
        : (model.startsWith('claude')
            ? await callClaudeSplit(text!, resolveClaudeModel(model), sp)
            : model.startsWith('gpt')
              ? await callOpenAISplit(text!, model === 'gpt-4.5' ? 'gpt-4.5-preview' : model, sp)
              : await callGeminiSplit(text!, sp));
      const jsonMatch = splitResult.text.match(/```json\s*([\s\S]*?)\s*```/) ?? splitResult.text.match(/\{[\s\S]*\}/);
      let chapters: { number: string; title: string; summary: string; characters: string; sceneTags: string }[] = [];
      let volumeSummary = '';
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
          if (Array.isArray(parsed?.chapters)) chapters = parsed.chapters;
          if (typeof parsed?.volumeSummary === 'string') volumeSummary = parsed.volumeSummary;
        } catch {}
      }
      console.log(`[archive-split] model=${model} pdf=${!!pdfBase64} 화수=${chapters.length} 권요약=${volumeSummary.length}자`);
      return NextResponse.json({ chapters, volumeSummary, usage: splitResult.usage, usedModel: model });
    }

    const p: Prompts =
      mode === 'metrics' ? { system: METRICS_PROMPT, userPrefix: METRICS_USER_PREFIX }
      : mode === 'chapter' ? { system: CHAPTER_PROMPT, userPrefix: CHAPTER_USER_PREFIX }
      : mode === 'doc-import' ? { system: DOC_IMPORT_PROMPT, userPrefix: DOC_IMPORT_USER_PREFIX }
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

    // 문서 임포트: { planning, research } 두 묶음으로 반환 (클라이언트가 각 탭의 빈 필드만 채움)
    if (mode === 'doc-import') {
      const imported = extracted as { planning?: Record<string, unknown>; research?: Record<string, unknown> };
      return NextResponse.json({
        imported: { planning: imported.planning ?? {}, research: imported.research ?? {} },
        usage: result.usage,
        usedModel,
      });
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
