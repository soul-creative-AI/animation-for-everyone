'use client';
import { useState } from 'react';
import type { Proposal, PlanningData } from '@/types';

const DIFF_CLS = { 쉬움: 'text-emerald-600', 보통: 'text-amber-600', 어려움: 'text-red-500' };

interface Props {
  proposals: Proposal[];
  onApply: (fields: Partial<PlanningData>) => void;
  onRegenerate: () => void;
}

export default function ProposalCard({ proposals, onApply, onRegenerate }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview]   = useState(false);

  const chosen = proposals.find((p) => p.id === selected);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm max-w-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="text-xs font-bold text-gray-700">방향 제안</p>
        <button onClick={onRegenerate} className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors">
          다시 제안 ↺
        </button>
      </div>

      <div className="grid grid-cols-3 divide-x divide-gray-100">
        {proposals.map((p) => (
          <div
            key={p.id}
            className={`p-4 flex flex-col gap-2 cursor-pointer transition-colors ${
              selected === p.id ? 'bg-emerald-50' : 'hover:bg-gray-50'
            }`}
            onClick={() => setSelected(p.id)}
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                selected === p.id ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600'
              }`}>{p.label}안</span>
              <span className={`text-[10px] font-medium ${DIFF_CLS[p.productionDifficulty]}`}>
                난이도 {p.productionDifficulty}
              </span>
            </div>
            <p className="text-xs font-semibold text-gray-800 leading-snug">{p.title}</p>
            <p className="text-[11px] text-gray-500 leading-relaxed">{p.summary}</p>
            <div className="space-y-0.5 mt-1">
              {p.pros.map((pro) => (
                <p key={pro} className="text-[10px] text-emerald-600">✓ {pro}</p>
              ))}
              {p.cons.map((con) => (
                <p key={con} className="text-[10px] text-red-400">✗ {con}</p>
              ))}
            </div>
            <p className="text-[10px] text-blue-500 mt-1">타깃: {p.expectedTarget}</p>
          </div>
        ))}
      </div>

      {selected && !preview && (
        <div className="flex gap-2 px-4 py-3 border-t border-gray-100">
          <button
            onClick={() => setPreview(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
          >
            {chosen?.label}안 선택
          </button>
          <button
            onClick={() => setSelected(null)}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            취소
          </button>
        </div>
      )}

      {preview && chosen && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-[11px] font-semibold text-gray-600 mb-2">변경될 기획 필드 미리보기</p>
          {Object.entries(chosen.affectedFields).map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[11px] mb-1">
              <span className="text-gray-400 w-16 shrink-0">{k}</span>
              <span className="text-gray-700">{typeof v === 'object' ? JSON.stringify(v) : v}</span>
            </div>
          ))}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => { onApply(chosen.affectedFields); setPreview(false); }}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
            >
              적용
            </button>
            <button
              onClick={() => setPreview(false)}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
