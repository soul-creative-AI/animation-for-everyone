'use client';
import FieldItem from './FieldItem';
import type { ResearchData, ResearchStatuses, ResearchMode } from '@/types';

const COMMON_FIELDS: { key: keyof ResearchData; label: string; rows?: number }[] = [
  { key: 'purpose',         label: '리서치 목적' },
  { key: 'subject',         label: '조사 대상' },
  { key: 'scope',           label: '조사 범위' },
  { key: 'summary',         label: '자료 요약', rows: 3 },
  { key: 'keyFindings',     label: '핵심 발견', rows: 2 },
  { key: 'similarWorks',    label: '유사 작품', rows: 2 },
  { key: 'marketResponse',  label: '시장 반응', rows: 2 },
  { key: 'targetResponse',  label: '타깃 반응', rows: 2 },
  { key: 'differentiation', label: '차별화 가능성', rows: 2 },
  { key: 'planningPoints',  label: '기획 반영 포인트', rows: 2 },
  { key: 'risks',           label: '위험 요소', rows: 2 },
  { key: 'sources',         label: '출처', rows: 2 },
];

const ADAPTATION_FIELDS: { key: keyof ResearchData; label: string; rows?: number }[] = [
  { key: 'originalTitle',     label: '원작명' },
  { key: 'originalFormat',    label: '원작 형식' },
  { key: 'fullPlot',          label: '전체 줄거리', rows: 4 },
  { key: 'episodeSummaries',  label: '회차별 요약', rows: 4 },
  { key: 'mainCharacters',    label: '주요 캐릭터', rows: 3 },
  { key: 'characterRelations',label: '인물 관계', rows: 2 },
  { key: 'worldRules',        label: '세계관 규칙', rows: 2 },
  { key: 'keyEvents',         label: '주요 사건', rows: 2 },
  { key: 'emotionalArcs',     label: '핵심 감정선', rows: 2 },
  { key: 'keyTwists',         label: '핵심 반전', rows: 2 },
  { key: 'mustKeep',          label: '반드시 유지할 요소', rows: 2 },
  { key: 'compressible',      label: '축약 가능한 구간', rows: 2 },
  { key: 'removable',         label: '삭제 가능한 구간', rows: 2 },
  { key: 'adaptationRisks',   label: '각색 위험 요소', rows: 2 },
  { key: 'fanSensitivities',  label: '팬 민감 요소', rows: 2 },
];

const ORIGINAL_FIELDS: { key: keyof ResearchData; label: string; rows?: number }[] = [
  { key: 'sourceBackground',    label: '소재 배경', rows: 2 },
  { key: 'similarMaterials',    label: '유사 소재', rows: 2 },
  { key: 'genreTrends',         label: '장르 트렌드', rows: 2 },
  { key: 'targetPreferences',   label: '타깃 선호 요소', rows: 2 },
  { key: 'overusedCliches',     label: '과도한 클리셰', rows: 2 },
  { key: 'newCombinations',     label: '새로운 조합 가능성', rows: 2 },
  { key: 'productionDifficulty',label: '제작 난이도' },
];

interface Props {
  research: ResearchData;
  statuses: ResearchStatuses;
  mode: ResearchMode;
  onModeChange: (m: ResearchMode) => void;
  onChange: (key: keyof ResearchData, value: string) => void;
}

export default function ResearchPanel({ research, statuses, mode, onModeChange, onChange }: Props) {
  const extraFields = mode === 'adaptation' ? ADAPTATION_FIELDS : ORIGINAL_FIELDS;

  return (
    <div className="w-72 flex flex-col bg-white border-l border-gray-200 shrink-0">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-800">리서치 정보</h2>
        <p className="text-xs text-gray-400 mt-0.5">조사와 자료 분석 결과가 정리돼요</p>
        {/* 모드 토글 */}
        <div className="flex mt-3 rounded-lg overflow-hidden border border-gray-200 text-[11px] font-semibold">
          {(['original', 'adaptation'] as ResearchMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`flex-1 py-1.5 transition-colors ${
                mode === m ? 'bg-emerald-500 text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {m === 'original' ? '오리지널' : '원작 각색'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* 공통 필드 */}
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">공통</p>
        {COMMON_FIELDS.map(({ key, label, rows }) => (
          <FieldItem
            key={key}
            label={label}
            value={research[key]}
            status={statuses[key] ?? 'undecided'}
            rows={rows}
            onChange={(v) => onChange(key, v)}
          />
        ))}

        {/* 모드별 필드 */}
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-2">
          {mode === 'adaptation' ? '원작 각색' : '오리지널'}
        </p>
        {extraFields.map(({ key, label, rows }) => (
          <FieldItem
            key={key}
            label={label}
            value={research[key]}
            status={statuses[key] ?? 'undecided'}
            rows={rows}
            onChange={(v) => onChange(key, v)}
          />
        ))}
      </div>
    </div>
  );
}
