'use client';
import { useState } from 'react';
import type { CompetitorWork } from '@/types';
import { MODELS, type ModelId } from '@/lib/models';

// 경쟁작/레퍼런스 분석 — 패널에는 컴팩트한 작품 리스트만 두고, 상세 분석은 모달로 열어본다.
// (우측 패널이 좁아서 작품마다 6개 분석 필드를 그대로 펼치면 너무 길어지기 때문)

interface Props {
  competitors: CompetitorWork[];
  model: ModelId;
  onModelChange: (m: ModelId) => void;
  analyzeModelLabel: string;  // 실제 검색에 쓰일 저비용 모델 이름 (선택한 모델의 provider 기준)
  onAdd: (title: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<CompetitorWork>) => void;
  onAnalyze: (id: string) => Promise<void>;
}

// 모달에 표시할 분석 필드 (키, 라벨, 아이콘)
const DETAIL_FIELDS: { key: keyof CompetitorWork; label: string }[] = [
  { key: 'summary',         label: '📌 한 줄 요약' },
  { key: 'strengths',       label: '💪 장점' },
  { key: 'cliches',         label: '🔁 클리셰' },
  { key: 'marketPosition',  label: '📊 시장 포지션' },
  { key: 'avoid',           label: '⚠️ 피해야 할 것' },
  { key: 'leverage',        label: '✅ 활용 방안' },
  { key: 'differentiation', label: '🎯 차별화 방안' },
];

const STATUS_ICON: Record<CompetitorWork['status'], string> = {
  pending: '○', analyzing: '⏳', done: '✅', error: '❌',
};

export default function CompetitorAnalysis({ competitors, model, onModelChange, analyzeModelLabel, onAdd, onRemove, onUpdate, onAnalyze }: Props) {
  const [newTitle, setNewTitle] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);  // 상세 모달이 열린 작품 id

  const open = competitors.find((c) => c.id === openId) ?? null;

  function submitAdd() {
    const t = newTitle.trim();
    if (!t) return;
    if (competitors.some((c) => c.title === t)) {
      alert('이미 목록에 있는 작품이에요.');
      return;
    }
    onAdd(t);
    setNewTitle('');
  }

  async function runAnalyze(c: CompetitorWork) {
    if (c.status === 'analyzing') return;
    if (!confirm(`「${c.title}」을(를) 웹 검색으로 분석합니다 (${analyzeModelLabel} 사용, 자동조사 1회와 비슷한 비용). 진행할까요?`)) return;
    await onAnalyze(c.id);
  }

  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
      <p className="text-[11px] font-semibold text-emerald-700">🆚 경쟁작/레퍼런스 분석</p>
      <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
        자동조사 시 유사작품이 자동으로 추가돼요. 레퍼런스 작품을 직접 추가해도 돼요. 각 작품의 &ldquo;분석&rdquo;을 누르면 장점·클리셰·시장 포지션·활용/차별화 방안을 조사해요.
      </p>

      {/* 분석 모델 선택 — 선택한 모델의 provider 안에서 저비용 검색 모델을 씀 */}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[10px] text-gray-500 shrink-0">분석 모델</span>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value as ModelId)}
          className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 outline-none focus:border-emerald-400"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        {/* 고른 모델이 실제 검색 모델과 다를 때만 안내 (같으면 이름이 중복돼 헷갈림) */}
        {MODELS.find((m) => m.id === model)?.label !== analyzeModelLabel && (
          <span className="text-[9px] text-gray-400 shrink-0" title="실제 웹 검색은 선택한 모델과 같은 provider의 저비용 모델로 실행돼요">→ {analyzeModelLabel}</span>
        )}
      </div>

      {/* 작품 리스트 (컴팩트 — 한 줄씩) */}
      {competitors.length > 0 && (
        <div className="mt-2 space-y-1">
          {competitors.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
              <span className="text-[10px] shrink-0" title={c.status === 'done' ? '분석 완료' : c.status === 'analyzing' ? '분석 중' : c.status === 'error' ? '분석 실패' : '미분석'}>
                {STATUS_ICON[c.status]}
              </span>
              <span className="flex-1 min-w-0 truncate text-xs text-gray-800" title={c.reason ? `${c.title} — ${c.reason}` : c.title}>
                {c.title}
              </span>
              {c.status === 'done' ? (
                <button onClick={() => setOpenId(c.id)}
                  className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded border border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition-colors">
                  보기
                </button>
              ) : (
                <button onClick={() => runAnalyze(c)} disabled={c.status === 'analyzing'}
                  className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded border border-emerald-300 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-wait transition-colors">
                  {c.status === 'analyzing' ? '분석 중...' : c.status === 'error' ? '재시도' : '분석'}
                </button>
              )}
              <button onClick={() => { if (confirm(`「${c.title}」을(를) 목록에서 삭제할까요?`)) onRemove(c.id); }}
                className="shrink-0 text-gray-300 hover:text-red-500 text-xs" title="삭제">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* 작품 직접 추가 */}
      <div className="flex gap-1.5 mt-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitAdd(); } }}
          placeholder="레퍼런스 작품명 직접 추가"
          className="flex-1 min-w-0 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
        />
        <button onClick={submitAdd} disabled={!newTitle.trim()}
          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-300 bg-white hover:bg-emerald-50 disabled:opacity-40 text-emerald-700 transition-colors">
          추가
        </button>
      </div>

      {/* ── 상세 분석 모달 ── */}
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={() => setOpenId(null)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-gray-800 truncate">🆚 {open.title}</h3>
                {open.reason && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{open.reason}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => runAnalyze(open)} disabled={open.status === 'analyzing'}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors">
                  {open.status === 'analyzing' ? '분석 중...' : '🔄 재분석'}
                </button>
                <button onClick={() => setOpenId(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {DETAIL_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[11px] font-semibold text-gray-600">{label}</label>
                  <textarea
                    value={String(open[key] ?? '')}
                    onChange={(e) => onUpdate(open.id, { [key]: e.target.value })}
                    rows={key === 'summary' ? 2 : 3}
                    placeholder="분석 결과가 여기에 채워져요 (직접 수정 가능)"
                    className="mt-1 w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-800 leading-relaxed outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all resize-none"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
