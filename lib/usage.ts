// ── AI 토큰 사용량 (provider 공통 정규화 형태) ────────────────
export interface TokenUsage {
  inputTokens: number;        // 캐시 안 된 입력 토큰 (정가)
  outputTokens: number;       // 출력 토큰
  cachedInputTokens: number;  // 캐시에서 읽은 입력 토큰 (할인가)
  webSearches?: number;       // 웹 검색 도구 호출 횟수 (Claude web_search 등, $10/1000회)
}

export const EMPTY_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

// ── provider 응답 → TokenUsage 정규화 ─────────────────────────
export function claudeUsage(u: any): TokenUsage {
  return {
    // cache_creation(캐시 쓰기)은 대략 정가 취급, input_tokens는 이미 캐시 제외분
    inputTokens: (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0),
    outputTokens: u?.output_tokens ?? 0,
    cachedInputTokens: u?.cache_read_input_tokens ?? 0,
  };
}

export function openaiUsage(u: any): TokenUsage {
  const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (u?.prompt_tokens ?? 0) - cached),
    outputTokens: u?.completion_tokens ?? 0,
    cachedInputTokens: cached,
  };
}

export function geminiUsage(m: any): TokenUsage {
  const cached = m?.cachedContentTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, (m?.promptTokenCount ?? 0) - cached),
    outputTokens: m?.candidatesTokenCount ?? 0,
    cachedInputTokens: cached,
  };
}

// ── 모델별 단가 (USD / 1M 토큰) ───────────────────────────────
// ⚠️ Claude 외 단가는 근사치입니다. 실제 청구액과 다를 수 있으니
//    각 provider 공식 가격을 확인해 갱신하세요. 캐시 입력은 입력가의 10%로 근사.
const PRICING: Record<string, { in: number; out: number }> = {
  'gemini':        { in: 0.15, out: 0.60 },
  'claude-haiku':  { in: 1,    out: 5 },
  'claude-sonnet': { in: 3,    out: 15 },
  'claude-fable':  { in: 10,   out: 50 },
  'gpt-4o-mini':   { in: 0.15, out: 0.60 },
  'gpt-4o':        { in: 2.5,  out: 10 },
  'gpt-4.5':       { in: 75,   out: 150 },
  'gpt-5.6-sol':   { in: 3,    out: 15 },
  'gpt-5.6-luna':  { in: 3,    out: 15 },
  'gpt-5.6-terra': { in: 3,    out: 15 },
};

// 웹 검색 도구 단가 (Claude): $10 / 1,000회 검색 = $0.01/회
const WEB_SEARCH_COST_PER_USE = 0.01;

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const p = PRICING[model];
  const searchCost = (usage.webSearches ?? 0) * WEB_SEARCH_COST_PER_USE;
  if (!p) return searchCost;
  const inCost     = (usage.inputTokens       / 1e6) * p.in;
  const cachedCost = (usage.cachedInputTokens / 1e6) * p.in * 0.1;
  const outCost    = (usage.outputTokens      / 1e6) * p.out;
  return inCost + cachedCost + outCost + searchCost;
}
