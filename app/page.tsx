'use client';

import { useState, useEffect, useRef } from 'react';
import type {
  Message, PlanningData, PlanningStatuses,
  ResearchData, ResearchStatuses, ResearchMode,
  ProjectTab, Project, UploadedSource, Proposal, PendingChange,
  WorkType,
} from '@/types';
import { defaultPlanningData, defaultResearchData } from '@/types';
import { PLANNING_FIRST, RESEARCH_FIRST, getMockResearchResponse, getMockProposals } from '@/lib/mock';
import { createClient } from '@/lib/supabase/client';
import { useProjects } from '@/lib/hooks/useProjects';
import PlanningPanel from './components/PlanningPanel';
import ResearchPanel from './components/ResearchPanel';
import AttachmentCard from './components/AttachmentCard';
import ProposalCard from './components/ProposalCard';
import ChangeProposalCard from './components/ChangeProposalCard';
import AuthModal from './components/AuthModal';

// ── 모델 목록 ──────────────────────────────────────────────────
const MODELS = [
  { id: 'gemini',        label: 'Gemini Flash',   desc: '빠름' },
  { id: 'claude-haiku',  label: 'Claude Haiku',   desc: '저렴' },
  { id: 'claude-sonnet', label: 'Claude Sonnet',  desc: '스마트' },
  { id: 'claude-fable',  label: 'Claude Fable 5', desc: '창의적' },
  { id: 'gpt-4o-mini',   label: 'GPT-4o mini',    desc: '저렴' },
  { id: 'gpt-4o',        label: 'GPT-4o',         desc: '고성능' },
  { id: 'gpt-4.5',       label: 'GPT-4.5',        desc: '최신' },
  { id: 'gpt-5.6-sol',   label: 'GPT-5.6 Sol',    desc: '최신' },
  { id: 'gpt-5.6-luna',  label: 'GPT-5.6 Luna',   desc: '최신' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra',  desc: '최신' },
] as const;
type ModelId = (typeof MODELS)[number]['id'];


// ── 구버전 데이터 마이그레이션 ─────────────────────────────────
function migrateProject(raw: any): Project {
  const p = raw.planning ?? {};

  // workType: projectType 문자열 → WorkType enum
  let workType: WorkType = 'undecided';
  if (p.workType) {
    workType = p.workType;
  } else if (p.projectType) {
    const pt: string = p.projectType;
    if (pt.includes('시리즈') || pt.toLowerCase().includes('series')) workType = 'series';
    else if (pt.includes('장편') || pt.includes('극장') || pt.toLowerCase().includes('feature')) workType = 'feature';
    else if (pt.includes('오리지널') || pt.toLowerCase().includes('original')) workType = 'original';
    else if (pt.includes('각색') || pt.toLowerCase().includes('adaptation')) workType = 'adaptation';
  }

  // targetAudience: 구버전 target 문자열 또는 객체 → 단일 문자열
  let targetAudience = '';
  if (typeof p.targetAudience === 'string') {
    targetAudience = p.targetAudience;
  } else if (p.targetAudience && typeof p.targetAudience === 'object') {
    // 이전 객체 구조에서 마이그레이션
    const parts = [p.targetAudience.age, p.targetAudience.preference, p.targetAudience.viewingContext].filter(Boolean);
    targetAudience = parts.join(', ');
  } else if (typeof p.target === 'string') {
    targetAudience = p.target;
  }

  const planning: PlanningData = {
    title:        p.title        ?? '',
    workType,
    genre:        p.genre        ?? '',
    tone:         p.tone         ?? '',
    logline:      p.logline      ?? '',
    theme:        p.theme        ?? '',
    synopsis:     p.synopsis     ?? '',
    visualStyle:  p.visualStyle  ?? p.style ?? '',
    targetAudience,
    episodeCount: p.episodeCount ?? '',
    runtime:      p.runtime      ?? '',
    protagonist:  p.protagonist  ?? '',
    keyCharacters: p.keyCharacters ?? p.characters ?? '',
  };

  return {
    id:           raw.id           ?? crypto.randomUUID(),
    title:        raw.title        ?? '새 프로젝트',
    createdAt:    raw.createdAt    ?? new Date().toISOString(),
    updatedAt:    raw.updatedAt    ?? new Date().toISOString(),
    sortOrder:    raw.sortOrder    ?? 0,
    selectedTab:  raw.selectedTab  ?? 'planning',
    planningMessages: raw.planningMessages ?? raw.messages ?? [{ role: 'assistant', content: PLANNING_FIRST }],
    planning,
    planningStatuses: raw.planningStatuses ?? {},
    researchMessages: raw.researchMessages ?? [{ role: 'assistant', content: RESEARCH_FIRST }],
    research:       raw.research       ?? { ...defaultResearchData },
    researchStatuses: raw.researchStatuses ?? {},
    researchMode:   raw.researchMode   ?? 'original',
    uploadedSources: raw.uploadedSources ?? [],
    pendingChanges: raw.pendingChanges  ?? [],
  };
}

function createProject(): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), title: '새 프로젝트', createdAt: now, updatedAt: now,
    sortOrder: 0,
    selectedTab: 'research',
    planningMessages: [{ role: 'assistant', content: PLANNING_FIRST }],
    planning: { ...defaultPlanningData },
    planningStatuses: {},
    researchMessages: [{ role: 'assistant', content: RESEARCH_FIRST }],
    research: { ...defaultResearchData },
    researchStatuses: {},
    researchMode: 'original',
    uploadedSources: [],
    pendingChanges: [],
  };
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── 컴포넌트 ───────────────────────────────────────────────────
export default function Home() {
  // 인증 상태
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Supabase에서 프로젝트 로드
  const { projects, loading: projectsLoading, saveProject, deleteProject, createNewProject, reorderProjects } = useProjects(userId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 현재 프로젝트
  const [currentId, setCurrentId]   = useState('');
  const [title, setTitle]           = useState('새 프로젝트');
  const [saved, setSaved]           = useState(true);
  const [delConfirm, setDelConfirm] = useState(false);

  // 탭
  const [tab, setTab] = useState<ProjectTab>('research');

  // 기획 탭 상태
  const [planningMsgs, setPlanningMsgs]         = useState<Message[]>([{ role: 'assistant', content: PLANNING_FIRST }]);
  const [planning, setPlanning]                  = useState<PlanningData>({ ...defaultPlanningData });
  const [planningStatuses, setPlanningStatuses]  = useState<PlanningStatuses>({});

  // 리서치 탭 상태
  const [researchMsgs, setResearchMsgs]         = useState<Message[]>([{ role: 'assistant', content: RESEARCH_FIRST }]);
  const [research, setResearch]                  = useState<ResearchData>({ ...defaultResearchData });
  const [researchStatuses, setResearchStatuses]  = useState<ResearchStatuses>({});
  const [researchMode, setResearchMode]          = useState<ResearchMode>('original');
  const [uploadedSources, setUploadedSources]    = useState<UploadedSource[]>([]);
  const [pendingChanges, setPendingChanges]      = useState<PendingChange[]>([]);
  const [researchTurn, setResearchTurn]          = useState(0);

  // UI
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [model, setModel]         = useState<ModelId>('gemini');
  const [modelOpen, setModelOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachMode, setAttachMode] = useState<'link' | 'text' | null>(null);
  const [attachInput, setAttachInput] = useState('');

  const bottomRef   = useRef<HTMLDivElement>(null);
  const modelRef    = useRef<HTMLDivElement>(null);
  const attachRef   = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 현재 탭 메시지
  const messages    = tab === 'planning' ? planningMsgs    : researchMsgs;
  const setMessages = tab === 'planning' ? setPlanningMsgs : setResearchMsgs;

  /* ── 초기화: 인증 상태 확인 ── */
  useEffect(() => {
    async function checkAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user.id) {
          setUserId(session.user.id);
        } else {
          setShowAuth(true);
        }
      } catch (e) {
        console.error('Auth check failed:', e);
        setShowAuth(true);
      } finally {
        setAuthLoading(false);
      }
    }
    checkAuth();
  }, []);

  /* ── 프로젝트 로드 후 첫 번째 선택 ── */
  useEffect(() => {
    if (projects.length > 0 && !currentId) {
      applyProject(projects[0]);
    }
  }, [projects]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
      if (attachRef.current && !attachRef.current.contains(e.target as Node)) { setAttachOpen(false); setAttachMode(null); }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  /* ── 프로젝트 로드 ── */
  function applyProject(p: Project) {
    setCurrentId(p.id);
    setTitle(p.title);
    setTab(p.selectedTab);
    setPlanningMsgs([...p.planningMessages]);
    setPlanning({ ...p.planning });
    setPlanningStatuses({ ...p.planningStatuses });
    setResearchMsgs([...p.researchMessages]);
    setResearch({ ...p.research });
    setResearchStatuses({ ...p.researchStatuses });
    setResearchMode(p.researchMode);
    setUploadedSources([...p.uploadedSources]);
    setPendingChanges([...p.pendingChanges]);
    setResearchTurn(0);
    setSaved(true);
    setDelConfirm(false);
  }

  function selectProject(id: string) {
    const p = projects.find((x) => x.id === id);
    if (p) applyProject(p);
  }

  /* ── 프로젝트 순서 변경 (드래그 앤 드롭) ── */
  function handleDropReorder(targetId: string) {
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
    reorderProjects(reordered).catch((e) => {
      console.error('Reorder failed:', e);
      alert('순서 저장에 실패했습니다');
    });
  }

  /* ── CRUD ── */
  async function handleNew() {
    const p = createProject();
    try {
      await createNewProject(p);
      applyProject(p);
    } catch (e) {
      console.error('Create failed:', e);
      alert('프로젝트 생성에 실패했습니다');
    }
  }

  async function handleSave() {
    const now = new Date().toISOString();
    const updated: Project = {
      id: currentId,
      title,
      createdAt: projects.find((p) => p.id === currentId)?.createdAt || now,
      updatedAt: now,
      sortOrder: projects.find((p) => p.id === currentId)?.sortOrder ?? 0,
      selectedTab: tab,
      planningMessages: planningMsgs,
      planning: { ...planning },
      planningStatuses: { ...planningStatuses },
      researchMessages: researchMsgs,
      research: { ...research },
      researchStatuses: { ...researchStatuses },
      researchMode,
      uploadedSources: [...uploadedSources],
      pendingChanges: [...pendingChanges],
    };
    try {
      await saveProject(updated);
      setSaved(true);
    } catch (e) {
      console.error('Save failed:', e);
      alert('저장에 실패했습니다');
    }
  }

  async function handleDelete() {
    try {
      await deleteProject(currentId);
      // 남은 프로젝트가 있으면 첫 번째를 열고, 없으면 새로 만들기
      const remaining = projects.filter((p) => p.id !== currentId);
      if (remaining.length === 0) {
        const fresh = createProject();
        await createNewProject(fresh);
      } else {
        applyProject(remaining[0]);
      }
    } catch (e) {
      console.error('Delete failed:', e);
      alert('삭제에 실패했습니다');
    }
  }

  function handleExport() {
    const lines = [`# ${title}`, '', '## 기획 정보', '',
      ...Object.entries(planning).filter(([, v]) => v).map(([k, v]) => `**${k}**: ${v}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${title}.txt` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  /* ── 기획 탭: AI 전송 ── */
  async function sendPlanning(userMsg: Message, next: Message[]) {
    try {
      const res  = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, model }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPlanningMsgs((prev) => [...prev, { role: 'assistant', content: data.text }]);
      if (data.extracted) {
        const ext = data.extracted as Record<string, any>;
        // 사용자가 확정한 필드는 이후 AI 추출로 덮어쓰지 않음
        const keys = Object.keys(ext).filter((k) => ext[k] && planningStatuses[k] !== 'confirmed');
        setPlanningStatuses((prev) => {
          const s = { ...prev };
          for (const k of keys) s[k] = 'inferred';
          return s;
        });
        setPlanning((prev) => {
          const u = { ...prev };
          for (const k of keys) (u as any)[k] = ext[k];
          return u;
        });
      }
    } catch {
      setPlanningMsgs((prev) => [...prev, { role: 'assistant', content: '오류가 발생했습니다. 다시 시도해주세요.' }]);
    }
  }

  /* ── 리서치 탭: mock 전송 ── */
  function sendResearch(next: Message[]) {
    const userText = next[next.length - 1].content;
    const result = getMockResearchResponse(userText, researchTurn);
    setResearchTurn((t) => t + 1);

    setTimeout(() => {
      const msgs: Message[] = [];

      // 텍스트 응답
      if (result.text) msgs.push({ role: 'assistant', content: result.text });

      // 리서치 필드 채우기
      if (result.extractedResearch) {
        setResearch((prev) => {
          const u = { ...prev };
          for (const [k, v] of Object.entries(result.extractedResearch!) as [keyof ResearchData, string][]) {
            if (v) u[k] = v;
          }
          return u;
        });
        setResearchStatuses((prev) => {
          const s = { ...prev };
          for (const k of Object.keys(result.extractedResearch!) as (keyof ResearchData)[]) {
            s[k] = 'inferred';
          }
          return s;
        });
      }

      // 변경 제안 카드
      if (result.pendingChange) {
        const change = result.pendingChange;
        msgs.push({ role: 'assistant', content: '', card: { type: 'change-proposal', change } });
        setPendingChanges((prev) => [...prev, change]);
      }

      // A/B/C 제안 카드
      if (result.proposals) {
        msgs.push({ role: 'assistant', content: '', card: { type: 'proposal', proposals: result.proposals } });
      }

      setResearchMsgs((prev) => [...prev, ...msgs]);
      setSaved(false);
      setLoading(false);
    }, 900);
  }

  /* ── 공통 전송 ── */
  async function send() {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setSaved(false);
    if (tab === 'planning') {
      await sendPlanning(userMsg, next);
      setLoading(false);
    } else {
      sendResearch(next);
    }
  }

  /* ── 첨부 처리 ── */
  function addSource(type: UploadedSource['type'], name: string) {
    const src: UploadedSource = {
      id: crypto.randomUUID(), type, name,
      uploadStatus: 'uploading', analysisStatus: 'pending',
    };
    setUploadedSources((prev) => [...prev, src]);
    setResearchMsgs((prev) => [...prev, { role: 'user', content: '', card: { type: 'attachment', source: src } }]);
    setSaved(false);

    // mock: 업로드 → 분석 완료
    setTimeout(() => {
      setUploadedSources((prev) => prev.map((s) => s.id === src.id ? { ...s, uploadStatus: 'done', analysisStatus: 'analyzing' } : s));
      setResearchMsgs((prev) => prev.map((m) =>
        m.card?.type === 'attachment' && m.card.source.id === src.id
          ? { ...m, card: { type: 'attachment', source: { ...src, uploadStatus: 'done', analysisStatus: 'analyzing' } } }
          : m
      ));
    }, 800);
    setTimeout(() => {
      setUploadedSources((prev) => prev.map((s) => s.id === src.id ? { ...s, analysisStatus: 'done' } : s));
      setResearchMsgs((prev) => prev.map((m) =>
        m.card?.type === 'attachment' && m.card.source.id === src.id
          ? { ...m, card: { type: 'attachment', source: { ...src, uploadStatus: 'done', analysisStatus: 'done' } } }
          : m
      ));
    }, 2000);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) addSource('file', file.name);
    e.target.value = '';
    setAttachOpen(false);
  }

  function submitAttach() {
    if (!attachInput.trim()) return;
    addSource(attachMode === 'link' ? 'link' : 'text', attachInput.trim());
    setAttachInput(''); setAttachMode(null); setAttachOpen(false);
  }

  /* ── 기획 변경 적용 ── */
  function applyChange(fieldKey: keyof PlanningData, value: string) {
    setPlanning((prev) => ({ ...prev, [fieldKey]: value }));
    setPlanningStatuses((prev) => ({ ...prev, [fieldKey]: 'suggested' }));
    setPendingChanges((prev) => prev.filter((c) => c.fieldKey !== fieldKey));
    setSaved(false);
  }

  function dismissChange(id: string) {
    setPendingChanges((prev) => prev.filter((c) => c.id !== id));
  }

  function applyProposal(fields: Partial<PlanningData>) {
    setPlanning((prev) => ({ ...prev, ...fields }));
    setPlanningStatuses((prev) => {
      const s = { ...prev };
      for (const k of Object.keys(fields) as (keyof PlanningData)[]) s[k] = 'suggested';
      return s;
    });
    setTab('planning');
    setSaved(false);
  }

  function handlePlanningFieldChange(key: keyof PlanningData, value: string) {
    setPlanning((prev) => ({ ...prev, [key]: value }));
    // 타이핑만으로는 확정하지 않음. AI 추정/변경 제안 배지는 사용자가 손대면 제거(작성 중).
    setPlanningStatuses((prev) => {
      if (prev[key] === 'inferred' || prev[key] === 'suggested') {
        const s = { ...prev };
        delete s[key];
        return s;
      }
      return prev;
    });
    setSaved(false);
  }

  function togglePlanningConfirm(key: keyof PlanningData) {
    setPlanningStatuses((prev) => {
      const s = { ...prev };
      if (s[key] === 'confirmed') delete s[key];
      else s[key] = 'confirmed';
      return s;
    });
    setSaved(false);
  }

  function handleResearchFieldChange(key: keyof ResearchData, value: string) {
    setResearch((prev) => ({ ...prev, [key]: value }));
    setResearchStatuses((prev) => ({ ...prev, [key]: 'confirmed' }));
    setSaved(false);
  }

  // episodeCount, runtime 제외한 필드 기준 완성도 계산
  const COMPLETION_KEYS: (keyof PlanningData)[] =
    ['title', 'workType', 'genre', 'tone', 'logline', 'theme', 'synopsis', 'visualStyle', 'targetAudience', 'protagonist', 'keyCharacters'];
  const filledCount = COMPLETION_KEYS.filter((k) => {
    const v = planning[k];
    return v && v !== 'undecided';
  }).length;
  const pct = Math.round(filledCount / COMPLETION_KEYS.length * 100);

  // 로그아웃 핸들러
  async function handleLogout() {
    try {
      await supabase.auth.signOut();
      setUserId(null);
      setShowAuth(true);
    } catch (e) {
      console.error('Logout failed:', e);
    }
  }

  // 로딩 또는 인증 필요
  if (authLoading || projectsLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 rounded-lg bg-emerald-500 flex items-center justify-center text-white text-lg font-bold mx-auto mb-4">AF</div>
          <p className="text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (showAuth) {
    return <AuthModal onAuthSuccess={() => { setShowAuth(false); }} />;
  }

  // ── 렌더 ──────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-gray-50 text-gray-800 font-sans">

      {/* ── 사이드바 ── */}
      <aside className="w-56 flex flex-col bg-white border-r border-gray-200 shrink-0">
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white text-xs font-bold shrink-0">AF</div>
          <div>
            <p className="text-xs font-bold text-gray-800 leading-none">Animation</p>
            <p className="text-[10px] text-gray-400 mt-0.5">for Everyone</p>
          </div>
        </div>
        <div className="px-3 pt-3 pb-1">
          <button onClick={handleNew} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors">
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
              onDrop={(e) => { e.preventDefault(); handleDropReorder(p.id); }}
              onDragEnd={() => { setDragId(null); setDragOverId(null); }}
              className={`rounded-lg transition-colors ${
                dragOverId === p.id && dragId !== p.id ? 'ring-2 ring-emerald-300' : ''
              } ${dragId === p.id ? 'opacity-40' : ''}`}
            >
              <button onClick={() => selectProject(p.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-grab active:cursor-grabbing ${p.id === currentId ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <p className={`text-xs truncate ${p.id === currentId ? 'font-semibold' : 'font-medium'}`}>{p.title}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(p.updatedAt)}</p>
              </button>
            </div>
          ))}
        </div>
        <div className="px-4 py-4 border-t border-gray-100">
          <p className="text-[10px] text-gray-400 mb-1.5 font-medium uppercase tracking-wide">기획 완성도</p>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-emerald-600 font-semibold mt-1.5">{pct}%</p>
        </div>
      </aside>

      {/* ── 중앙 + 우측 ── */}
      <div className="flex flex-col flex-1" style={{ minWidth: 0 }}>

        {/* 헤더 */}
        <header className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-200 shrink-0">
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setSaved(false); }}
            className="text-sm font-bold text-gray-800 bg-transparent outline-none border-b border-transparent hover:border-gray-300 focus:border-emerald-400 transition-colors min-w-0 flex-1 max-w-xs"
            placeholder="프로젝트 이름"
          />
          {!saved && <span className="text-[10px] text-amber-500 font-medium shrink-0">● 미저장</span>}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button onClick={handleSave} disabled={saved}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors">
              저장
            </button>
            <button onClick={handleExport}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gray-800 transition-colors bg-white">
              내보내기
            </button>
            {delConfirm ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">정말 삭제할까요?</span>
                <button onClick={handleDelete} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors">삭제</button>
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
                onClick={handleLogout}
                className="px-2.5 py-1 rounded-lg text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                로그아웃
              </button>
            </div>
          </div>
        </header>

        {/* 탭 바 */}
        <div className="flex items-center gap-1 px-6 border-b border-gray-200 bg-white shrink-0">
          {(['research', 'planning'] as ProjectTab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 -mb-px ${
                tab === t ? 'text-emerald-600 border-emerald-500' : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t === 'planning' ? '기획' : '리서치'}
            </button>
          ))}
          {['시리즈 구성', '시나리오'].map((t) => (
            <div key={t} className="flex items-center gap-1 px-4 py-2.5">
              <span className="text-xs text-gray-300 cursor-not-allowed">{t}</span>
              <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">준비 중</span>
            </div>
          ))}
        </div>

        {/* 콘텐츠 영역 (채팅 + 우측 패널) */}
        <div className="flex flex-1 overflow-hidden">

          {/* 채팅 패널 */}
          <div className="flex flex-col flex-1" style={{ minWidth: 0 }}>
            {/* 메시지 목록 */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {messages.map((m, i) => {
                if (m.card?.type === 'attachment') {
                  return (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <AttachmentCard
                        source={m.card.source}
                        onDelete={(id) => {
                          setUploadedSources((prev) => prev.filter((s) => s.id !== id));
                          setResearchMsgs((prev) => prev.filter((_, idx) => idx !== i));
                        }}
                      />
                    </div>
                  );
                }
                if (m.card?.type === 'proposal') {
                  return (
                    <div key={i} className="flex justify-start">
                      <ProposalCard
                        proposals={m.card.proposals}
                        onApply={applyProposal}
                        onRegenerate={() => {
                          setResearchMsgs((prev) => [
                            ...prev,
                            { role: 'assistant', content: '새로운 방향을 제안할게요.', card: { type: 'proposal', proposals: getMockProposals() } },
                          ]);
                        }}
                      />
                    </div>
                  );
                }
                if (m.card?.type === 'change-proposal') {
                  return (
                    <div key={i} className="flex justify-start">
                      <ChangeProposalCard
                        change={m.card.change}
                        onApply={applyChange}
                        onDismiss={dismissChange}
                      />
                    </div>
                  );
                }
                // 일반 텍스트
                if (!m.content) return null;
                return (
                  <div key={i} className={`flex items-end gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    {m.role === 'assistant' && (
                      <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">AI</div>
                    )}
                    <div className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${
                      m.role === 'user' ? 'bg-emerald-500 text-white rounded-br-sm' : 'bg-white text-gray-700 border border-gray-100 rounded-bl-sm'
                    }`}>
                      {m.content}
                    </div>
                  </div>
                );
              })}
              {loading && (
                <div className="flex items-end gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">AI</div>
                  <div className="bg-white border border-gray-100 px-4 py-3 rounded-2xl rounded-bl-sm shadow-sm">
                    <div className="flex gap-1">
                      {[0, 150, 300].map((d) => (
                        <span key={d} className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* 입력 영역 */}
            <div className="px-6 py-4 bg-white border-t border-gray-200 shrink-0">
              {/* 모델 선택 */}
              <div className="relative mb-2" ref={modelRef}>
                <button onClick={() => setModelOpen((o) => !o)}
                  className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  {MODELS.find((m) => m.id === model)?.label ?? model}
                  <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${modelOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {modelOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-52 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50">
                    {MODELS.map((m) => (
                      <button key={m.id} onClick={() => { setModel(m.id as ModelId); setModelOpen(false); }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${model === m.id ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                        <span>{m.label}</span>
                        <span className="text-[11px] text-gray-400">{m.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 items-end">
                {/* 첨부 버튼 (리서치 탭만) */}
                {tab === 'research' && (
                  <div className="relative" ref={attachRef}>
                    <button onClick={() => { setAttachOpen((o) => !o); setAttachMode(null); }}
                      className="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 hover:border-emerald-400 text-gray-400 hover:text-emerald-600 transition-colors text-lg font-light bg-white shrink-0">
                      +
                    </button>
                    {attachOpen && (
                      <div className="absolute bottom-full left-0 mb-2 w-44 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50">
                        <button onClick={() => fileInputRef.current?.click()}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2">
                          <span>📄</span> 파일 업로드
                        </button>
                        <button onClick={() => { setAttachMode('link'); setAttachOpen(false); }}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2">
                          <span>🔗</span> 링크 추가
                        </button>
                        <button onClick={() => { setAttachMode('text'); setAttachOpen(false); }}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2">
                          <span>📝</span> 텍스트 붙여넣기
                        </button>
                      </div>
                    )}
                    <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
                  </div>
                )}

                {/* 링크/텍스트 입력 모드 */}
                {attachMode ? (
                  <div className="flex-1 flex gap-2">
                    <input
                      autoFocus
                      value={attachInput}
                      onChange={(e) => setAttachInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitAttach(); if (e.key === 'Escape') setAttachMode(null); }}
                      placeholder={attachMode === 'link' ? 'URL을 입력하세요' : '텍스트를 붙여넣으세요'}
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
                    />
                    <button onClick={submitAttach}
                      className="px-4 py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-xl transition-colors shrink-0">
                      추가
                    </button>
                    <button onClick={() => { setAttachMode(null); setAttachInput(''); }}
                      className="px-3 py-3 text-gray-400 hover:text-gray-600 transition-colors">
                      ✕
                    </button>
                  </div>
                ) : (
                  <>
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                      rows={1}
                      placeholder={tab === 'research' ? '리서치 방향을 입력하세요... (Shift+Enter로 줄바꿈)' : '메시지를 입력하세요... (Shift+Enter로 줄바꿈)'}
                      className="flex-1 resize-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
                    />
                    <button onClick={send} disabled={!input.trim() || loading}
                      className="px-5 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors shrink-0">
                      전송
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 우측 패널 */}
          {tab === 'planning' ? (
            <PlanningPanel
              planning={planning}
              statuses={planningStatuses}
              onChange={handlePlanningFieldChange}
              onToggleConfirm={togglePlanningConfirm}
            />
          ) : (
            <ResearchPanel
              research={research}
              statuses={researchStatuses}
              mode={researchMode}
              onModeChange={(m) => { setResearchMode(m); setSaved(false); }}
              onChange={handleResearchFieldChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
