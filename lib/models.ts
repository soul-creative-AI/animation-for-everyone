// ── AI 모델 목록 ──────────────────────────────────────────────
export const MODELS = [
  { id: 'gemini',        label: 'Gemini Flash',   desc: '빠름' },
  { id: 'claude-haiku',  label: 'Claude Haiku',   desc: '저렴' },
  { id: 'claude-sonnet', label: 'Claude Sonnet',  desc: '스마트' },
  { id: 'claude-fable',  label: 'Claude Fable 5', desc: '창의적' },
  { id: 'gpt-4o-mini',   label: 'GPT-4o mini',    desc: '저렴' },
  { id: 'gpt-4o',        label: 'GPT-4o',         desc: '고성능' },
  { id: 'gpt-4.5',       label: 'GPT-4.5',        desc: '최신' },
  { id: 'gpt-5.6-sol',   label: 'GPT-5.6 Sol',    desc: '최신' },
  { id: 'gpt-5.6-luna',  label: 'GPT-5.6 Luna',   desc: '최신' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra',  desc: '최신' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];
