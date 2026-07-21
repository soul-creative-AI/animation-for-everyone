'use client';
import { useEffect, useState } from 'react';
import FieldItem from './FieldItem';
import PlatformMetricsEditor from './PlatformMetricsEditor';
import type { ResearchData, ResearchStatuses, PlatformMetric, SentimentBreakdown } from '@/types';
import type { ModelId } from '@/lib/models';
import { PROVIDER_OF_MODEL, type Provider } from '@/lib/budgets';

// 자동조사는 provider별 저비용 고정 모델을 씀 (app/api/analyze-source/route.ts의 resolveDiscoverModel과 동일)
const DISCOVER_MODEL_LABEL: Record<Provider, string> = {
  claude: 'Claude Haiku', gemini: 'Gemini Flash', openai: 'GPT-4o mini',
};

// 독자 감정 비율 도넛 차트 (긍정/부정/중립) — 라이브러리 없이 SVG stroke-dasharray로 그림
function SentimentDonut({ sentiment }: { sentiment: SentimentBreakdown }) {
  const total = sentiment.positive + sentiment.negative + sentiment.neutral;
  if (total <= 0) return null;
  const segments = [
    { label: '긍정', value: sentiment.positive, color: '#10b981' },
    { label: '부정', value: sentiment.negative, color: '#f43f5e' },
    { label: '중립', value: sentiment.neutral, color: '#9ca3af' },
  ];
  const r = 30;                    // 반지름
  const c = 2 * Math.PI * r;       // 원둘레
  let offset = 0;                  // 누적 오프셋(원둘레 기준)
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 flex items-center gap-4">
      <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0 -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        {segments.map((s) => {
          const frac = s.value / total;
          const dash = frac * c;
          const el = (
            <circle
              key={s.label}
              cx="38" cy="38" r={r} fill="none" stroke={s.color} strokeWidth="10"
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="space-y-1">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="w-6">{s.label}</span>
            <span className="font-semibold text-gray-800">{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ResearchFieldGroup {
  label?: string;   // 큰 섹션 안에서 구간을 나눌 때 쓰는 소제목 (선택)
  note?: string;    // 그룹 입력 안내
  fields: { key: keyof ResearchData; label: string; rows?: number; placeholder?: string }[];
}

export interface ResearchSection {
  heading: string;
  groups: ResearchFieldGroup[];
}

// 원작 IP 분석 보고서 구조 — 내보내기(page.tsx)에서도 이 순서 그대로 사용
export const RESEARCH_SECTIONS: ResearchSection[] = [
  {
    heading: '시장 리서치',
    groups: [
      {
        fields: [
          { key: 'similarWorks',    label: '유사 작품/경쟁작', rows: 2 },
          { key: 'genreTrends',     label: '장르 트렌드', rows: 2 },
          { key: 'differentiation', label: '차별화 가능성', rows: 2 },
          { key: 'planningPoints',  label: '기획 반영 포인트', rows: 2 },
        ],
      },
    ],
  },
  {
    heading: '원작 콘텐츠 분석',
    groups: [
      {
        label: '작품 개요',
        fields: [
          { key: 'originalTitle',       label: '원작명' },
          { key: 'overviewAuthor',      label: '작가' },
          { key: 'originalFormat',      label: '원작 형식', placeholder: '웹툰 / 웹소설 / 소설 등' },
          { key: 'overviewGenreStatus', label: '장르 / 연재 상태', placeholder: '예: 퓨전 판타지 / 완결 · 총 375화' },
          { key: 'overviewPlatforms',   label: '유통 플랫폼', placeholder: '예: 문피아, 카카오페이지(외전 독점)' },
          { key: 'overviewPremise',     label: '핵심 설정', rows: 3 },
        ],
      },
      {
        label: '플랫폼 공식 지표',
        note: '플랫폼에서 직접 확인한 수치만 입력하세요. AI가 채우지 않아요.',
        fields: [
          { key: 'metricsInterpretation', label: '지표 해석 (기획 관점)', rows: 3 },
        ],
      },
      {
        label: '독자 반응 분석',
        note: '직접 수집한 리뷰·댓글 경향을 정리하세요.',
        fields: [
          { key: 'reactionPositive', label: '긍정 반응 키워드/요지', rows: 3 },
          { key: 'reactionNegative', label: '부정 반응 키워드/요지', rows: 3 },
        ],
      },
      {
        label: '독자층 프로파일',
        fields: [
          { key: 'audienceProfile', label: '주 독자층 / 근거', rows: 3, placeholder: '관측 가능한 신호(커뮤니티, 팬덤 경향 등) 기반으로' },
        ],
      },
      {
        label: '작품 요소별 평가',
        fields: [
          { key: 'elementEvaluation', label: '요소/평가/근거요지', rows: 4, placeholder: '요소 | 평가 | 근거요지 형식으로 한 줄씩\n예: 세계관·시스템 | 강점 | 룸 등급, 브리딩 등 밀도가 차별점' },
        ],
      },
      {
        label: '각색 관점 시사점',
        fields: [
          { key: 'adaptationInsights', label: '데이터 신호 → 각색 전략', rows: 4 },
        ],
      },
      {
        label: '원작 콘텐츠 상세',
        note: '각색 작업용 상세 분석 — 오리지널 작품은 비워두세요.',
        fields: [
          { key: 'fullPlot',           label: '전체 줄거리', rows: 4 },
          { key: 'episodeSummaries',   label: '회차별 요약', rows: 4 },
          { key: 'mainCharacters',     label: '주요 캐릭터', rows: 3 },
          { key: 'characterRelations', label: '인물 관계', rows: 2 },
          { key: 'keyEvents',          label: '주요 사건', rows: 2 },
          { key: 'mustKeep',           label: '반드시 유지할 요소', rows: 2 },
          { key: 'compressible',       label: '축약 가능한 구간', rows: 2 },
          { key: 'removable',          label: '삭제 가능한 구간', rows: 2 },
        ],
      },
    ],
  },
];

export interface DiscoverResult {
  found: boolean;
  platforms: { platform: string; url: string }[];
  fields: Partial<ResearchData>;
  note: string;
}

interface Props {
  research: ResearchData;
  statuses: ResearchStatuses;
  model: ModelId;
  onChange: (key: keyof ResearchData, value: string) => void;
  onToggleConfirm: (key: keyof ResearchData) => void;
  onAnalyzeMetrics: (text: string) => Promise<boolean>;
  onDiscover: (title: string) => Promise<DiscoverResult | null>;
  onApplyToPlanning: () => void;
  onAddMetric: () => void;
  onUpdateMetric: (id: string, patch: Partial<PlatformMetric>) => void;
  onRemoveMetric: (id: string) => void;
}

// 원작명으로 일반 웹 검색 (AI가 못 찾았을 때의 수동 폴백)
function fallbackSearchUrl(title: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(title.trim())}`;
}

// 플랫폼 페이지 붙여넣기 → AI가 지표·독자반응만 추출해 필드 자동 입력
function MetricsPasteHelper({
  originalTitle, model, onAnalyze, onDiscover, platformMetrics, onAddMetric, onUpdateMetric, onRemoveMetric,
}: {
  originalTitle: string;
  model: ModelId;
  onAnalyze: (text: string) => Promise<boolean>;
  onDiscover: (title: string) => Promise<DiscoverResult | null>;
  platformMetrics: PlatformMetric[];
  onAddMetric: () => void;
  onUpdateMetric: (id: string, patch: Partial<PlatformMetric>) => void;
  onRemoveMetric: (id: string) => void;
}) {
  const discoverModelLabel = DISCOVER_MODEL_LABEL[PROVIDER_OF_MODEL[model]];
  const [open, setOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [confirmDiscover, setConfirmDiscover] = useState(false);  // Claude 사용 확인 단계
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);

  // 채팅에서 원작명을 새로 알려주면, 바로 "AI로 자동 조사하기" 버튼이 보이도록 펼쳐줌
  useEffect(() => {
    if (originalTitle.trim()) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalTitle]);

  // 플랫폼별로 입력한 조회수·평점·댓글을 모아 AI로 지표 해석 + 긍정/부정 반응 분석
  async function runCommentAnalysis() {
    if (analyzing) return;
    const withData = platformMetrics.filter((m) => m.views || m.rating || m.comments.trim());
    if (withData.length === 0) {
      alert('먼저 플랫폼별로 조회수·평점 또는 "댓글·리뷰"를 입력해주세요.');
      return;
    }
    const merged = withData.map((m) => {
      const lines = [`[${m.platform || '플랫폼'}]`];
      if (m.views) lines.push(`조회수: ${m.views}`);
      if (m.rating) lines.push(`평점: ${m.rating}`);
      if (m.comments.trim()) lines.push(`댓글/리뷰:\n${m.comments}`);
      return lines.join('\n');
    }).join('\n\n');
    setAnalyzing(true);
    await onAnalyze(merged);
    setAnalyzing(false);
  }

  async function runDiscover() {
    if (!originalTitle.trim() || discovering) return;
    setConfirmDiscover(false);
    setDiscovering(true);
    const result = await onDiscover(originalTitle);
    setDiscoverResult(result);
    setDiscovering(false);
  }

  const filledFieldCount = discoverResult ? Object.values(discoverResult.fields).filter(Boolean).length : 0;

  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 transition-colors">
        🔗 플랫폼 데이터 가져오기 도우미 {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          <p className="text-[10px] text-gray-500 leading-relaxed">
            AI가 작품명으로 검색해서 게재처·작가·형식·장르 등을 찾아 채워요. 조회수·평점같이 직접 확인해야 하는 데이터는 페이지에서 복사한 뒤 아래 칸에 붙여넣으면 분석해드려요.
          </p>

          {!originalTitle.trim() ? (
            <p className="text-[10px] text-amber-600">위 &lsquo;원작명&rsquo;을 먼저 입력하면 검색할 수 있어요</p>
          ) : confirmDiscover ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-2">
              <p className="text-[10px] text-amber-800 leading-relaxed">
                지금 선택한 모델 계열의 저비용 모델(<b>{discoverModelLabel}</b>)로 웹 검색을 진행합니다. 진행할까요?
              </p>
              <div className="flex gap-1.5">
                <button onClick={runDiscover}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors">
                  진행
                </button>
                <button onClick={() => setConfirmDiscover(false)}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
                  취소
                </button>
              </div>
            </div>
          ) : (
            <>
              <button onClick={() => setConfirmDiscover(true)} disabled={discovering}
                className="w-full px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-300 bg-white hover:bg-emerald-50 disabled:opacity-40 text-emerald-700 transition-colors">
                {discovering ? '검색 중...' : '🔍 AI로 자동 조사하기'}
              </button>
              {discoverResult && !discoverResult.found && (
                <div className="text-[10px] text-gray-500">
                  <p>{discoverResult.note || '찾지 못했어요.'}</p>
                  <a href={fallbackSearchUrl(originalTitle)} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">
                    직접 검색해보기 ↗
                  </a>
                </div>
              )}
            </>
          )}

          <div className="border-t border-emerald-100 pt-3">
            <p className="text-[10px] font-semibold text-gray-600 mb-2">플랫폼별 지표</p>
            <PlatformMetricsEditor
              metrics={platformMetrics}
              originalTitle={originalTitle}
              onAdd={onAddMetric}
              onUpdate={onUpdateMetric}
              onRemove={onRemoveMetric}
            />
            {platformMetrics.some((m) => m.views || m.rating || m.comments.trim()) && (
              <button onClick={runCommentAnalysis} disabled={analyzing}
                className="w-full mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white transition-colors">
                {analyzing ? '분석 중...' : '📊 입력한 지표·댓글 분석하기'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResearchPanel({ research, statuses, model, onChange, onToggleConfirm, onAnalyzeMetrics, onDiscover, onApplyToPlanning, onAddMetric, onUpdateMetric, onRemoveMetric }: Props) {
  // 리서치 데이터가 채워져 있는지 확인 (문자열 필드 + 플랫폼 지표 배열)
  const hasResearchData =
    Object.values(research).some(v => typeof v === 'string' && v.trim() !== '') ||
    (research.platformMetrics ?? []).length > 0;

  return (
    <div className="w-full h-full flex flex-col bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-gray-800">리서치 정보</h2>
            <p className="text-xs text-gray-400 mt-0.5">원작 IP 분석 보고서 구조로 정리돼요</p>
          </div>
          <button
            onClick={onApplyToPlanning}
            disabled={!hasResearchData}
            title={hasResearchData ? "리서치 내용을 기획 필드에 채워 넣어요 (확정한 필드는 건드리지 않아요)" : "리서치 정보를 먼저 채워주세요"}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
              hasResearchData
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white cursor-pointer'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            기획에 적용 →
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {RESEARCH_SECTIONS.map((section) => (
          <div key={section.heading}>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide pb-2 border-b border-gray-100">{section.heading}</p>
            <div className="space-y-3 mt-3">
              {section.groups.map((group, gi) => (
                <div key={group.label ?? gi} className="space-y-3">
                  {group.label && <p className="text-[10px] font-semibold text-gray-400 pt-1">{group.label}</p>}
                  {group.note && <p className="text-[10px] text-gray-400 -mt-2">{group.note}</p>}
                  {group.label === '플랫폼 공식 지표' && (
                    <MetricsPasteHelper
                      originalTitle={research.originalTitle}
                      model={model}
                      onAnalyze={onAnalyzeMetrics}
                      onDiscover={onDiscover}
                      platformMetrics={research.platformMetrics ?? []}
                      onAddMetric={onAddMetric}
                      onUpdateMetric={onUpdateMetric}
                      onRemoveMetric={onRemoveMetric}
                    />
                  )}
                  {group.label === '독자 반응 분석' && research.sentiment && (
                    <SentimentDonut sentiment={research.sentiment} />
                  )}
                  {group.fields.map(({ key, label, rows, placeholder }) => (
                    <FieldItem
                      key={key}
                      label={label}
                      value={String(research[key] ?? '')}
                      status={statuses[key] ?? 'undecided'}
                      rows={rows}
                      placeholder={placeholder}
                      onChange={(v) => onChange(key, v)}
                      onToggleConfirm={() => onToggleConfirm(key)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
