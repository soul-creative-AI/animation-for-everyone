'use client';
import { useEffect, useRef, useState } from 'react';

export type ExportScope = 'research' | 'planning' | 'all';
export type ExportFormat = 'txt' | 'pdf';

interface Props {
  title: string;
  saved: boolean;
  onTitleChange: (value: string) => void;
  onSave: () => void;
  onExport: (scope: ExportScope, format: ExportFormat) => void;
  onDelete: () => void;
  onLogout: () => void;
}

export default function AppHeader({ title, saved, onTitleChange, onSave, onExport, onDelete, onLogout }: Props) {
  const [delConfirm, setDelConfirm] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>('all');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt');
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <header className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-200 shrink-0">
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        className="text-sm font-bold text-gray-800 bg-transparent outline-none border-b border-transparent hover:border-gray-300 focus:border-emerald-400 transition-colors min-w-0 flex-1 max-w-xs"
        placeholder="프로젝트 이름"
      />
      {!saved && <span className="text-[10px] text-amber-500 font-medium shrink-0">● 미저장</span>}
      <div className="flex items-center gap-2 ml-auto shrink-0">
        <button onClick={onSave} disabled={saved}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors">
          저장
        </button>

        <div className="relative" ref={exportRef}>
          <button onClick={() => setExportOpen((o) => !o)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gray-800 transition-colors bg-white">
            내보내기
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-50">
              <p className="text-[10px] font-semibold text-gray-400 mb-1">범위</p>
              <select
                value={exportScope}
                onChange={(e) => setExportScope(e.target.value as ExportScope)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-emerald-400 mb-3"
              >
                <option value="all">전체</option>
                <option value="planning">기획만</option>
                <option value="research">리서치만</option>
              </select>

              <p className="text-[10px] font-semibold text-gray-400 mb-1">형식</p>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-emerald-400 mb-3"
              >
                <option value="txt">텍스트 (.txt)</option>
                <option value="pdf">PDF</option>
              </select>

              <button
                onClick={() => { onExport(exportScope, exportFormat); setExportOpen(false); }}
                className="w-full px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
              >
                내보내기
              </button>
            </div>
          )}
        </div>

        {delConfirm ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">정말 삭제할까요?</span>
            <button onClick={() => { onDelete(); setDelConfirm(false); }} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors">삭제</button>
            <button onClick={() => setDelConfirm(false)} className="px-2.5 py-1 rounded-lg text-xs text-gray-500 hover:text-gray-700 transition-colors">취소</button>
          </div>
        ) : (
          <button onClick={() => setDelConfirm(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-300 hover:border-red-300 text-gray-600 hover:text-red-500 transition-colors bg-white">
            삭제
          </button>
        )}
        <div className="flex items-center gap-3 pl-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-gray-400">AI 연결됨</span>
          </div>
          <button
            onClick={onLogout}
            className="px-2.5 py-1 rounded-lg text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}
