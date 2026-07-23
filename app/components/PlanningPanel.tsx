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
  { key: 'planningIntent', label: '기획 의도', rows: 3, placeholder: '왜 지금 이 작품을 만드는가 — 배경·목표·전하려는 가치' },
  { key: 'differentiationPoint', label: '차별화 포인트', rows: 3, placeholder: '유사 작품 대비 이 기획만의 강점' },
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
  locked?: boolean;  // 시작 잠금 — AI와 첫 대화 전까지 직접 입력 비활성
  onChange: (key: keyof PlanningData, value: string) => void;
  onToggleConfirm: (key: keyof PlanningData) => void;
}

export default function PlanningPanel({ planning, statuses, locked = false, onChange, onToggleConfirm }: Props) {
  return (
    <div className="w-full h-full flex flex-col bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-800">기획 정보</h2>
        <p className="text-xs text-gray-400 mt-0.5">대화하거나 자료를 올리면 자동으로 채워져요</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {locked && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[11px] text-amber-700 leading-relaxed">🔒 왼쪽 채팅에서 AI와 대화를 시작하면 직접 편집할 수 있어요</p>
          </div>
        )}
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
            disabled={locked}
            onChange={(v) => onChange(f.key, v)}
            onToggleConfirm={() => onToggleConfirm(f.key)}
          />
        ))}
      </div>
    </div>
  );
}
