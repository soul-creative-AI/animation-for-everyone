'use client';
import { useMemo, useState } from 'react';
import type { OriginalArchive, ArchiveVolume, ArchiveChapter } from '@/types';

interface Props {
  archive: OriginalArchive;
  onAddVolume: () => void;
  onUpdateVolume: (id: string, patch: Partial<ArchiveVolume>) => void;
  onRemoveVolume: (id: string) => void;
  onAddChapter: (volumeId: string) => void;
  onUpdateChapter: (volumeId: string, chapterId: string, patch: Partial<ArchiveChapter>) => void;
  onRemoveChapter: (volumeId: string, chapterId: string) => void;
  // 원문 텍스트로 그 화의 요약·인물·장면을 AI로 채움
  onSummarizeChapter: (volumeId: string, chapterId: string, sourceText: string) => Promise<boolean>;
}

// 검색어를 강조 표시
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

// ── 화(챕터) 편집 카드 ──
function ChapterCard({
  chapter, onUpdate, onRemove, onSummarize,
}: {
  chapter: ArchiveChapter;
  onUpdate: (patch: Partial<ArchiveChapter>) => void;
  onRemove: () => void;
  onSummarize: (sourceText: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [summarizing, setSummarizing] = useState(false);

  const filled = chapter.summary.trim() || chapter.characters.trim() || chapter.sceneTags.trim();

  async function runSummarize() {
    if (!pasteText.trim() || summarizing) return;
    setSummarizing(true);
    const ok = await onSummarize(pasteText);
    setSummarizing(false);
    if (ok) { setPasteText(''); setPasteOpen(false); setOpen(true); }
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all';

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen((o) => !o)} className="text-gray-400 hover:text-gray-600 text-xs shrink-0 w-4">{open ? '▾' : '▸'}</button>
        <span className="text-[11px] font-semibold text-emerald-600 shrink-0">{chapter.number || '?'}화</span>
        <span className="text-xs text-gray-700 truncate flex-1">{chapter.title || <span className="text-gray-300">제목 없음</span>}</span>
        {filled && <span className="text-[9px] text-emerald-500 shrink-0" title="요약 있음">●</span>}
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 text-xs shrink-0" title="화 삭제">✕</button>
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 pt-2">
          <div className="flex gap-2">
            <input value={chapter.number} onChange={(e) => onUpdate({ number: e.target.value })} placeholder="화" className={`${inputCls} w-16`} />
            <input value={chapter.title} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="제목" className={inputCls} />
          </div>
          <textarea value={chapter.summary} onChange={(e) => onUpdate({ summary: e.target.value })} placeholder="요약" rows={3} className={`${inputCls} resize-none`} />
          <input value={chapter.characters} onChange={(e) => onUpdate({ characters: e.target.value })} placeholder="등장인물 (쉼표로 구분)" className={inputCls} />
          <input value={chapter.sceneTags} onChange={(e) => onUpdate({ sceneTags: e.target.value })} placeholder="핵심 장면 태그 (쉼표로 구분)" className={inputCls} />

          {/* 원문 붙여넣기 → AI 요약 */}
          {pasteOpen ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-2 space-y-2">
              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="이 화의 원문을 붙여넣으세요" rows={4} className={`${inputCls} resize-none`} />
              <div className="flex gap-1.5">
                <button onClick={runSummarize} disabled={summarizing || !pasteText.trim()}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white transition-colors">
                  {summarizing ? 'AI 요약 중...' : '✨ AI로 요약'}
                </button>
                <button onClick={() => { setPasteOpen(false); setPasteText(''); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 transition-colors">
                  취소
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setPasteOpen(true)}
              className="w-full px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-700 transition-colors">
              ✨ 원문 붙여넣어 AI로 요약하기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ArchivePanel({
  archive, onAddVolume, onUpdateVolume, onRemoveVolume,
  onAddChapter, onUpdateChapter, onRemoveChapter, onSummarizeChapter,
}: Props) {
  const [query, setQuery] = useState('');
  const [openVolumes, setOpenVolumes] = useState<Record<string, boolean>>({});

  const totalChapters = useMemo(
    () => archive.volumes.reduce((n, v) => n + v.chapters.length, 0),
    [archive.volumes],
  );

  // 검색: 제목·요약·인물·장면 태그에서 일치하는 화를 (권 라벨과 함께) 평면 목록으로
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
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-gray-800">원작 아카이브</h2>
            <p className="text-xs text-gray-400 mt-0.5">권·화별로 정리하면 검색·발췌가 편해져요 · 총 {archive.volumes.length}권 {totalChapters}화</p>
          </div>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 제목·요약·인물·장면 검색 (예: 첫 각성, 카일렌)"
          className={`${inputCls} mt-3`}
        />
        <p className="text-[10px] text-gray-400 mt-2">💬 &ldquo;~한 장면 몇 화야?&rdquo; 같은 질문은 <b>리서치 탭 채팅</b>에서 물어보면 이 아카이브를 근거로 답해드려요.</p>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* 검색 결과 모드 */}
        {matches !== null ? (
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
          /* 편집 모드 (권 아코디언) */
          <div className="space-y-3">
            {archive.volumes.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-sm">아직 등록된 권이 없어요.</p>
                <p className="text-xs mt-1">&ldquo;권 추가&rdquo;로 시작하고, 각 화에 원문을 붙여넣으면 AI가 요약해드려요.</p>
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
                      {v.chapters.map((c) => (
                        <ChapterCard
                          key={c.id}
                          chapter={c}
                          onUpdate={(patch) => onUpdateChapter(v.id, c.id, patch)}
                          onRemove={() => onRemoveChapter(v.id, c.id)}
                          onSummarize={(text) => onSummarizeChapter(v.id, c.id, text)}
                        />
                      ))}
                      <button onClick={() => onAddChapter(v.id)}
                        className="w-full px-3 py-1.5 rounded-lg text-xs font-semibold border border-dashed border-gray-300 text-gray-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors">
                        + 화 추가
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={onAddVolume}
              className="w-full px-3 py-2.5 rounded-xl text-sm font-semibold border border-dashed border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition-colors">
              + 권 추가
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
