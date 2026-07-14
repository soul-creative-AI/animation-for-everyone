'use client';
import FieldItem from './FieldItem';
import type { ResearchData, ResearchStatuses } from '@/types';

const COMMON_FIELDS: { key: keyof ResearchData; label: string; rows?: number }[] = [
  { key: 'similarWorks',    label: '유사 작품/경쟁작', rows: 2 },
  { key: 'genreTrends',     label: '장르 트렌드', rows: 2 },
  { key: 'differentiation', label: '차별화 가능성', rows: 2 },
  { key: 'planningPoints',  label: '기획 반영 포인트', rows: 2 },
];

const ADAPTATION_FIELDS: { key: keyof ResearchData; label: string; rows?: number }[] = [
  { key: 'originalTitle',      label: '원작명' },
  { key: 'originalFormat',     label: '원작 형식' },
  { key: 'fullPlot',           label: '전체 줄거리', rows: 4 },
  { key: 'episodeSummaries',   label: '회차별 요약', rows: 4 },
  { key: 'mainCharacters',     label: '주요 캐릭터', rows: 3 },
  { key: 'characterRelations', label: '인물 관계', rows: 2 },
  { key: 'keyEvents',          label: '주요 사건', rows: 2 },
  { key: 'mustKeep',           label: '반드시 유지할 요소', rows: 2 },
  { key: 'compressible',       label: '축약 가능한 구간', rows: 2 },
  { key: 'removable',          label: '삭제 가능한 구간', rows: 2 },
];

interface Props {
  research: ResearchData;
  statuses: ResearchStatuses;
  onChange: (key: keyof ResearchData, value: string) => void;
}

export default function ResearchPanel({ research, statuses, onChange }: Props) {
  return (
    <div className="w-72 flex flex-col bg-white border-l border-gray-200 shrink-0">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-800">리서치 정보</h2>
        <p className="text-xs text-gray-400 mt-0.5">조사와 자료 분석 결과가 정리돼요</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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

        {/* 원작 각색 전용 필드 — 오리지널 작품은 비워두면 됨 */}
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-2">원작 각색 (오리지널은 비워두세요)</p>
        {ADAPTATION_FIELDS.map(({ key, label, rows }) => (
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
