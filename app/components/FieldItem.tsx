'use client';
import type { FieldStatus } from '@/types';

interface Props {
  label: string;
  value: string;
  status?: FieldStatus;
  rows?: number;
  placeholder?: string;
  onChange: (v: string) => void;
  type?: 'text' | 'select';
  options?: { value: string; label: string }[];
  onToggleConfirm?: () => void;
}

// 확정이 아닐 때만 표시하는 보조 배지
const STATUS_BADGE: Record<FieldStatus, { label: string; cls: string } | null> = {
  confirmed:  null, // 확정은 체크박스로 표시
  inferred:   { label: 'AI 추정',  cls: 'bg-blue-50 text-blue-500' },
  suggested:  { label: '변경 제안', cls: 'bg-amber-50 text-amber-600' },
  undecided:  null,
};

export default function FieldItem({
  label, value, status = 'undecided', rows = 1, placeholder = '—',
  onChange, type = 'text', options, onToggleConfirm,
}: Props) {
  const confirmed = status === 'confirmed';
  const badge = STATUS_BADGE[status];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-semibold text-gray-500">{label}</label>
        <div className="flex items-center gap-1.5">
          {!confirmed && badge && (
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
          )}
          {onToggleConfirm && (
            <button
              type="button"
              onClick={onToggleConfirm}
              className={`flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                confirmed
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'text-gray-400 hover:text-emerald-600 border border-gray-200'
              }`}
            >
              <span className={`inline-flex items-center justify-center w-3 h-3 rounded-[3px] border ${
                confirmed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300'
              }`}>
                {confirmed && (
                  <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={4}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              확정
            </button>
          )}
        </div>
      </div>
      {type === 'select' && options ? (
        <select
          value={value}
          disabled={confirmed}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full border rounded-lg px-3 py-2 text-xs outline-none transition-all appearance-none ${
            confirmed
              ? 'bg-emerald-50/40 border-emerald-200 text-gray-600 cursor-not-allowed'
              : 'bg-gray-50 border-gray-200 text-gray-700 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100'
          }`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          readOnly={confirmed}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full resize-none border rounded-lg px-3 py-2 text-xs placeholder-gray-300 outline-none transition-all ${
            confirmed
              ? 'bg-emerald-50/40 border-emerald-200 text-gray-600 cursor-not-allowed'
              : 'bg-gray-50 border-gray-200 text-gray-700 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100'
          }`}
        />
      )}
    </div>
  );
}
