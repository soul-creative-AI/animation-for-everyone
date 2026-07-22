'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OriginalArchive, ArchiveVolume, ArchiveChapter, Message } from '@/types';
import { MODELS, type ModelId } from '@/lib/models';

interface Props {
  archive: OriginalArchive;
  model: ModelId;
  onModelChange: (m: ModelId) => void;
  onUpdateVolume: (id: string, patch: Partial<ArchiveVolume>) => void;
  onRemoveVolume: (id: string) => void;
  onUpdateChapter: (volumeId: string, chapterId: string, patch: Partial<ArchiveChapter>) => void;
  onRemoveChapter: (volumeId: string, chapterId: string) => void;
  // 원문(파일/텍스트)을 AI로 화 단위 자동 분할해 새 권으로 추가 (권 번호는 자동)
  onAutoSplit: (opts: { file?: File; text?: string }) => Promise<boolean>;
  // 아카이브 Q&A 채팅 ("~한 장면 몇 화야?")
  messages: Message[];
  chatLoading: boolean;
  onAsk: (text: string) => Promise<void>;
}

// 검색어 강조
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <>{text}</>;
  const q = query.trim();
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// ── 원문 업로드 → 화 자동 정리 (핵심 액션) ──
function AutoSplitBox({ model, onModelChange, onAutoSplit }: {
  model: ModelId;
  onModelChange: (m: ModelId) => void;
  onAutoSplit: (opts: { file?: File; text?: string }) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dragOver, setDragOver] = useState(false);

  async function runFile(file: File) {
    if (busy) return;
    setBusy(true);
    await onAutoSplit({ file });
    setBusy(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) runFile(file);
  }
  async function runPaste() {
    if (busy || !pasteText.trim()) return;
    setBusy(true);
    const ok = await onAutoSplit({ text: pasteText });
    setBusy(false);
    if (ok) { setPasteText(''); setShowPaste(false); }
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <p className="text-sm font-semibold text-emerald-800">📄 원문 올려서 화 자동 정리</p>
      <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
        원작 파일(txt·pdf)을 올리면 AI가 화(챕터)별로 나눠 요약·인물·장면까지 정리하고, 리서치 정보도 함께 채워요. 한 번 올릴 때 <b>한 권 분량</b>씩 권장해요. 권 번호는 올린 순서대로 자동 지정돼요.
      </p>

      {/* 모델 선택 */}
      <div className="flex items-center gap-2 mt-3">
        <span className="text-[11px] text-gray-500">정리 모델</span>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value as ModelId)}
          disabled={busy}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 outline-none focus:border-emerald-400 disabled:opacity-50"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* 파일 선택/드롭 (선택·드롭 즉시 자동 실행) */}
      <label
        onDragOver={(e) => { if (!busy) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`mt-3 flex flex-col items-center justify-center gap-0.5 w-full px-3 py-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
          busy ? 'border-gray-200 text-gray-300 cursor-not-allowed'
          : dragOver ? 'border-emerald-500 bg-emerald-100 text-emerald-700'
          : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
        }`}>
        <span className="text-sm font-semibold">{busy ? '자동 정리 중... (분량에 따라 시간이 걸려요)' : dragOver ? '여기에 놓으면 정리 시작' : '＋ 원문 파일 선택'}</span>
        {!busy && <span className="text-[10px] text-gray-400">파일을 끌어다 놓거나 클릭해서 선택 (txt · pdf)</span>}
        <input type="file" accept=".txt,.md,.pdf,text/plain,application/pdf" className="hidden" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) runFile(f); e.target.value = ''; }} />
      </label>

      {/* 텍스트 붙여넣기 (보조) */}
      {!showPaste ? (
        <button onClick={() => setShowPaste(true)} disabled={busy}
          className="mt-2 text-[11px] text-emerald-600 hover:underline disabled:opacity-50">
          또는 텍스트 붙여넣기
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4} placeholder="원문을 붙여넣으세요 (한 권 분량)"
            className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 resize-none" />
          <div className="flex gap-1.5">
            <button onClick={runPaste} disabled={busy || !pasteText.trim()}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white transition-colors">
              {busy ? '정리 중...' : '✨ 자동 정리'}
            </button>
            <button onClick={() => { setShowPaste(false); setPasteText(''); }} disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 transition-colors">
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 화(챕터) 표시 + 인라인 수정 (수동 추가는 없음, AI 결과 보정용) ──
function ChapterCard({ chapter, onUpdate, onRemove }: {
  chapter: ArchiveChapter;
  onUpdate: (patch: Partial<ArchiveChapter>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all';

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen((o) => !o)} className="text-gray-400 hover:text-gray-600 text-xs shrink-0 w-4">{open ? '▾' : '▸'}</button>
        <span className="text-[11px] font-semibold text-emerald-600 shrink-0">{chapter.number || '?'}화</span>
        <span className="text-xs text-gray-700 truncate flex-1">{chapter.title || <span className="text-gray-300">제목 없음</span>}</span>
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 text-xs shrink-0" title="화 삭제">✕</button>
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 pt-2">
          <div className="flex gap-2">
            <input value={chapter.number} onChange={(e) => onUpdate({ number: e.target.value })} placeholder="화" className={`${inputCls} w-16`} />
            <input value={chapter.title} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="제목" className={inputCls} />
          </div>
          <textarea value={chapter.summary} onChange={(e) => onUpdate({ summary: e.target.value })} placeholder="요약" rows={3} className={`${inputCls} resize-none`} />
          <input value={chapter.characters} onChange={(e) => onUpdate({ characters: e.target.value })} placeholder="등장인물" className={inputCls} />
          <input value={chapter.sceneTags} onChange={(e) => onUpdate({ sceneTags: e.target.value })} placeholder="핵심 장면 태그" className={inputCls} />
        </div>
      )}
    </div>
  );
}

export default function ArchivePanel({
  archive, model, onModelChange, onUpdateVolume, onRemoveVolume, onUpdateChapter, onRemoveChapter, onAutoSplit,
  messages, chatLoading, onAsk,
}: Props) {
  const [query, setQuery] = useState('');
  const [openVolumes, setOpenVolumes] = useState<Record<string, boolean>>({});
  const [chatInput, setChatInput] = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function submitChat() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput('');
    await onAsk(text);
  }

  const totalChapters = useMemo(
    () => archive.volumes.reduce((n, v) => n + v.chapters.length, 0),
    [archive.volumes],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const out: { volume: ArchiveVolume; chapter: ArchiveChapter }[] = [];
    for (const v of archive.volumes) {
      for (const c of v.chapters) {
        const hay = `${c.number} ${c.title} ${c.summary} ${c.characters} ${c.sceneTags}`.toLowerCase();
        if (hay.includes(q)) out.push({ volume: v, chapter: c });
      }
    }
    return out;
  }, [query, archive.volumes]);

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all';

  return (
    <div className="w-full h-full flex flex-col bg-white overflow-hidden">
      {/* 헤더 */}
      <div className="px-6 py-4 border-b border-gray-100 shrink-0">
        <div>
          <h2 className="text-sm font-bold text-gray-800">원작 아카이브</h2>
          <p className="text-xs text-gray-400 mt-0.5">원문을 올리면 화별로 자동 정리돼요 · 총 {archive.volumes.length}권 {totalChapters}화</p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 제목·요약·인물·장면 검색 (예: 첫 각성, 카일렌)"
          className={`${inputCls} mt-3`}
        />
        <p className="text-[10px] text-gray-400 mt-2">💬 &ldquo;~한 장면 몇 화야?&rdquo; 같은 질문은 아래 <b>아카이브 채팅</b>에서 물어보면 이 아카이브를 근거로 답해드려요.</p>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {matches !== null ? (
          /* 검색 결과 */
          <div className="space-y-2">
            <p className="text-[11px] text-gray-500 mb-2">검색 결과 {matches.length}개</p>
            {matches.length === 0 && <p className="text-xs text-gray-400">일치하는 화가 없어요.</p>}
            {matches.map(({ volume, chapter }) => (
              <div key={chapter.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-[11px] font-semibold text-emerald-600">
                  {volume.number || '?'}권 {chapter.number || '?'}화
                  {chapter.title && <span className="text-gray-700 font-normal"> · <Highlight text={chapter.title} query={query} /></span>}
                </p>
                {chapter.summary && <p className="text-xs text-gray-600 mt-1 leading-relaxed"><Highlight text={chapter.summary} query={query} /></p>}
                {(chapter.characters || chapter.sceneTags) && (
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    {chapter.characters && <span>👤 <Highlight text={chapter.characters} query={query} /></span>}
                    {chapter.characters && chapter.sceneTags && <span className="mx-1">·</span>}
                    {chapter.sceneTags && <span>🎬 <Highlight text={chapter.sceneTags} query={query} /></span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          /* 정리 화면 */
          <div className="space-y-3">
            <AutoSplitBox model={model} onModelChange={onModelChange} onAutoSplit={onAutoSplit} />
            {archive.volumes.length === 0 && (
              <div className="text-center py-10 text-gray-400">
                <p className="text-sm">아직 정리된 원작이 없어요.</p>
                <p className="text-xs mt-1">위에서 원문 파일을 올리면 AI가 화별로 자동 정리해요.</p>
              </div>
            )}
            {archive.volumes.map((v) => {
              const isOpen = openVolumes[v.id] ?? true;
              return (
                <div key={v.id} className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50">
                    <button onClick={() => setOpenVolumes((s) => ({ ...s, [v.id]: !isOpen }))} className="text-gray-400 hover:text-gray-600 text-xs shrink-0 w-4">{isOpen ? '▾' : '▸'}</button>
                    <input value={v.number} onChange={(e) => onUpdateVolume(v.id, { number: e.target.value })} placeholder="권" className="w-12 bg-white border border-gray-200 rounded px-2 py-1 text-xs font-semibold text-emerald-700 outline-none focus:border-emerald-400" />
                    <span className="text-xs text-gray-400 shrink-0">권</span>
                    <input value={v.title} onChange={(e) => onUpdateVolume(v.id, { title: e.target.value })} placeholder="권 제목 (선택)" className="flex-1 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 outline-none focus:border-emerald-400" />
                    <span className="text-[10px] text-gray-400 shrink-0">{v.chapters.length}화</span>
                    <button onClick={() => onRemoveVolume(v.id)} className="text-gray-300 hover:text-red-500 text-xs shrink-0" title="권 삭제">✕</button>
                  </div>
                  {isOpen && (
                    <div className="p-3 space-y-2">
                      {v.chapters.length === 0 && <p className="text-[11px] text-gray-400 text-center py-2">이 권에는 정리된 화가 없어요.</p>}
                      {v.chapters.map((c) => (
                        <ChapterCard
                          key={c.id}
                          chapter={c}
                          onUpdate={(patch) => onUpdateChapter(v.id, c.id, patch)}
                          onRemove={() => onRemoveChapter(v.id, c.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 아카이브 Q&A 채팅 (아래 고정) */}
      <div className="shrink-0 border-t border-gray-200 bg-gray-50/60 flex flex-col" style={{ height: 300 }}>
        <div className="px-6 pt-3 pb-1 shrink-0 flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-gray-700">💬 아카이브 채팅</p>
            <p className="text-[10px] text-gray-400 mt-0.5">정리된 권/화를 근거로 답해요. 예: &ldquo;주인공이 각성하는 장면 몇 화야?&rdquo;</p>
          </div>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value as ModelId)}
            disabled={chatLoading}
            title="답변에 사용할 모델"
            className="shrink-0 text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 outline-none focus:border-emerald-400 disabled:opacity-50"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* 메시지 목록 */}
        <div className="flex-1 overflow-y-auto px-6 py-2 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex items-end gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[9px] font-bold shrink-0">AI</div>
              )}
              <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap shadow-sm ${
                m.role === 'user' ? 'bg-emerald-500 text-white rounded-br-sm' : 'bg-white text-gray-700 border border-gray-100 rounded-bl-sm'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex items-end gap-2">
              <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[9px] font-bold shrink-0">AI</div>
              <div className="bg-white border border-gray-100 px-3 py-2 rounded-2xl rounded-bl-sm shadow-sm">
                <div className="flex gap-1">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* 입력 */}
        <div className="px-6 py-3 shrink-0 flex gap-2 items-end">
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitChat(); } }}
            rows={1}
            placeholder="아카이브에 물어보기... (Shift+Enter로 줄바꿈)"
            className="flex-1 resize-none bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs text-gray-800 placeholder-gray-400 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
          />
          <button onClick={submitChat} disabled={!chatInput.trim() || chatLoading}
            className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl transition-colors shrink-0">
            전송
          </button>
        </div>
      </div>
    </div>
  );
}
