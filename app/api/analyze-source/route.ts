import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import type { ResearchData } from '@/types';

// 원작 텍스트에서 각색 리서치 필드를 추출하는 프롬프트
const SYSTEM_PROMPT = `당신은 애니메이션 각색을 돕는 원작 분석 전문가입니다. 사용자가 업로드한 원작 텍스트를 읽고, 각색 리서치에 필요한 정보를 추출하세요.

반드시 아래 JSON 형식으로만 응답하세요. 원작 텍스트에서 파악되지 않는 항목은 빈 문자열("")로 두세요. JSON 외의 다른 설명은 붙이지 마세요.

\`\`\`json
{
  "originalTitle": "원작 제목",
  "originalFormat": "원작 형식 (웹툰/웹소설/소설/만화 등)",
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

type ModelId = 'gemini' | 'claude-haiku' | 'claude-sonnet' | 'claude-fable' | 'gpt-4o-mini' | 'gpt-4o' | 'gpt-4.5' | 'gpt-5.6-sol' | 'gpt-5.6-luna' | 'gpt-5.6-terra';

async function callGemini(text: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: SYSTEM_PROMPT,
  });
  const result = await model.generateContent(USER_PREFIX + text);
  return result.response.text();
}

async function callClaude(text: string, modelId: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: USER_PREFIX },
          // 원작 텍스트에 프롬프트 캐싱 적용 — 같은 원작으로 이어서 질문하면 재사용되어 저렴
          { type: 'text', text, cache_control: { type: 'ephemeral' } },
        ],
      },
    ],
  });
  return response.content[0].type === 'text' ? response.content[0].text : '';
}

async function callOpenAI(text: string, modelId: string): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: USER_PREFIX + text },
    ],
  });
  return response.choices[0].message.content ?? '';
}

export async function POST(req: NextRequest) {
  try {
    const { text, model = 'gemini' }: { text: string; model?: ModelId } = await req.json();

    if (!text || !text.trim()) {
      return NextResponse.json({ error: '분석할 텍스트가 비어 있습니다.' }, { status: 400 });
    }

    let raw = '';
    switch (model) {
      case 'gemini':        raw = await callGemini(text); break;
      case 'claude-haiku':  raw = await callClaude(text, 'claude-haiku-4-5-20251001'); break;
      case 'claude-sonnet': raw = await callClaude(text, 'claude-sonnet-4-5'); break;
      case 'claude-fable':  raw = await callClaude(text, 'claude-fable-5'); break;
      case 'gpt-4o-mini':   raw = await callOpenAI(text, 'gpt-4o-mini'); break;
      case 'gpt-4o':        raw = await callOpenAI(text, 'gpt-4o'); break;
      case 'gpt-4.5':       raw = await callOpenAI(text, 'gpt-4.5-preview'); break;
      case 'gpt-5.6-sol':   raw = await callOpenAI(text, 'gpt-5.6-sol'); break;
      case 'gpt-5.6-luna':  raw = await callOpenAI(text, 'gpt-5.6-luna'); break;
      case 'gpt-5.6-terra': raw = await callOpenAI(text, 'gpt-5.6-terra'); break;
      default:              raw = await callGemini(text);
    }

    // JSON 블록 추출
    const jsonMatch = raw.match(/```json\n([\s\S]*?)\n```/) ?? raw.match(/\{[\s\S]*\}/);
    let extracted: Partial<ResearchData> = {};
    if (jsonMatch) {
      try {
        extracted = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
      } catch {
        // 파싱 실패 시 빈 결과 반환
      }
    }

    return NextResponse.json({ extracted });
  } catch (e) {
    console.error('원작 분석 실패:', e);
    return NextResponse.json({ error: '분석 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
