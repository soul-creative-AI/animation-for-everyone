'use client';
import { useState } from 'react';
import type { Project } from '@/types';
import { fmtDate } from '@/lib/project';

interface Props {
  projects: Project[];
  currentId: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onDuplicate: (id: string) => void;
}

export default function Sidebar({ projects, currentId, onNew, onSelect, onReorder, onDuplicate }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }

    const ids = projects.map((p) => p.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { setDragId(null); setDragOverId(null); return; }

    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, dragId);

    setDragId(null);
    setDragOverId(null);
    onReorder(reordered);
  }

  return (
    <aside className="w-56 flex flex-col bg-white border-r border-gray-200 shrink-0">
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100">
        <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white text-xs font-bold shrink-0">AF</div>
        <div>
          <p className="text-xs font-bold text-gray-800 leading-none">Animation</p>
          <p className="text-[10px] text-gray-400 mt-0.5">for Everyone</p>
        </div>
      </div>
      <div className="px-3 pt-3 pb-1">
        <button onClick={onNew} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors">
          <span className="text-base leading-none">+</span>새 프로젝트
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-2 py-1">프로젝트</p>
        {projects.map((p) => (
          <div
            key={p.id}
            draggable
            onDragStart={() => setDragId(p.id)}
            onDragOver={(e) => { e.preventDefault(); if (dragOverId !== p.id) setDragOverId(p.id); }}
            onDragLeave={() => setDragOverId((prev) => (prev === p.id ? null : prev))}
            onDrop={(e) => { e.preventDefault(); handleDrop(p.id); }}
            onDragEnd={() => { setDragId(null); setDragOverId(null); }}
            className={`group relative rounded-lg transition-colors ${
              dragOverId === p.id && dragId !== p.id ? 'ring-2 ring-emerald-300' : ''
            } ${dragId === p.id ? 'opacity-40' : ''}`}
          >
            <button onClick={() => onSelect(p.id)}
              className={`w-full text-left px-3 py-2.5 pr-9 rounded-lg transition-colors cursor-grab active:cursor-grabbing ${p.id === currentId ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <p className={`text-xs truncate ${p.id === currentId ? 'font-semibold' : 'font-medium'}`}>{p.title}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(p.updatedAt)}</p>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate(p.id); }}
              title="이 프로젝트 복제"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-md text-gray-400 opacity-0 group-hover:opacity-100 hover:text-emerald-600 hover:bg-emerald-50 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
