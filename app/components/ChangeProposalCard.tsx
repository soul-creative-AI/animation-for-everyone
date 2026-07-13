'use client';
import { useState } from 'react';
import type { PendingChange, PlanningData } from '@/types';

interface Props {
  change: PendingChange;
  onApply: (fieldKey: keyof PlanningData, value: string) => void;
  onDismiss: (id: string) => void;
}

export default function ChangeProposalCard({ change, onApply, onDismiss }: Props) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="bg-white border border-amber-200 rounded-2xl overflow-hidden shadow-sm max-w-sm">
      <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
        <p className="text-[11px] font-bold text-amber-700">기획 변경 제안 · {change.fieldLabel}</p>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start gap-2 text-xs">
          <span className="text-gray-400 w-10 shrink-0 pt-0.5">현재</span>
          <span className="text-gray-600">{change.current || '(미입력)'}</span>
        </div>
        <div className="flex items-start gap-2 text-xs">
          <span className="text-emerald-600 font-semibold w-10 shrink-0 pt-0.5">제안</span>
          <span className="text-gray-800 font-medium">{change.suggested}</span>
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed border-t border-gray-100 pt-2 mt-1">
          {change.reason}
        </p>
      </div>

      {!showPreview ? (
        <div className="flex gap-2 px-4 py-3 border-t border-gray-100">
          <button
            onClick={() => setShowPreview(true)}
            className="px-3 py-1.5 text-[11px] font-semibold border border-gray-200 hover:border-emerald-400 text-gray-600 hover:text-emerald-600 rounded-lg transition-colors"
          >
            변경 내용 보기
          </button>
          <button
            onClick={() => onDismiss(change.id)}
            className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            무시
          </button>
        </div>
      ) : (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-[11px] font-semibold text-gray-600 mb-2">
            {change.fieldLabel}: <span className="text-gray-400 line-through">{change.current || '없음'}</span>
            {' → '}
            <span className="text-emerald-600 font-bold">{change.suggested}</span>
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { onApply(change.fieldKey, change.suggested); setShowPreview(false); }}
              className="px-3 py-1.5 text-[11px] font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
            >
              적용
            </button>
            <button
              onClick={() => setShowPreview(false)}
              className="px-3 py-1.5 text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
