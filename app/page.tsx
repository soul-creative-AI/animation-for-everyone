'use client';

import { useState, useEffect, useRef } from 'react';
import type {
  Message, PlanningData, PlanningStatuses,
  ResearchData, ResearchStatuses, ResearchMode,
  ProjectTab, Project, UploadedSource, PendingChange,
} from '@/types';
import { defaultPlanningData, defaultResearchData } from '@/types';
import { PLANNING_FIRST, RESEARCH_FIRST, getMockResearchResponse, getMockProposals } from '@/lib/mock';
import { MODELS, type ModelId } from '@/lib/models';
import { createProject } from '@/lib/project';
import { createClient } from '@/lib/supabase/client';
import { useProjects } from '@/lib/hooks/useProjects';
import Sidebar from './components/Sidebar';
import AppHeader from './components/AppHeader';
import PlanningPanel from './components/PlanningPanel';
import ResearchPanel from './components/ResearchPanel';
import AttachmentCard from './components/AttachmentCard';
import ProposalCard from './components/ProposalCard';
import ChangeProposalCard from './components/ChangeProposalCard';
import AuthModal from './components/AuthModal';

// ── 컴포넌트 ───────────────────────────────────────────────────
export default function Home() {
  // 인증 상태
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Supabase에서 프로젝트 로드
  const { projects, loading: projectsLoading, saveProject, deleteProject, createNewProject, reorderProjects } = useProjects(userId);

  // 현재 프로젝트
  const [currentId, setCurrentId]   = useState('');
  const [title, setTitle]           = useState('새 프로젝트');
  const [saved, setSaved]           = useState(true);

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
  }

  function selectProject(id: string) {
    const p = projects.find((x) => x.id === id);
    if (p) applyProject(p);
  }

  /* ── 프로젝트 순서 변경 (사이드바 드래그 결과 반영) ── */
  function handleReorder(orderedIds: string[]) {
    reorderProjects(orderedIds).catch((e) => {
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

  /* ── 파일 첨부: Supabase Storage에 실제 업로드 ── */
  async function uploadFileSource(file: File) {
    const src: UploadedSource = {
      id: crypto.randomUUID(), type: 'file', name: file.name,
      uploadStatus: 'uploading', analysisStatus: 'pending',
    };
    setUploadedSources((prev) => [...prev, src]);
    setResearchMsgs((prev) => [...prev, { role: 'user', content: '', card: { type: 'attachment', source: src } }]);
    setSaved(false);

    const path = `${userId}/${currentId}/${src.id}_${file.name}`;
    const { error } = await supabase.storage.from('research-sources').upload(path, file);

    if (error) {
      console.error('파일 업로드 실패:', error);
      setUploadedSources((prev) => prev.map((s) => s.id === src.id ? { ...s, uploadStatus: 'error' } : s));
      setResearchMsgs((prev) => prev.map((m) =>
        m.card?.type === 'attachment' && m.card.source.id === src.id
          ? { ...m, card: { type: 'attachment', source: { ...src, uploadStatus: 'error' } } }
          : m
      ));
      return;
    }

    // 카드 상태 갱신 헬퍼
    const setSourceStatus = (patch: Partial<UploadedSource>) => {
      setUploadedSources((prev) => prev.map((s) => s.id === src.id ? { ...s, ...patch } : s));
      setResearchMsgs((prev) => prev.map((m) =>
        m.card?.type === 'attachment' && m.card.source.id === src.id
          ? { ...m, card: { type: 'attachment', source: { ...m.card.source, ...patch } } }
          : m
      ));
    };

    // 텍스트 계열 파일만 AI 분석 대상 (이미지/PDF 등은 저장만)
    const isTextFile = file.type.startsWith('text/') || /\.(txt|md|markdown|csv)$/i.test(file.name);
    if (!isTextFile) {
      setSourceStatus({ uploadStatus: 'done', storagePath: path, analysisStatus: 'done' });
      setResearchMsgs((prev) => [...prev, { role: 'assistant', content: `"${file.name}" 파일을 저장했어요. (이미지·PDF 등은 자동 분석 대상이 아니라 저장만 했습니다.)` }]);
      return;
    }

    setSourceStatus({ uploadStatus: 'done', storagePath: path, analysisStatus: 'analyzing' });

    // 원작 텍스트를 읽어 AI로 각색 리서치 필드 추출
    try {
      const text = await file.text();
      const res = await fetch('/api/analyze-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const ext = (data.extracted ?? {}) as Partial<ResearchData>;
      const keys = (Object.keys(ext) as (keyof ResearchData)[]).filter((k) => ext[k]);

      if (keys.length > 0) {
        setResearch((prev) => {
          const u = { ...prev };
          for (const k of keys) u[k] = ext[k] as string;
          return u;
        });
        setResearchStatuses((prev) => {
          const s = { ...prev };
          for (const k of keys) s[k] = 'inferred';
          return s;
        });
      }

      setSourceStatus({ analysisStatus: 'done' });
      setResearchMsgs((prev) => [...prev, {
        role: 'assistant',
        content: keys.length > 0
          ? `"${file.name}" 원작을 분석해서 오른쪽 리서치 정보를 채웠어요. 확인하고 수정하거나, 더 궁금한 점을 물어봐주세요.`
          : `"${file.name}"을 읽었는데 각색 리서치 정보를 뽑아내지 못했어요. 파일 내용을 확인해주세요.`,
      }]);
    } catch (e) {
      console.error('원작 분석 실패:', e);
      setSourceStatus({ analysisStatus: 'error' });
      setResearchMsgs((prev) => [...prev, { role: 'assistant', content: `"${file.name}" 분석 중 오류가 발생했어요. 다시 시도해주세요.` }]);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFileSource(file);
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
      <Sidebar
        projects={projects}
        currentId={currentId}
        pct={pct}
        onNew={handleNew}
        onSelect={selectProject}
        onReorder={handleReorder}
      />

      {/* ── 중앙 + 우측 ── */}
      <div className="flex flex-col flex-1" style={{ minWidth: 0 }}>

        {/* 헤더 (key로 프로젝트 전환 시 삭제 확인 상태 초기화) */}
        <AppHeader
          key={currentId}
          title={title}
          saved={saved}
          onTitleChange={(v) => { setTitle(v); setSaved(false); }}
          onSave={handleSave}
          onExport={handleExport}
          onDelete={handleDelete}
          onLogout={handleLogout}
        />

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
              onChange={handleResearchFieldChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
