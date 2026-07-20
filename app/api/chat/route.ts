import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import type { Message, PlanningData, ResearchData } from '@/types';
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
  - 각색이라면: 사용자가 작품 제목을 말하면, 줄거리·형식·장르를 사용자에게 되묻지 마세요. 대신 "오른쪽 위 '🔍 AI로 자동 조사하기' 버튼을 눌러주시면 제가 검색해서 게재처와 개요를 찾아드릴게요"라고 안내하세요. 원작 파일 첨부도 함께 제안할 수 있습니다.
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

type ModelId = 'gemini' | 'claude-haiku' | 'claude-sonnet' | 'claude-fable' | 'gpt-4o-mini' | 'gpt-4o' | 'gpt-4.5' | 'gpt-5.6-sol' | 'gpt-5.6-luna' | 'gpt-5.6-terra';
type ChatContext = 'planning' | 'research';

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

export async function POST(req: NextRequest) {
  try {
    const {
      messages, model = 'gemini', context = 'planning', planningData, researchData,
    }: {
      messages: Message[]; model?: ModelId; context?: ChatContext;
      planningData?: Partial<PlanningData>; researchData?: Partial<ResearchData>;
    } = await req.json();

    const lock = await checkBudgetLock(model);
    if (lock?.locked) {
      return NextResponse.json({ error: budgetLockMessage(lock) }, { status: 402 });
    }

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

    const systemPrompt = (context === 'research' ? RESEARCH_SYSTEM_PROMPT : PLANNING_SYSTEM_PROMPT) + contextBlock;

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

    return NextResponse.json({ text: cleanText, extracted, usage });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: '오류가 발생했습니다.' }, { status: 500 });
  }
}
