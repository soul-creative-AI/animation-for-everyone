import type { ModelId } from '@/lib/models';

// ── 프로바이더 분류 ────────────────────────────────────────────
export type Provider = 'claude' | 'openai' | 'gemini';

export const PROVIDER_OF_MODEL: Record<ModelId, Provider> = {
  'gemini':        'gemini',
  'claude-haiku':  'claude',
  'claude-sonnet': 'claude',
  'claude-fable':  'claude',
  'gpt-4o-mini':   'openai',
  'gpt-4o':        'openai',
  'gpt-4.5':       'openai',
  'gpt-5.6-sol':   'openai',
  'gpt-5.6-luna':  'openai',
  'gpt-5.6-terra': 'openai',
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  claude: 'Claude',
  openai: 'OpenAI (GPT)',
  gemini: 'Gemini',
};

// 프로바이더별 소속 모델 (사용량 집계 시 provider 필터링용)
export const MODELS_OF_PROVIDER: Record<Provider, ModelId[]> = (() => {
  const map: Record<Provider, ModelId[]> = { claude: [], openai: [], gemini: [] };
  for (const [model, provider] of Object.entries(PROVIDER_OF_MODEL) as [ModelId, Provider][]) {
    map[provider].push(model);
  }
  return map;
})();

// 충전일(예: 14일) 기준으로 오늘이 속한 사용 기간의 시작일을 계산
// (오늘이 14일 이후면 이번 달 14일, 이전이면 지난 달 14일)
export function billingPeriodStart(billingDate: string, today = new Date()): Date {
  const anchorDay = new Date(billingDate).getDate();
  if (today.getDate() < anchorDay) {
    return new Date(today.getFullYear(), today.getMonth() - 1, anchorDay);
  }
  return new Date(today.getFullYear(), today.getMonth(), anchorDay);
}

// ── 충전한 예산 (USD) 기본값 ───────────────────────────────────
// 실제 값은 DB(provider_budgets)에서 관리하며 운영자가 화면에서 수정.
// 아래는 DB 로드 실패 시 폴백 및 초기 표시용.
export const DEFAULT_BUDGET_USD: Record<Provider, number> = {
  claude: 21,
  openai: 13,
  gemini: 10,
};

// ── 운영자 (예산 수정 권한) ────────────────────────────────────
// 화면에서 수정 UI 노출 제어용. 실제 강제는 DB RLS(provider_budgets)에서 함.
export const ADMIN_EMAIL = 'mina214@sookmyung.ac.kr';
