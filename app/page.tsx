'use client';

import { useState, useEffect, useRef } from 'react';
import type {
  Message, PlanningData, PlanningStatuses,
  ResearchData, ResearchStatuses, ResearchMode, PlatformMetric,
  ProjectTab, Project, UploadedSource, PendingChange,
  OriginalArchive, ArchiveVolume, ArchiveChapter, CompetitorWork,
} from '@/types';
import { defaultPlanningData, defaultResearchData } from '@/types';
import { PLANNING_FIRST, RESEARCH_FIRST, ARCHIVE_FIRST, getMockProposals } from '@/lib/mock';
import { MODELS, type ModelId } from '@/lib/models';
import { createProject, duplicateProject } from '@/lib/project';
import { type TokenUsage, estimateCostUsd } from '@/lib/usage';
import { PROVIDER_OF_MODEL } from '@/lib/budgets';
import { createClient } from '@/lib/supabase/client';
import { useProjects } from '@/lib/hooks/useProjects';
import { useProviderUsage } from '@/lib/hooks/useProviderUsage';
import Sidebar from './components/Sidebar';
import AppHeader, { type ExportScope, type ExportFormat } from './components/AppHeader';
import UsageSummary from './components/UsageSummary';
import PlanningPanel, { FIELDS as PLANNING_FIELDS } from './components/PlanningPanel';
import type { WorkType } from '@/types';
import ResearchPanel, { RESEARCH_SECTIONS, type DiscoverResult } from './components/ResearchPanel';
import ArchivePanel from './components/ArchivePanel';
import ProposalCard from './components/ProposalCard';
import ChangeProposalCard from './components/ChangeProposalCard';
import AuthModal from './components/AuthModal';

// 파일을 base64 문자열로 변환 (data: 접두사 제외한 순수 base64)
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');  // "data:application/pdf;base64,XXXX" → "XXXX"
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// "○○ 리서치해줘 / 조사해줘 / 찾아줘 / 검색해줘" 형태에서 조사할 원작명만 뽑아낸다.
// 모델 판단에 의존하지 않고 코드가 직접 감지 → 자동조사를 확실히 촉발하기 위함.
// 매칭되지 않으면(일반 대화) null 반환.
function parseDiscoverRequest(text: string): string | null {
  const t = text.trim();
  // <제목> [에 대해/를/을/좀] (리서치|조사|서치|검색|자료조사|알아봐|찾아) [해줘/줘/...]
  const re = /^(.+?)\s*(?:에\s*대해서?|에\s*대한|에\s*관해서?|를|을|좀)?\s*(?:리서치|조사|서치|검색|자료\s*조사|알아봐|찾아봐|찾아)\s*(?:좀)?\s*(?:해\s*줘|해주세요|해\s*주세요|해봐|해\s*봐|부탁(?:해요?|드려요|드립니다)?|줘|해\s*줄래|해도\s*돼|해\s*줄\s*수\s*있어)?\s*[.!?~]*$/;
  const m = t.match(re);
  if (!m) return null;
  const title = m[1].trim().replace(/^['"“”「『<]+|['"“”」』>]+$/g, '').trim();
  return title.length >= 2 ? title : null;
}

// PDF 내보내기용: 긴 필드 값을 문장 단위 조각으로 나눈다 (문장 끝 부호·줄바꿈 뒤에서 끊음).
// 각 조각을 span으로 감싸 페이지 분할 후보로 삼으면, 한 문단이 페이지보다 길어도 문장 사이에서 끊긴다.
// 구분 부호는 앞 조각에 포함해서 원문 문자가 손실되지 않도록 한다 (white-space:pre-wrap로 렌더).
function splitSentences(text: string): string[] {
  const parts = text.match(/[\s\S]*?(?:[.!?。…]+|\n|$)/g);
  const chunks = (parts ?? [text]).filter((p) => p.length > 0);
  return chunks.length > 0 ? chunks : [text];
}

// 리서치 필드 key → 라벨 (문서 임포트 안내 메시지에서 채운 항목 이름 표시용)
const RESEARCH_LABELS: Partial<Record<keyof ResearchData, string>> = Object.fromEntries(
  RESEARCH_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.fields.map((f) => [f.key, f.label]))),
);

// ── 컴포넌트 ───────────────────────────────────────────────────
export default function Home() {
  // 인증 상태
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Supabase에서 프로젝트 로드
  const { projects, loading: projectsLoading, ready: projectsReady, saveProject, deleteProject, createNewProject, reorderProjects } = useProjects(userId);

  // 프로바이더별 이번 결제 주기 예산 사용률 (모델 드롭다운 경고 표시용)
  const providerUsagePct = useProviderUsage();

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

  // 원작 아카이브 (권/화별 요약)
  const [archive, setArchive]                    = useState<OriginalArchive>({ volumes: [] });
  const [archiveMsgs, setArchiveMsgs]            = useState<Message[]>([{ role: 'assistant', content: ARCHIVE_FIRST }]);
  const [archiveLoading, setArchiveLoading]      = useState(false);

  // UI
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [model, setModel]         = useState<ModelId>('gemini');
  const [modelOpen, setModelOpen] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [panelWidth, setPanelWidth] = useState(288);  // 우측 패널 너비(px) — 드래그로 조절

  // 우측 패널 좌측 경계를 드래그해서 너비 조절 (240~640px)
  function startPanelResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    function onMove(ev: MouseEvent) {
      const next = startWidth + (startX - ev.clientX);  // 왼쪽으로 끌면 넓어짐
      setPanelWidth(Math.min(640, Math.max(240, next)));
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  const bottomRef   = useRef<HTMLDivElement>(null);
  const modelRef    = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);  // 입력창 높이 자동 조절용
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstProjectCreated = useRef(false);  // 첫 프로젝트 자동 생성 중복 방지
  const docInputRef = useRef<HTMLInputElement>(null);  // 입력창 + 버튼용 파일 선택
  const [uploadingDoc, setUploadingDoc] = useState(false);  // 자료 업로드 분석 중
  const [inputDragOver, setInputDragOver] = useState(false);  // 입력창에 파일 드래그 중

  // 현재 탭 메시지
  const messages    = tab === 'planning' ? planningMsgs    : researchMsgs;
  const setMessages = tab === 'planning' ? setPlanningMsgs : setResearchMsgs;

  // 시작 잠금: AI와 첫 대화(사용자 메시지 1개) 전까지 정보 패널 직접 입력 비활성
  // 파일 업로드도 채팅에 user 메시지로 남으므로 업로드해도 잠금이 풀린다
  const planningLocked = !planningMsgs.some((m) => m.role === 'user');
  const researchLocked = !researchMsgs.some((m) => m.role === 'user');

  /* ── 초기화: 인증 상태 확인 ── */
  useEffect(() => {
    async function checkAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user.id) {
          setUserId(session.user.id);
          setUserEmail(session.user.email ?? null);
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

  /* ── 프로젝트 로드 후 첫 번째 선택 ──
     프로젝트가 하나도 없으면(첫 로그인 등) 자동 생성 —
     currentId가 비어 있으면 자동저장이 조용히 무시되고 수동 저장도 실패하기 때문.
     반드시 projectsReady(로드 완료)일 때만 판단 — 로드 전 빈 목록을 "0개"로 오해해
     새로고침마다 빈 프로젝트가 생기던 버그를 막는다. */
  useEffect(() => {
    if (!userId || !projectsReady) return;
    if (projects.length > 0) {
      if (!currentId) applyProject(projects[0]);
    } else if (!currentId && !firstProjectCreated.current) {
      firstProjectCreated.current = true;
      const fresh = createProject();
      createNewProject(fresh)
        .then(() => applyProject(fresh))
        .catch((e) => {
          firstProjectCreated.current = false;
          console.error('Initial project create failed:', e);
          alert(`첫 프로젝트 생성에 실패했습니다: ${e?.message ?? '알 수 없는 오류'}`);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectsReady, userId]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // 입력 내용이 길어지면 입력창 높이를 자동으로 늘림 (최대 200px, 그 이상은 스크롤)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';               // 줄어들 때도 반영되도록 먼저 초기화
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  /* ── 자동저장: 변경 후 2초간 조용하면 자동으로 저장 ── */
  useEffect(() => {
    if (saved || !currentId) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { handleSave(); }, 2000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, planningMsgs, planning, planningStatuses, researchMsgs, research, researchStatuses, researchMode, uploadedSources, pendingChanges, archive, archiveMsgs]);

  /* ── 프로젝트 로드 ── */
  /* 이미 저장된 데이터에 남아 있는 Claude 웹 검색 인용 태그(<cite index="…">…</cite>)를 불러올 때 정리.
     신규 조사는 서버에서 제거하지만, 그 전에 저장된 프로젝트는 여기서 걷어낸다. (문자열 필드만, 내용은 유지) */
  function stripCitationTags<T extends Record<string, unknown>>(obj: T): T {
    const out = { ...obj };
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === 'string' && v.includes('<cite')) {
        (out as Record<string, unknown>)[k] = v.replace(/<\/?cite\b[^>]*>/gi, '');
      }
    }
    return out;
  }

  function applyProject(p: Project) {
    setCurrentId(p.id);
    setTitle(p.title);
    setTab(p.selectedTab);
    setPlanningMsgs([...p.planningMessages]);
    setPlanning(stripCitationTags({ ...defaultPlanningData, ...p.planning }));
    setPlanningStatuses({ ...p.planningStatuses });
    setResearchMsgs([...p.researchMessages]);
    // 필드 구조가 바뀌기 전에 저장된 프로젝트도 새 필드가 빈 문자열로 채워지도록 병합
    setResearch(stripCitationTags({ ...defaultResearchData, ...p.research }));
    setResearchStatuses({ ...p.researchStatuses });
    setResearchMode(p.researchMode);
    setUploadedSources([...p.uploadedSources]);
    setPendingChanges([...p.pendingChanges]);
    // 구버전 프로젝트엔 archive가 없으므로 기본값으로 병합
    setArchive(p.archive ?? { volumes: [] });
    setArchiveMsgs(p.archiveMessages?.length ? [...p.archiveMessages] : [{ role: 'assistant', content: ARCHIVE_FIRST }]);
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
    // currentId가 비면(예외 상황 방어) 새 id를 만들어 새 프로젝트로 저장 — 빈 id로 upsert하면 uuid 오류로 실패
    const id = currentId || crypto.randomUUID();
    if (!currentId) setCurrentId(id);
    const now = new Date().toISOString();
    const updated: Project = {
      id,
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
      archive: { volumes: archive.volumes.map((v) => ({ ...v, chapters: [...v.chapters] })) },
      archiveMessages: archiveMsgs,
    };
    try {
      await saveProject(updated);
      setSaved(true);
    } catch (e: any) {
      console.error('Save failed:', e);
      // 원인 메시지를 같이 보여줘야 사용자가 문제를 전달할 수 있음 (예: RLS 거부, 네트워크 오류)
      alert(`저장에 실패했습니다: ${e?.message ?? '알 수 없는 오류'}`);
    }
  }

  async function handleDuplicate(id: string) {
    const src = projects.find((p) => p.id === id);
    if (!src) return;
    const copy = duplicateProject(src);
    try {
      await createNewProject(copy);
      applyProject(copy);
    } catch (e) {
      console.error('Duplicate failed:', e);
      alert('프로젝트 복제에 실패했습니다');
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

  /* ── 내보내기: 범위(리서치/기획/전체) × 형식(TXT/PDF) ── */
  function buildExportSections(scope: ExportScope) {
    const sections: { heading: string; fields: { label: string; value: string }[] }[] = [];
    // 작품 유형: value(adaptation) → label(원작 각색) 변환용
    const workTypeLabels: Record<WorkType, string> = {
      'undecided': '미정',
      'original': '오리지널',
      'adaptation': '원작 각색',
      'series': '시리즈물',
      'feature': '장편(극장판)',
    };
    if (scope === 'planning' || scope === 'all') {
      sections.push({
        heading: '기획 정보',
        fields: PLANNING_FIELDS.filter((f) => planning[f.key]).map((f) => ({
          label: f.label,
          value: f.key === 'workType' ? workTypeLabels[planning.workType as WorkType] : planning[f.key],
        })),
      });
    }
    if (scope === 'research' || scope === 'all') {
      for (const s of RESEARCH_SECTIONS) {
        const fields = s.groups
          .flatMap((g) => g.fields)
          .map((f) => ({ label: f.label, value: String(research[f.key] ?? '') }))
          .filter((f) => f.value);
        // 플랫폼 공식 지표 섹션엔 플랫폼별 지표 표를 앞에 붙임 (없으면 "확인 필요"로 정직하게 표기)
        if (s.groups.some((g) => g.label === '플랫폼 공식 지표')) {
          const rows = research.platformMetrics
            .filter((m) => m.platform || m.views || m.rating || m.url)
            .map((m) => `${m.platform || '(플랫폼)'}: 조회 ${m.views || '—'} · 평점 ${m.rating || '—'}${m.url ? ` (${m.url})` : ''}`);
          fields.unshift({
            label: '플랫폼별 지표',
            value: rows.length > 0 ? rows.join('\n') : '확인 필요 (플랫폼 수치 미수집)',
          });
        }
        // 시장 리서치 섹션엔 분석 완료된 경쟁작 카드를 작품별로 붙여서 내보냄
        if (s.heading === '시장 리서치') {
          const analyzed = (research.competitors ?? []).filter((c) => c.status === 'done');
          for (const c of analyzed) {
            const rows = [
              c.summary && `요약: ${c.summary}`,
              c.strengths && `장점: ${c.strengths}`,
              c.cliches && `클리셰: ${c.cliches}`,
              c.marketPosition && `시장 포지션: ${c.marketPosition}`,
              c.avoid && `피해야 할 것: ${c.avoid}`,
              c.leverage && `활용 방안: ${c.leverage}`,
              c.differentiation && `차별화 방안: ${c.differentiation}`,
            ].filter(Boolean) as string[];
            if (rows.length > 0) fields.push({ label: `경쟁작 분석 — ${c.title}`, value: rows.join('\n') });
          }
        }
        // 독자 반응 섹션엔 감정 비율(도넛 차트 데이터)을 텍스트로도 남김 — 내보내기에서 사라지지 않도록
        if (s.groups.some((g) => g.label === '독자 반응 분석') && research.sentiment) {
          const { positive, negative, neutral } = research.sentiment;
          const total = positive + negative + neutral;
          if (total > 0) {
            const pct = (n: number) => Math.round((n / total) * 100);
            fields.unshift({
              label: '독자 감정 비율',
              value: `긍정 ${pct(positive)}% · 부정 ${pct(negative)}% · 중립 ${pct(neutral)}%`,
            });
          }
        }
        if (fields.length > 0) sections.push({ heading: s.heading, fields });
      }
    }
    return sections;
  }

  function exportAsTxt(sections: ReturnType<typeof buildExportSections>) {
    const lines = [`# ${title}`, ''];
    for (const s of sections) {
      lines.push(`## ${s.heading}`, '');
      for (const f of s.fields) lines.push(`**${f.label}**: ${f.value}`);
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${title}.txt` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  // PDF 내보내기용 감정 비율 도넛 SVG (화면 컴포넌트와 동일한 stroke-dasharray 방식)
  function sentimentDonutSvgForExport(): string {
    const s = research.sentiment;
    if (!s) return '';
    const total = s.positive + s.negative + s.neutral;
    if (total <= 0) return '';
    const segs = [
      { label: '긍정', value: s.positive, color: '#10b981' },
      { label: '부정', value: s.negative, color: '#f43f5e' },
      { label: '중립', value: s.neutral, color: '#9ca3af' },
    ];
    const r = 42, c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = segs.map((seg) => {
      const dash = (seg.value / total) * c;
      const el = `<circle cx="56" cy="56" r="${r}" fill="none" stroke="${seg.color}" stroke-width="14" stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 56 56)" />`;
      offset += dash;
      return el;
    }).join('');
    const legend = segs.map((seg) =>
      `<div style="display:flex; align-items:center; gap:6px; font-size:12px; margin:3px 0;"><span style="width:11px; height:11px; background:${seg.color}; display:inline-block; border-radius:2px;"></span><span style="width:32px;">${seg.label}</span><b>${Math.round((seg.value / total) * 100)}%</b></div>`
    ).join('');
    // 독자 감정 비율 텍스트 필드(원작 콘텐츠 분석 섹션) 바로 아래에 끼워 넣을 것이므로
    // 별도 섹션 제목(h2) 없이 차트만 반환 — pdf-block 클래스로 페이지 분할 시 안 잘리게 보호
    return `
      <div class="pdf-block" style="display:flex; align-items:center; gap:24px; padding:10px 4px 4px;">
        <svg width="112" height="112" viewBox="0 0 112 112"><circle cx="56" cy="56" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="14" />${arcs}</svg>
        <div>${legend}</div>
      </div>`;
  }

  async function exportAsPdf(sections: ReturnType<typeof buildExportSections>) {
    const { jsPDF } = await import('jspdf');
    const html2canvas = (await import('html2canvas')).default;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 화면 밖에 실제 렌더링해서 캡처 → 인쇄 다이얼로그 없이 바로 PDF 파일로 다운로드
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed; left:-9999px; top:0; width:700px; padding:40px; background:#ffffff; font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif; color:#1f2937;';
    container.innerHTML = `
      <h1 class="pdf-block" style="font-size:20px; margin:0 0 4px; color:#1e3a5f;">${esc(title)}</h1>
      <p class="pdf-block" style="font-size:11px; color:#6b7280; margin:0 0 24px;">원작 IP 분석 · 애니메이션 기획 자료</p>
      ${sections.map((s) => `
        <h2 class="pdf-block" style="font-size:13px; margin:24px 0 10px; background:#1e3a5f; color:#ffffff; padding:7px 12px; border-left:4px solid #059669;">${esc(s.heading)}</h2>
        ${s.fields.map((f) => `
          <p class="pdf-block" style="font-size:11px; color:#1e3a5f; font-weight:600; margin:8px 0 2px;">${esc(f.label)}</p>
          <p class="pdf-block" style="font-size:12px; line-height:1.7; margin:0 0 10px; white-space:pre-wrap;">${splitSentences(f.value).map((s2) => `<span class="pdf-break">${esc(s2)}</span>`).join('')}</p>
          ${f.label === '독자 감정 비율' ? sentimentDonutSvgForExport() : ''}
        `).join('')}
      `).join('')}
    `;
    document.body.appendChild(container);

    // 페이지를 나눌 때 텍스트 중간이 잘리지 않도록, 안전하게 끊을 수 있는 지점(하단 경계)을 미리 모은다.
    // - .pdf-block: 제목·라벨·차트 등 통째로 움직여야 하는 블록
    // - .pdf-break: 문장 단위 span — 긴 문단도 문장 사이에서 끊을 수 있게 함
    // span은 여러 줄에 걸치면 offsetTop이 부정확하므로 getBoundingClientRect로 컨테이너 상단 기준 좌표를 잰다.
    const containerTop = container.getBoundingClientRect().top;
    const blockBottomsCss = Array.from(container.querySelectorAll<HTMLElement>('.pdf-block, .pdf-break'))
      .map((el) => el.getBoundingClientRect().bottom - containerTop)
      .sort((a, b) => a - b);

    // jsPDF의 doc.html() 네이티브 텍스트 렌더러는 기본 폰트(Helvetica)가 한글을 지원하지 않아
    // 한글이 빈칸으로 나온다 — html2canvas로 화면을 그대로 이미지 캡처해서 페이지 단위로 붙여넣는다.
    const canvas = await html2canvas(container, { backgroundColor: '#ffffff', scale: 2 });
    // CSS px → 캔버스 px 배율 (scale 옵션과 별개로 실측 비율을 써서 오차 방지)
    const cssToCanvas = canvas.width / container.offsetWidth;
    const blockBottomsPx = blockBottomsCss.map((b) => b * cssToCanvas);
    document.body.removeChild(container);

    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = 555;    // A4 폭(595pt)에서 좌우 여백(20pt×2) 뺀 값
    const pageHeightPt = 802; // A4 높이(842pt)에서 상하 여백(20pt×2) 뺀 값
    // canvas.width 기준으로 한 페이지분 캔버스 픽셀 높이 계산 (margin 제외)
    const pageHeightPx = (pageHeightPt / pageWidth) * canvas.width;

    // DOM에서 잰 경계는 html2canvas가 렌더한 캔버스와 미세하게 어긋날 수 있다
    // (복제 문서에서 폰트·줄바꿈이 달라지기 때문). 그대로 자르면 글자 가운데가 잘리므로,
    // 자를 지점에서 위로 올라가며 "완전히 비어 있는 가로줄"을 찾아 거기서 자른다.
    const srcCtx = canvas.getContext('2d');
    function findBlankCut(preferred: number, lowerLimit: number): number {
      if (!srcCtx) return preferred;
      const target = Math.floor(preferred);
      const searchTop = Math.max(Math.floor(lowerLimit) + 1, target - 500);
      const h = target - searchTop;
      if (h <= 0) return preferred;
      try {
        const strip = srcCtx.getImageData(0, searchTop, canvas.width, h).data;
        for (let y = h - 1; y >= 0; y--) {
          let blank = true;
          for (let x = 0; x < canvas.width; x += 2) {  // 2px 간격 샘플링 — 속도 확보
            const i = (y * canvas.width + x) * 4;
            if (strip[i] < 250 || strip[i + 1] < 250 || strip[i + 2] < 250) { blank = false; break; }
          }
          if (blank) return searchTop + y;
        }
      } catch { /* 캔버스를 읽을 수 없으면 원래 경계 사용 */ }
      return preferred;
    }

    let renderedHeight = 0;
    let first = true;
    while (renderedHeight < canvas.height) {
      const maxBottom = Math.min(canvas.height, renderedHeight + pageHeightPx);
      // 이 페이지 구간 안에서 블록 중간을 지나지 않는 가장 아래쪽 경계를 찾아 거기서 자른다.
      // 블록 하나가 한 페이지보다 커서 안전한 경계가 없으면(예: 아주 긴 줄거리) 어쩔 수 없이 그대로 자른다.
      const safeBottoms = blockBottomsPx.filter((b) => b > renderedHeight + 1 && b <= maxBottom);
      const preferred = safeBottoms.length > 0 ? safeBottoms[safeBottoms.length - 1] : maxBottom;
      // 마지막 페이지는 끝까지 그대로 싣는다 (여백 탐색 불필요)
      let sliceEnd = maxBottom >= canvas.height ? canvas.height : findBlankCut(preferred, renderedHeight);
      // 소수 좌표로 자르면 페이지마다 미세하게 밀려 누적되므로 정수로 맞춘다
      sliceEnd = Math.min(canvas.height, Math.round(sliceEnd));
      if (sliceEnd <= renderedHeight) sliceEnd = Math.min(canvas.height, Math.round(maxBottom));  // 진행 정지 방어
      const sliceHeight = sliceEnd - renderedHeight;
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceHeight;
      const ctx = sliceCanvas.getContext('2d')!;
      ctx.drawImage(canvas, 0, renderedHeight, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      if (!first) pdf.addPage();
      const sliceHeightPt = sliceHeight * (pageWidth / canvas.width);
      pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', 20, 20, pageWidth, sliceHeightPt);
      renderedHeight = sliceEnd;
      first = false;
    }
    pdf.save(`${title}.pdf`);
  }

  function handleExport(scope: ExportScope, format: ExportFormat) {
    const sections = buildExportSections(scope);
    if (format === 'txt') exportAsTxt(sections);
    else exportAsPdf(sections);
  }

  /* ── AI 사용량 기록 (usage_logs) ── */
  // modelOverride: 서버가 강제/폴백으로 다른 모델을 쓴 경우(예: 자동조사=Claude Haiku) 실제 모델로 기록
  async function recordUsage(feature: string, usage?: TokenUsage, modelOverride?: ModelId) {
    if (!userId || !usage) return;
    const empty = !usage.inputTokens && !usage.outputTokens && !usage.cachedInputTokens;
    if (empty) return;
    const usedModel = modelOverride ?? model;
    try {
      await supabase.from('usage_logs').insert({
        user_id: userId,
        user_email: userEmail,
        project_id: currentId || null,
        model: usedModel,
        feature,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        cost_usd: estimateCostUsd(usedModel, usage),
      });
    } catch (e) {
      console.error('사용량 기록 실패:', e);
    }
  }

  /* ── 기획 탭: AI 전송 ── */
  async function sendPlanning(userMsg: Message, next: Message[]) {
    try {
      const res  = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, model, planningData: planning, researchData: research, archiveData: archive }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      recordUsage('planning-chat', data.usage);
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
    } catch (e: any) {
      const content = e?.message || '오류가 발생했습니다. 다시 시도해주세요.';
      setPlanningMsgs((prev) => [...prev, { role: 'assistant', content }]);
    }
    // AI 응답으로 바뀐 내용(답변·기획 필드)을 반드시 자동저장 대상으로 표시.
    // 이게 없으면, 전송 직후 돌아간 자동저장이 saved=true로 바꿔버려 응답 결과가 저장되지 않는다.
    setSaved(false);
  }

  /* ── 리서치 탭: AI 전송 ── */
  async function sendResearch(next: Message[]) {
    // "○○ 리서치해줘"처럼 특정 원작 조사 요청이면, 채팅 모델을 거치지 않고 곧바로 웹 검색으로 채운다.
    const lastUser = next[next.length - 1];
    const discoverTitle = lastUser?.role === 'user' ? parseDiscoverRequest(lastUser.content) : null;
    if (discoverTitle) {
      setResearchMsgs((prev) => [...prev, {
        role: 'assistant',
        content: `「${discoverTitle}」을(를) 웹에서 찾아 채워볼게요. 웹 검색이라 최대 30초 정도 걸릴 수 있어요 — 멈춘 게 아니니 조금만 기다려주세요 🔍`,
      }]);
      await runChatDiscover(discoverTitle);
      setSaved(false);
      return;
    }
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, model, context: 'research', researchData: research, archiveData: archive }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      recordUsage('research-chat', data.usage);
      setResearchMsgs((prev) => [...prev, { role: 'assistant', content: data.text }]);
      if (data.extracted) {
        const ext = data.extracted as Record<string, any>;
        // 사용자가 확정한 필드는 이후 AI 추출로 덮어쓰지 않음
        const keys = Object.keys(ext).filter((k) => ext[k] && researchStatuses[k as keyof ResearchData] !== 'confirmed');
        setResearch((prev) => {
          const u = { ...prev };
          for (const k of keys) (u as any)[k] = ext[k];
          return u;
        });
        setResearchStatuses((prev) => {
          const s = { ...prev };
          for (const k of keys) s[k as keyof ResearchData] = 'inferred';
          return s;
        });
      }
      setSaved(false);

      // "○○ 리서치해줘"처럼 원작 자동조사를 요청받았으면, 이어서 웹 검색으로 필드를 채운다.
      if (data.action?.type === 'discover' && data.action.title) {
        await runChatDiscover(data.action.title);
      }
    } catch (e: any) {
      const content = e?.message || '오류가 발생했습니다. 다시 시도해주세요.';
      setResearchMsgs((prev) => [...prev, { role: 'assistant', content }]);
    }
  }

  /* ── 채팅에서 촉발된 자동조사: 웹 검색으로 개요·줄거리 등을 채우고 결과를 채팅에 요약 ── */
  async function runChatDiscover(rawTitle: string) {
    const title = rawTitle.trim();
    if (!title) return;
    // 각색 작품으로 조사 중이라는 맥락 반영 + 원작명 확정
    setResearchMode('adaptation');
    setResearch((prev) => (prev.originalTitle ? prev : { ...prev, originalTitle: title }));

    const result = await discoverFromTitle(title);
    if (!result) return;  // discoverFromTitle이 이미 오류 alert 처리

    if (!result.found) {
      setResearchMsgs((prev) => [...prev, {
        role: 'assistant',
        content: `「${title}」을(를) 웹에서 찾지 못했어요. ${result.note || ''}\n제목이 정확한지 확인하거나, 원작 파일을 첨부해주시면 제가 직접 분석해서 채워드릴게요.`.trim(),
      }]);
      return;
    }

    // 채운 필드를 라벨로 정리해서 무엇이 반영됐는지 알려준다
    const FIELD_LABELS: Partial<Record<keyof ResearchData, string>> = {
      overviewAuthor: '작가', originalFormat: '원작 형식', overviewGenreStatus: '장르/연재 상태',
      overviewPlatforms: '유통 플랫폼', overviewPremise: '핵심 설정', fullPlot: '전체 줄거리',
      mainCharacters: '주요 캐릭터', similarWorks: '유사 작품', genreTrends: '장르 트렌드',
      differentiation: '차별화 포인트',
    };
    const filled = (Object.keys(result.fields ?? {}) as (keyof ResearchData)[])
      .filter((k) => result.fields[k] && FIELD_LABELS[k])
      .map((k) => FIELD_LABELS[k]!);
    const platformNames = (result.platforms ?? []).filter((p) => p.platform).map((p) => p.platform);

    const parts = [`「${title}」을(를) 웹에서 찾아 오른쪽 리서치 정보를 채웠어요. 확인하고 맞으면 각 필드를 "확정"해주세요.`];
    if (filled.length > 0) parts.push(`\n✅ 채운 항목: ${filled.join(', ')}`);
    if (platformNames.length > 0) parts.push(`🔗 확인된 게재 플랫폼: ${platformNames.join(', ')}`);
    parts.push(
      '\n아직 비어 있는 조회수·평점·독자 반응은 제가 지어내지 않아요. 위 플랫폼 페이지에서 수치와 댓글을 복사해 🔗 "플랫폼 데이터 가져오기 도우미"에 붙여넣으면 정리해드릴게요.'
    );
    setResearchMsgs((prev) => [...prev, { role: 'assistant', content: parts.join('\n') }]);
  }

  /* ── 공통 전송 ── */
  // text를 그대로 사용자 메시지로 보냄 (자유입력·퀵액션 버튼 공용)
  async function sendMessageText(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: text.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);
    setSaved(false);
    if (tab === 'planning') {
      await sendPlanning(userMsg, next);
    } else {
      await sendResearch(next);
    }
    setLoading(false);
  }

  async function send() {
    if (!input.trim() || loading) return;
    const text = input;
    setInput('');
    await sendMessageText(text);
  }

  /* ── 원작 아카이브 탭 Q&A: "~한 장면 몇 화야?"를 아카이브 인덱스 근거로 답함 ── */
  async function sendArchiveQuestion(text: string) {
    if (!text.trim() || archiveLoading) return;
    const next: Message[] = [...archiveMsgs, { role: 'user', content: text.trim() }];
    setArchiveMsgs(next);
    setArchiveLoading(true);
    setSaved(false);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, model, context: 'archive', archiveData: archive }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      recordUsage('archive-chat', data.usage);
      setArchiveMsgs((prev) => [...prev, { role: 'assistant', content: data.text }]);
    } catch (e: any) {
      setArchiveMsgs((prev) => [...prev, { role: 'assistant', content: e?.message || '오류가 발생했습니다. 다시 시도해주세요.' }]);
    } finally {
      setArchiveLoading(false);
    }
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
    // 타이핑만으로는 확정하지 않음(확정=readOnly). AI 추정/변경 제안 배지는 손대면 제거.
    setResearchStatuses((prev) => {
      if (prev[key] === 'inferred' || prev[key] === 'suggested') {
        const s = { ...prev };
        delete s[key];
        return s;
      }
      return prev;
    });
    setSaved(false);
  }

  // 리서치 필드 확정 토글 (확정하면 AI 추출·자동조사가 덮어쓰지 않고, 편집 잠금)
  function toggleResearchConfirm(key: keyof ResearchData) {
    setResearchStatuses((prev) => {
      const s = { ...prev };
      if (s[key] === 'confirmed') delete s[key];
      else s[key] = 'confirmed';
      return s;
    });
    setSaved(false);
  }

  /* ── 플랫폼별 지표(조회수·평점) 행 추가/수정/삭제 ── */
  function addPlatformMetric() {
    setResearch((prev) => ({
      ...prev,
      platformMetrics: [...prev.platformMetrics, { id: crypto.randomUUID(), platform: '', url: '', views: '', rating: '', comments: '' }],
    }));
    setSaved(false);
  }

  function updatePlatformMetric(id: string, patch: Partial<PlatformMetric>) {
    setResearch((prev) => ({
      ...prev,
      platformMetrics: prev.platformMetrics.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
    setSaved(false);
  }

  function removePlatformMetric(id: string) {
    setResearch((prev) => ({
      ...prev,
      platformMetrics: prev.platformMetrics.filter((m) => m.id !== id),
    }));
    setSaved(false);
  }

  /* ── 경쟁작/레퍼런스 분석 ── */
  function addCompetitor(title: string, reason = '', addedBy: 'auto' | 'user' = 'user') {
    const t = title.trim();
    if (!t) return;
    setResearch((prev) => {
      const existing = prev.competitors ?? [];
      if (existing.some((c) => c.title === t)) return prev;  // 같은 작품 중복 방지
      return {
        ...prev,
        competitors: [...existing, {
          id: crypto.randomUUID(), title: t, reason, addedBy, status: 'pending' as const,
          summary: '', strengths: '', cliches: '', marketPosition: '', avoid: '', leverage: '', differentiation: '',
        }],
      };
    });
    setSaved(false);
  }

  function removeCompetitor(id: string) {
    setResearch((prev) => ({ ...prev, competitors: (prev.competitors ?? []).filter((c) => c.id !== id) }));
    setSaved(false);
  }

  function updateCompetitor(id: string, patch: Partial<CompetitorWork>) {
    setResearch((prev) => ({
      ...prev,
      competitors: (prev.competitors ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
    setSaved(false);
  }

  // 경쟁작 분석에 함께 보낼 "우리 작품 정보" — 리서치·기획에서 채워진 핵심만 추려서
  function ourWorkContext(): string {
    const lines: string[] = [];
    if (research.originalTitle) lines.push(`원작명: ${research.originalTitle}`);
    if (planning.title && planning.title !== research.originalTitle) lines.push(`기획 제목: ${planning.title}`);
    const genre = research.overviewGenreStatus || planning.genre;
    if (genre) lines.push(`장르: ${genre}`);
    if (research.overviewPremise) lines.push(`핵심 설정: ${research.overviewPremise}`);
    if (planning.logline) lines.push(`로그라인: ${planning.logline}`);
    const plot = planning.synopsis || research.fullPlot;
    if (plot) lines.push(`줄거리: ${plot.slice(0, 600)}`);  // 토큰 절약을 위해 앞부분만
    const target = planning.targetAudience || research.audienceProfile;
    if (target) lines.push(`타깃: ${target}`);
    const diff = planning.differentiationPoint || research.differentiation;
    if (diff) lines.push(`차별화 방향: ${diff}`);
    if (planning.planningIntent) lines.push(`기획 의도: ${planning.planningIntent}`);
    return lines.join('\n');
  }

  // 경쟁작 1개를 웹 검색으로 분석 (provider별 저비용 모델 — 자동조사와 동일 비용 구조)
  async function analyzeCompetitor(id: string) {
    const comp = (research.competitors ?? []).find((c) => c.id === id);
    if (!comp || comp.status === 'analyzing') return;
    updateCompetitor(id, { status: 'analyzing' });
    try {
      const res = await fetch('/api/analyze-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: comp.title, model, mode: 'competitor', context: ourWorkContext() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      recordUsage('competitor-analyze', data.usage, data.usedModel as ModelId | undefined);

      const c = (data.competitor ?? {}) as Record<string, unknown>;
      const pick = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : '');
      if (!c.found) {
        updateCompetitor(id, { status: 'error' });
        alert(`「${comp.title}」을(를) 웹에서 찾지 못했어요. ${pick('note')}`.trim());
        return;
      }
      updateCompetitor(id, {
        status: 'done',
        summary: pick('summary'), strengths: pick('strengths'), cliches: pick('cliches'),
        marketPosition: pick('marketPosition'), avoid: pick('avoid'),
        leverage: pick('leverage'), differentiation: pick('differentiation'),
      });
    } catch (e: any) {
      updateCompetitor(id, { status: 'error' });
      alert(e?.message || '경쟁작 분석 중 오류가 발생했어요. 다시 시도해주세요.');
    }
  }

  /* ── 원작 아카이브: 권/화 수정·삭제 (추가는 원문 자동 정리로만) ── */
  function updateArchiveVolume(id: string, patch: Partial<ArchiveVolume>) {
    setArchive((prev) => ({
      volumes: prev.volumes.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }));
    setSaved(false);
  }

  function removeArchiveVolume(id: string) {
    if (!confirm('이 권과 안에 있는 모든 화를 삭제할까요?')) return;
    setArchive((prev) => ({ volumes: prev.volumes.filter((v) => v.id !== id) }));
    setSaved(false);
  }

  function updateArchiveChapter(volumeId: string, chapterId: string, patch: Partial<ArchiveChapter>) {
    setArchive((prev) => ({
      volumes: prev.volumes.map((v) =>
        v.id === volumeId
          ? { ...v, chapters: v.chapters.map((c) => (c.id === chapterId ? { ...c, ...patch } : c)) }
          : v,
      ),
    }));
    setSaved(false);
  }

  function removeArchiveChapter(volumeId: string, chapterId: string) {
    setArchive((prev) => ({
      volumes: prev.volumes.map((v) =>
        v.id === volumeId ? { ...v, chapters: v.chapters.filter((c) => c.id !== chapterId) } : v,
      ),
    }));
    setSaved(false);
  }

  // 원작 원문(text 또는 pdfBase64)을 분석해 비어 있는 리서치 필드를 채운다.
  // 여러 권을 차례로 올릴 수 있으므로 이미 값이 있는 필드는 덮어쓰지 않는다(첫 업로드가 채우고 이후엔 보존).
  async function fillResearchFromSource(source: { text?: string; pdfBase64?: string }) {
    try {
      const res = await fetch('/api/analyze-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...source, model }),  // mode 기본값 'source'
      });
      const data = await res.json();
      if (data.error) return;  // 리서치 채우기는 부가 기능이라 실패해도 아카이브 결과를 막지 않음
      recordUsage('research-analyze', data.usage, data.usedModel as ModelId | undefined);

      const ext = (data.extracted ?? {}) as Partial<ResearchData>;
      const keys = (Object.keys(ext) as (keyof ResearchData)[])
        .filter((k) => ext[k] && !String(research[k] ?? '').trim() && researchStatuses[k] !== 'confirmed');
      if (keys.length === 0) return;
      setResearch((prev) => {
        const u = { ...prev };
        for (const k of keys) if (!String(prev[k] ?? '').trim()) (u as Record<string, unknown>)[k] = ext[k];
        return u;
      });
      setResearchStatuses((prev) => {
        const s = { ...prev };
        for (const k of keys) s[k] = 'inferred';
        return s;
      });
      if (researchMode !== 'adaptation') setResearchMode('adaptation');
      setSaved(false);
    } catch {
      // 무시 — 아카이브 자동 분할은 이미 성공했으므로 조용히 넘어간다
    }
  }

  // 한 권 분량 원문(파일 또는 붙여넣기)을 AI로 화 단위 분할 → 새 권으로 아카이브에 추가.
  // 권 번호는 올린 순서대로 자동 지정. 같은 원문으로 비어 있는 리서치 필드(줄거리·캐릭터 등)도 함께 채운다.
  async function autoSplitVolume(opts: { file?: File; text?: string }): Promise<boolean> {
    try {
      const body: { model: ModelId; mode: 'archive-split'; text?: string; pdfBase64?: string } = { model, mode: 'archive-split' };
      if (opts.file) {
        const isPdf = opts.file.type === 'application/pdf' || /\.pdf$/i.test(opts.file.name);
        if (isPdf) body.pdfBase64 = await fileToBase64(opts.file);
        else body.text = await opts.file.text();
      } else {
        body.text = opts.text ?? '';
      }
      if (!body.text?.trim() && !body.pdfBase64) {
        alert('원문 파일이나 텍스트를 넣어주세요.');
        return false;
      }
      const res = await fetch('/api/analyze-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      recordUsage('archive-split', data.usage, data.usedModel as ModelId | undefined);

      const chapters = (data.chapters ?? []) as { number?: string; title?: string; summary?: string; characters?: string; sceneTags?: string }[];
      const volumeSummary = typeof data.volumeSummary === 'string' ? data.volumeSummary : '';
      if (chapters.length === 0) {
        alert('원문에서 화를 나누지 못했어요. 한 권 분량인지, 형식이 너무 특이하지 않은지 확인해주세요. (분량이 아주 크면 앞부분만 인식될 수 있어요)');
        return false;
      }
      setArchive((prev) => ({
        volumes: [...prev.volumes, {
          id: crypto.randomUUID(),
          number: String(prev.volumes.length + 1),
          title: '',
          summary: volumeSummary,
          chapters: chapters.map((c, i) => ({
            id: crypto.randomUUID(),
            number: String(c.number ?? i + 1),
            title: c.title ?? '',
            summary: c.summary ?? '',
            characters: c.characters ?? '',
            sceneTags: c.sceneTags ?? '',
          })),
        }],
      }));
      setSaved(false);
      // 같은 원문으로 리서치 필드도 채움 (실패해도 아카이브 결과엔 영향 없음)
      await fillResearchFromSource(body.pdfBase64 ? { pdfBase64: body.pdfBase64 } : { text: body.text });
      return true;
    } catch (e: any) {
      alert(e?.message || '자동 정리 중 오류가 발생했어요. 다시 시도해주세요.');
      return false;
    }
  }

  /* ── 기획 탭: 문서 업로드(PDF/TXT) → 기획·리서치 빈 필드 자동 채우기 ──
     기획서든 리서치 자료든, 예전에 내보낸(export) 파일이든 넣으면 문서에 담긴 항목이
     각 탭(기획/리서치)의 빈칸에 채워진다. 이미 쓴 값·확정 필드는 보존한다. */
  async function fillFromDoc(file: File): Promise<boolean> {
    // 결과 안내는 현재 보고 있는 탭의 채팅에 남긴다 (업로드는 두 탭 공통 + 버튼에서 촉발)
    const appendChat = tab === 'planning' ? setPlanningMsgs : setResearchMsgs;
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const body: { model: ModelId; mode: 'doc-import'; text?: string; pdfBase64?: string } = { model, mode: 'doc-import' };
      if (isPdf) body.pdfBase64 = await fileToBase64(file);
      else body.text = await file.text();
      if (!body.pdfBase64 && !body.text?.trim()) {
        alert('파일에서 내용을 읽지 못했어요. PDF나 텍스트 파일(.txt, .md)인지 확인해주세요.');
        return false;
      }
      const res = await fetch('/api/analyze-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      recordUsage('doc-import', data.usage, data.usedModel as ModelId | undefined);

      const imported = (data.imported ?? {}) as {
        planning?: Partial<Record<keyof PlanningData, string>>;
        research?: Partial<Record<keyof ResearchData, string>>;
      };

      // ── 기획 필드 채우기 (빈 필드만, workType은 enum 값 검증) ──
      const pExt = { ...(imported.planning ?? {}) };
      const validWorkTypes: WorkType[] = ['undecided', 'original', 'adaptation', 'series', 'feature'];
      if (pExt.workType && !validWorkTypes.includes(pExt.workType as WorkType)) delete pExt.workType;
      const pKeys = (Object.keys(pExt) as (keyof PlanningData)[]).filter((k) => {
        if (!pExt[k] || planningStatuses[k] === 'confirmed') return false;
        if (k === 'workType') return planning.workType === 'undecided' && pExt.workType !== 'undecided';
        return !String(planning[k] ?? '').trim();
      });
      if (pKeys.length > 0) {
        setPlanning((prev) => {
          const u = { ...prev };
          for (const k of pKeys) (u as Record<string, string>)[k] = pExt[k]!;
          return u;
        });
        setPlanningStatuses((prev) => {
          const s = { ...prev };
          for (const k of pKeys) s[k] = 'inferred';
          return s;
        });
      }

      // ── 리서치 필드 채우기 (문자열 필드만, 빈 필드만) ──
      const rExt = (imported.research ?? {}) as Partial<Record<keyof ResearchData, string>>;
      const rKeys = (Object.keys(rExt) as (keyof ResearchData)[]).filter((k) =>
        rExt[k] && typeof rExt[k] === 'string' &&
        researchStatuses[k] !== 'confirmed' && !String(research[k] ?? '').trim(),
      );
      if (rKeys.length > 0) {
        setResearch((prev) => {
          const u = { ...prev };
          for (const k of rKeys) if (!String(prev[k] ?? '').trim()) (u as Record<string, unknown>)[k] = rExt[k];
          return u;
        });
        setResearchStatuses((prev) => {
          const s = { ...prev };
          for (const k of rKeys) s[k] = 'inferred';
          return s;
        });
      }

      if (pKeys.length === 0 && rKeys.length === 0) {
        appendChat((prev) => [...prev, {
          role: 'assistant',
          content: `문서(${file.name})를 읽었지만 새로 채울 빈 항목이 없었어요. (이미 채워져 있거나 확정된 항목은 건드리지 않아요)`,
        }]);
        setSaved(false);  // 안내 메시지도 대화 기록이므로 저장 대상으로 표시
        return true;
      }
      setSaved(false);

      // 어떤 탭의 무엇이 채워졌는지 안내
      const pLabels = pKeys.map((k) => PLANNING_FIELDS.find((f) => f.key === k)?.label ?? k);
      const rLabels = rKeys.map((k) => RESEARCH_LABELS[k] ?? k);
      const parts = [`문서(${file.name})에서 항목을 채웠어요.`];
      if (pLabels.length > 0) parts.push(`\n📋 기획: ${pLabels.join(', ')}`);
      if (rLabels.length > 0) parts.push(`\n🔍 리서치: ${rLabels.join(', ')}`);
      parts.push('\n각 탭에서 확인하고, 맞는 내용은 확정해주세요.');
      appendChat((prev) => [...prev, { role: 'assistant', content: parts.join('\n') }]);
      return true;
    } catch (e: any) {
      alert(e?.message || '문서 분석 중 오류가 발생했어요. 다시 시도해주세요.');
      return false;
    }
  }

  // 입력창 왼쪽 + 버튼: 파일 선택 → 자료 업로드(fillFromDoc). 기획·리서치 탭 공통.
  async function handleDocPick(file: File | undefined | null) {
    if (!file || uploadingDoc) return;
    // 업로드한 파일을 현재 탭 채팅에 사용자 메시지로 표시 (사용자가 무엇을 올렸는지 알 수 있게)
    const appendChat = tab === 'planning' ? setPlanningMsgs : setResearchMsgs;
    appendChat((prev) => [...prev, { role: 'user', content: `📎 파일 업로드: ${file.name}` }]);
    setUploadingDoc(true);
    try {
      await fillFromDoc(file);
    } finally {
      setUploadingDoc(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  }

  /* ── 리서치 → 기획 적용 ──
     비어있는 기획 필드만 리서치 데이터로 채운다. 사용자가 확정(confirmed)한 필드는 건드리지 않음. */
  function applyResearchToPlanning() {
    // 매핑 규칙: [기획 필드, 기획 필드 라벨, 리서치에서 가져올 값(우선순위 순)]
    const mappings: { key: keyof PlanningData; label: string; value: string }[] = [
      { key: 'title',          label: '제목',          value: research.originalTitle },
      { key: 'genre',          label: '장르',          value: research.overviewGenreStatus },
      { key: 'synopsis',       label: '시놉시스',       value: research.fullPlot || research.overviewPremise },
      { key: 'targetAudience', label: '타깃 시청자',    value: research.audienceProfile },
      { key: 'keyCharacters',  label: '주요 등장인물',  value: research.mainCharacters },
    ];
    const applied: string[] = [];
    const updates: Partial<PlanningData> = {};
    for (const m of mappings) {
      const empty = !planning[m.key] || planning[m.key] === 'undecided';
      if (m.value && empty && planningStatuses[m.key] !== 'confirmed') {
        (updates as Record<string, string>)[m.key] = m.value;
        applied.push(m.label);
      }
    }
    // 작품 유형은 다른 필드와 달리 "값이 비어있는지"가 아니라 "사용자가 확정했는지"만 본다 —
    // 리서치 탭에서 각색으로 진행 중인데 기획 채팅에서 AI가 추론만 해둔 'original'을 덮어쓰지 못하던 문제 수정
    if (researchMode === 'adaptation' && planning.workType !== 'adaptation' && planningStatuses.workType !== 'confirmed') {
      updates.workType = 'adaptation';
      applied.push('작품 유형');
    }

    if (applied.length > 0) {
      setPlanning((prev) => ({ ...prev, ...updates }));
      setPlanningStatuses((prev) => {
        const s = { ...prev };
        for (const k of Object.keys(updates)) s[k] = 'inferred';
        return s;
      });
    }

    // 기획 시작 가이드 메시지: 무엇이 적용됐는지 + 리서치의 기획 힌트를 함께 전달
    const guideLines: string[] = [];
    if (applied.length > 0) {
      guideLines.push(`리서치 정보를 기획에 반영했어요! (${applied.join(', ')})`);
      guideLines.push('오른쪽 패널에서 확인하고, 맞는 내용은 확정해주세요.');
    } else {
      guideLines.push('기획에 새로 채울 리서치 정보가 없었어요. (이미 채워져 있거나 확정된 필드는 건드리지 않아요)');
    }
    if (research.differentiation) guideLines.push(`\n💡 차별화 포인트: ${research.differentiation}`);
    if (research.planningPoints)  guideLines.push(`\n📌 기획 반영 포인트: ${research.planningPoints}`);
    guideLines.push('\n이 내용을 바탕으로 기획을 발전시켜볼까요? 장르나 톤부터 같이 정해봐도 좋아요.');

    setPlanningMsgs((prev) => [...prev, { role: 'assistant', content: guideLines.join('\n') }]);
    setTab('planning');
    setSaved(false);
  }

  /* ── 자동 기획 가능 여부 ──
     리서치나 원작 아카이브에 채워진 정보가 있으면, 기획 탭 진입 시 자동 기획을 제안한다. */
  const hasResearchData = Object.values(research).some((v) => typeof v === 'string' && v.trim() !== '');
  const hasArchiveData = (archive?.volumes ?? []).some(
    (v) => v.summary?.trim() || (v.chapters ?? []).some((c) => c.summary?.trim() || c.title?.trim()),
  );
  const canAutoPlan = hasResearchData || hasArchiveData;

  /* ── 탭 전환 ──
     기획 탭에 처음 들어갈 때(아직 대화 전) 리서치/원작에 근거 정보가 있으면
     첫 인사말을 "자동 기획을 시작할까요?" 제안으로 바꾼다. 없으면 기본 인사말 유지. */
  function switchTab(t: ProjectTab) {
    if (t === 'planning' && canAutoPlan) {
      setPlanningMsgs((prev) => {
        // 아직 손대지 않은 기본 인사말일 때만 교체 (이미 대화가 시작됐으면 그대로 둠)
        const pristine = prev.length === 1 && prev[0].role === 'assistant' && prev[0].content === PLANNING_FIRST;
        if (!pristine) return prev;
        const sources = [hasResearchData && '리서치', hasArchiveData && '원작 아카이브'].filter(Boolean).join('와 ');
        const offer = `${sources}에 정리된 내용을 바탕으로 기획을 자동으로 시작해볼 수 있어요. 원하는 기획 방향(장르·톤·타깃 등)이 있으면 알려주세요. 특별히 없으면 "자동으로 잡아줘"라고 말씀해주시면 정리된 내용으로 기획 초안을 만들어 드릴게요.`;
        return [{ role: 'assistant', content: offer }];
      });
    }
    setTab(t);
  }

  /* ── 플랫폼 페이지 붙여넣기 → 지표·독자반응 추출 ── */
  async function analyzePastedMetrics(text: string): Promise<boolean> {
    try {
      const res = await fetch('/api/analyze-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model, mode: 'metrics' }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      recordUsage('research-metrics', data.usage, data.usedModel as ModelId | undefined);

      const ext = (data.extracted ?? {}) as Partial<ResearchData> & { platforms?: { platform: string; views?: string; rating?: string }[] };
      const platforms = (ext.platforms ?? []).filter((p) => p.platform || p.views || p.rating);
      // platforms/sentiment는 별도 처리하므로 문자열 필드만 추림
      const keys = (Object.keys(ext) as (keyof ResearchData)[]).filter((k) => k !== 'platformMetrics' && typeof ext[k] === 'string' && ext[k]);
      // 감정 비율: 세 값이 숫자이고 합이 0보다 클 때만 유효로 인정
      const s = ext.sentiment;
      const validSentiment =
        s && typeof s.positive === 'number' && typeof s.negative === 'number' && typeof s.neutral === 'number' &&
        (s.positive + s.negative + s.neutral) > 0 ? s : null;

      if (keys.length === 0 && platforms.length === 0 && !validSentiment) {
        alert('붙여넣은 텍스트에서 지표나 독자 반응을 찾지 못했어요. 작품 페이지나 댓글 화면의 내용인지 확인해주세요.');
        return false;
      }

      setResearch((prev) => {
        const u = { ...prev };
        for (const k of keys) (u as Record<string, unknown>)[k] = ext[k];
        if (validSentiment) u.sentiment = validSentiment;
        // 추출한 플랫폼 지표는 기존 행에 이어 붙임 (같은 플랫폼명이면 값 갱신)
        if (platforms.length > 0) {
          const rows = [...prev.platformMetrics];
          for (const p of platforms) {
            const existing = rows.find((r) => r.platform && r.platform === p.platform);
            if (existing) {
              if (p.views) existing.views = p.views;
              if (p.rating) existing.rating = p.rating;
            } else {
              rows.push({ id: crypto.randomUUID(), platform: p.platform ?? '', url: '', views: p.views ?? '', rating: p.rating ?? '', comments: '' });
            }
          }
          u.platformMetrics = rows;
        }
        return u;
      });
      setResearchStatuses((prev) => {
        const s = { ...prev };
        for (const k of keys) s[k] = 'inferred';
        return s;
      });
      setSaved(false);
      return true;
    } catch (e: any) {
      alert(e?.message || '분석 중 오류가 발생했어요. 다시 시도해주세요.');
      return false;
    }
  }

  /* ── 원작명으로 웹 검색해서 게재 플랫폼·개요 필드를 자동으로 찾아 채움
     (선택한 모델의 provider 안에서 저비용 모델 + 웹 검색 사용 — Gemini Flash / Claude Haiku / GPT-4o mini) ── */
  async function discoverFromTitle(title: string): Promise<DiscoverResult | null> {
    try {
      const res = await fetch('/api/analyze-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: title, model, mode: 'discover' }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      recordUsage('research-discover', data.usage, data.usedModel as ModelId | undefined);
      const result = data.discover as DiscoverResult;

      // 이미 값이 있는 필드는 덮어쓰지 않음 (사용자가 입력했거나 이전에 채운 값 보호)
      const fillable = (Object.entries(result.fields ?? {}) as [keyof ResearchData, string][])
        .filter(([k, v]) => v && !research[k]);
      // 찾은 플랫폼(이름+링크)을 지표 행으로 자동 생성 — 조회수·평점은 빈 칸(사용자가 채움)
      const foundPlatforms = (result.platforms ?? []).filter((p) => p.platform);

      if (fillable.length > 0 || foundPlatforms.length > 0) {
        setResearch((prev) => {
          const u = { ...prev };
          for (const [k, v] of fillable) (u as Record<string, unknown>)[k] = v;
          if (foundPlatforms.length > 0) {
            const rows = [...prev.platformMetrics];
            for (const p of foundPlatforms) {
              const existing = rows.find((r) => r.platform && r.platform === p.platform);
              if (existing) {
                if (p.url && !existing.url) existing.url = p.url;  // 링크만 보강
              } else {
                rows.push({ id: crypto.randomUUID(), platform: p.platform, url: p.url ?? '', views: '', rating: '', comments: '' });
              }
            }
            u.platformMetrics = rows;
          }
          return u;
        });
        setResearchStatuses((prev) => {
          const s = { ...prev };
          for (const [k] of fillable) s[k] = 'inferred';
          return s;
        });
        setSaved(false);
      }

      // 자동조사에서 찾은 유사작품을 경쟁작 분석 리스트에 자동 추가 (같은 검색에 얹혀서 추가 비용 없음)
      for (const w of result.similarWorksList ?? []) {
        if (w.title?.trim()) addCompetitor(w.title, w.reason ?? '', 'auto');
      }
      return result;
    } catch (e: any) {
      alert(e?.message || '검색 중 오류가 발생했어요. 다시 시도해주세요.');
      return null;
    }
  }

  // 로그아웃 핸들러
  async function handleLogout() {
    try {
      await supabase.auth.signOut();
      setUserId(null);
      setUserEmail(null);
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
        onNew={handleNew}
        onSelect={selectProject}
        onReorder={handleReorder}
        onDuplicate={handleDuplicate}
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
          {(['research', 'archive', 'planning'] as ProjectTab[]).map((t) => (
            <button key={t} onClick={() => switchTab(t)}
              className={`px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 -mb-px ${
                tab === t ? 'text-emerald-600 border-emerald-500' : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t === 'planning' ? '기획' : t === 'archive' ? '원작 아카이브' : '리서치'}
            </button>
          ))}
          {['시리즈 구성', '시나리오'].map((t) => (
            <div key={t} className="flex items-center gap-1 px-4 py-2.5">
              <span className="text-xs text-gray-300 cursor-not-allowed">{t}</span>
              <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">준비 중</span>
            </div>
          ))}
        </div>

        {/* 콘텐츠 영역: 아카이브 탭은 전체 폭, 그 외는 채팅 + 우측 패널 */}
        {tab === 'archive' ? (
          <div className="flex flex-1 overflow-hidden">
            <ArchivePanel
              archive={archive}
              model={model}
              onModelChange={setModel}
              onUpdateVolume={updateArchiveVolume}
              onRemoveVolume={removeArchiveVolume}
              onUpdateChapter={updateArchiveChapter}
              onRemoveChapter={removeArchiveChapter}
              onAutoSplit={autoSplitVolume}
              messages={archiveMsgs}
              chatLoading={archiveLoading}
              onAsk={sendArchiveQuestion}
            />
          </div>
        ) : (
        <div className="flex flex-1 overflow-hidden">

          {/* 채팅 패널 */}
          <div
            className="relative flex flex-col flex-1"
            style={{ minWidth: 0 }}
          >
            {/* 메시지 목록 */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {messages.map((m, i) => {
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

            {/* 입력 영역 (파일을 끌어다 놓으면 자료 업로드) */}
            <div
              className={`px-6 py-4 bg-white border-t shrink-0 transition-colors ${inputDragOver ? 'border-emerald-400 bg-emerald-50/50' : 'border-gray-200'}`}
              onDragOver={(e) => { if (!uploadingDoc) { e.preventDefault(); setInputDragOver(true); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setInputDragOver(false); }}
              onDrop={(e) => { e.preventDefault(); setInputDragOver(false); handleDocPick(e.dataTransfer.files?.[0]); }}
            >
              {inputDragOver && (
                <p className="text-[11px] font-semibold text-emerald-600 mb-2 text-center">📄 여기에 파일을 놓으면 자료 업로드 (PDF·TXT)</p>
              )}
              {/* 모델 선택 + 사용량 보기 */}
              <div className="flex items-center gap-3 mb-2">
                <div className="relative" ref={modelRef}>
                  <button onClick={() => setModelOpen((o) => !o)}
                    className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                    {MODELS.find((m) => m.id === model)?.label ?? model}
                    <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${modelOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {modelOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-60 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50">
                      {MODELS.map((m) => {
                        const pct = providerUsagePct[PROVIDER_OF_MODEL[m.id as ModelId]];
                        const locked = pct >= 100;
                        const warn = pct >= 80;
                        return (
                          <button key={m.id} onClick={() => { setModel(m.id as ModelId); setModelOpen(false); }}
                            className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${model === m.id ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                            <span>{m.label}</span>
                            {warn ? (
                              <span className={`text-[10px] font-semibold ${locked ? 'text-red-500' : 'text-amber-600'}`}>
                                {locked ? '🔒 예산 소진' : '⚠️ 곧 제한될 수 있어요'}
                              </span>
                            ) : (
                              <span className="text-[11px] text-gray-400">{m.desc}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowUsage(true)}
                  className="text-sm text-gray-500 hover:text-emerald-600 transition-colors font-medium"
                  title="팀 AI 사용량 보기"
                >
                  AI 사용량
                </button>
              </div>

              <div className="flex gap-2 items-end">
                {/* 자료 업로드(+): 기획서·리서치 자료·예전에 내보낸 파일을 올리면 빈 항목이 채워짐 */}
                <button
                  onClick={() => docInputRef.current?.click()}
                  disabled={uploadingDoc || loading}
                  title="자료 업로드 — 기획서·리서치 자료·예전에 내보낸 파일(PDF·TXT)을 올리면 기획·리서치 빈 항목을 자동으로 채워요"
                  className="w-11 h-11 flex items-center justify-center shrink-0 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 hover:text-emerald-600 hover:border-emerald-300 disabled:opacity-40 disabled:cursor-wait transition-colors"
                >
                  {uploadingDoc ? (
                    <span className="w-4 h-4 border-2 border-gray-300 border-t-emerald-500 rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  )}
                </button>
                <input
                  ref={docInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                  className="hidden"
                  onChange={(e) => handleDocPick(e.target.files?.[0])}
                />
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  rows={1}
                  placeholder={tab === 'research' ? '리서치 방향을 입력하세요... (Shift+Enter로 줄바꿈)' : '메시지를 입력하세요... (Shift+Enter로 줄바꿈)'}
                  className="flex-1 resize-none overflow-y-auto bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-colors"
                />
                <button onClick={send} disabled={!input.trim() || loading}
                  className="px-5 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors shrink-0">
                  전송
                </button>
              </div>
            </div>
          </div>

          {/* 우측 패널 (좌측 경계를 드래그해서 너비 조절) */}
          <div className="flex shrink-0 border-l border-gray-200" style={{ width: panelWidth }}>
            <div
              onMouseDown={startPanelResize}
              title="드래그해서 패널 너비 조절"
              className="w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-emerald-300 active:bg-emerald-400 transition-colors"
            />
            <div className="flex-1 min-w-0">
              {tab === 'planning' ? (
                <PlanningPanel
                  planning={planning}
                  statuses={planningStatuses}
                  locked={planningLocked}
                  onChange={handlePlanningFieldChange}
                  onToggleConfirm={togglePlanningConfirm}
                />
              ) : (
                <ResearchPanel
                  research={research}
                  statuses={researchStatuses}
                  model={model}
                  onModelChange={setModel}
                  locked={researchLocked}
                  onChange={handleResearchFieldChange}
                  onToggleConfirm={toggleResearchConfirm}
                  onAnalyzeMetrics={analyzePastedMetrics}
                  onDiscover={discoverFromTitle}
                  onApplyToPlanning={applyResearchToPlanning}
                  onAddMetric={addPlatformMetric}
                  onUpdateMetric={updatePlatformMetric}
                  onRemoveMetric={removePlatformMetric}
                  onAddCompetitor={addCompetitor}
                  onRemoveCompetitor={removeCompetitor}
                  onUpdateCompetitor={updateCompetitor}
                  onAnalyzeCompetitor={analyzeCompetitor}
                />
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* 팀 AI 사용량 */}
      {showUsage && <UsageSummary userEmail={userEmail} onClose={() => setShowUsage(false)} />}

    </div>
  );
}
