'use client';
import FieldItem from './FieldItem';
import type { PlanningData, PlanningStatuses, WorkType } from '@/types';

const WORK_TYPE_OPTIONS: { value: WorkType; label: string }[] = [
  { value: 'undecided',   label: '미정' },
  { value: 'original',    label: '오리지널' },
  { value: 'adaptation',  label: '원작 각색' },
  { value: 'series',      label: '시리즈물' },
  { value: 'feature',     label: '장편(극장판)' },
];

type FieldConfig = {
  key: keyof PlanningData;
  label: string;
  rows?: number;
  placeholder?: string;
  type?: 'text' | 'select';
  options?: { value: string; label: string }[];
};

export const FIELDS: FieldConfig[] = [
  { key: 'title',          label: '제목' },
  { key: 'workType',       label: '작품 유형', type: 'select', options: WORK_TYPE_OPTIONS },
  { key: 'genre',          label: '장르' },
  { key: 'tone',           label: '톤/분위기' },
  { key: 'logline',        label: '로그라인', rows: 2 },
  { key: 'theme',          label: '주제' },
  { key: 'synopsis',       label: '시놉시스', rows: 3 },
  { key: 'visualStyle',    label: '비주얼 스타일' },
  { key: 'targetAudience', label: '타깃 시청자', rows: 2, placeholder: '예: 15~24세 중심, 판타지 액션을 선호하는 시청자' },
  { key: 'episodeCount',   label: '회차 수', placeholder: '미정' },
  { key: 'runtime',        label: '러닝타임', placeholder: '미정' },
  { key: 'protagonist',    label: '주인공', rows: 2 },
  { key: 'keyCharacters',  label: '주요 등장인물', rows: 3 },
];

interface Props {
  planning: PlanningData;
  statuses: PlanningStatuses;
  onChange: (key: keyof PlanningData, value: string) => void;
  onToggleConfirm: (key: keyof PlanningData) => void;
}

export default function PlanningPanel({ planning, statuses, onChange, onToggleConfirm }: Props) {
  return (
    <div className="w-full h-full flex flex-col bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-800">기획 정보</h2>
        <p className="text-xs text-gray-400 mt-0.5">대화하면 자동으로 채워져요</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {FIELDS.map((f) => (
          <FieldItem
            key={f.key}
            label={f.label}
            value={planning[f.key]}
            status={statuses[f.key]}
            rows={f.rows}
            placeholder={f.placeholder}
            type={f.type}
            options={f.options}
            onChange={(v) => onChange(f.key, v)}
            onToggleConfirm={() => onToggleConfirm(f.key)}
          />
        ))}
      </div>
    </div>
  );
}
