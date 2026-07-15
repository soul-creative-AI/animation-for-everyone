import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import type { Message, PlanningData } from '@/types';
import { type TokenUsage, EMPTY_USAGE, claudeUsage, openaiUsage, geminiUsage } from '@/lib/usage';

interface AiResult { text: string; usage: TokenUsage; }

const SYSTEM_PROMPT = `당신은 애니메이션 기획 전문가 PD입니다. 사용자가 애니메이션 아이디어를 구체화할 수 있도록 대화를 통해 도와주세요.

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

type ModelId = 'gemini' | 'claude-haiku' | 'claude-sonnet' | 'claude-fable' | 'gpt-4o-mini' | 'gpt-4o' | 'gpt-4.5' | 'gpt-5.6-sol' | 'gpt-5.6-luna' | 'gpt-5.6-terra';

async function callGemini(messages: Message[]): Promise<AiResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: SYSTEM_PROMPT,
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

async function callClaude(messages: Message[], modelId: string): Promise<AiResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  });
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return { text, usage: claudeUsage(response.usage) };
}

async function callOpenAI(messages: Message[], modelId: string): Promise<AiResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      })),
    ],
  });
  return { text: response.choices[0].message.content ?? '', usage: openaiUsage(response.usage) };
}

export async function POST(req: NextRequest) {
  try {
    const { messages, model = 'gemini' }: { messages: Message[]; model?: ModelId } = await req.json();

    let result: AiResult = { text: '', usage: EMPTY_USAGE };

    switch (model) {
      case 'gemini':        result = await callGemini(messages); break;
      case 'claude-haiku':  result = await callClaude(messages, 'claude-haiku-4-5-20251001'); break;
      case 'claude-sonnet': result = await callClaude(messages, 'claude-sonnet-4-5'); break;
      case 'claude-fable':  result = await callClaude(messages, 'claude-fable-5'); break;
      case 'gpt-4o-mini':   result = await callOpenAI(messages, 'gpt-4o-mini'); break;
      case 'gpt-4o':        result = await callOpenAI(messages, 'gpt-4o'); break;
      case 'gpt-4.5':       result = await callOpenAI(messages, 'gpt-4.5-preview'); break;
      case 'gpt-5.6-sol':   result = await callOpenAI(messages, 'gpt-5.6-sol'); break;
      case 'gpt-5.6-luna':  result = await callOpenAI(messages, 'gpt-5.6-luna'); break;
      case 'gpt-5.6-terra': result = await callOpenAI(messages, 'gpt-5.6-terra'); break;
      default:              result = await callGemini(messages);
    }

    const { text, usage } = result;

    // JSON 블록 추출
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    let extracted: Partial<PlanningData> = {};
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
