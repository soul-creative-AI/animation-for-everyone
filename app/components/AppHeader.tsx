'use client';
import { useState } from 'react';

interface Props {
  title: string;
  saved: boolean;
  onTitleChange: (value: string) => void;
  onSave: () => void;
  onExport: () => void;
  onDelete: () => void;
  onLogout: () => void;
}

export default function AppHeader({ title, saved, onTitleChange, onSave, onExport, onDelete, onLogout }: Props) {
  const [delConfirm, setDelConfirm] = useState(false);

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
        <button onClick={onExport}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gray-800 transition-colors bg-white">
          내보내기
        </button>
        {delConfirm ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">정말 삭제할까요?</span>
            <button onClick={() => { onDelete(); setDelConfirm(false); }} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors">삭제</button>
            <button onClick={() => setDelConfirm(false)} className="px-2.5 py-1 rounded-lg text-xs text-gray-500 hover:text-gray-700 transition-colors">취소</button>
          </div>
        ) : (
          <button onClick={() => setDelConfirm(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 hover:border-red-300 text-gray-400 hover:text-red-500 transition-colors bg-white">
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
