'use client';

import { useState, useEffect, useRef } from 'react';
import type {
  Message, PlanningData, PlanningStatuses,
  ResearchData, ResearchStatuses, ResearchMode, PlatformMetric,
  ProjectTab, Project, UploadedSource, PendingChange,
} from '@/types';
import { defaultPlanningData, defaultResearchData } from '@/types';
import { PLANNING_FIRST, RESEARCH_FIRST, getMockProposals } from '@/lib/mock';
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
import AttachmentCard from './components/AttachmentCard';
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

// ── 컴포넌트 ───────────────────────────────────────────────────
export default function Home() {
  // 인증 상태
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Supabase에서 프로젝트 로드
  const { projects, loading: projectsLoading, saveProject, deleteProject, createNewProject, reorderProjects } = useProjects(userId);

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

  // UI
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [model, setModel]         = useState<ModelId>('gemini');
  const [modelOpen, setModelOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachMode, setAttachMode] = useState<'link' | 'text' | null>(null);
  const [attachInput, setAttachInput] = useState('');
  const [dragOverChat, setDragOverChat] = useState(false);
  const [pendingDropFile, setPendingDropFile] = useState<File | null>(null);
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
  const attachRef   = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /* ── 자동저장: 변경 후 2초간 조용하면 자동으로 저장 ── */
  useEffect(() => {
    if (saved || !currentId) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { handleSave(); }, 2000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, planningMsgs, planning, planningStatuses, researchMsgs, research, researchStatuses, researchMode, uploadedSources, pendingChanges]);

  /* ── 프로젝트 로드 ── */
  function applyProject(p: Project) {
    setCurrentId(p.id);
    setTitle(p.title);
    setTab(p.selectedTab);
    setPlanningMsgs([...p.planningMessages]);
    setPlanning({ ...defaultPlanningData, ...p.planning });
    setPlanningStatuses({ ...p.planningStatuses });
    setResearchMsgs([...p.researchMessages]);
    // 필드 구조가 바뀌기 전에 저장된 프로젝트도 새 필드가 빈 문자열로 채워지도록 병합
    setResearch({ ...defaultResearchData, ...p.research });
    setResearchStatuses({ ...p.researchStatuses });
    setResearchMode(p.researchMode);
    setUploadedSources([...p.uploadedSources]);
    setPendingChanges([...p.pendingChanges]);
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
    let renderedHeight = 0;
    let first = true;
    while (renderedHeight < canvas.height) {
      const maxBottom = Math.min(canvas.height, renderedHeight + pageHeightPx);
      // 이 페이지 구간 안에서 블록 중간을 지나지 않는 가장 아래쪽 경계를 찾아 거기서 자른다.
      // 블록 하나가 한 페이지보다 커서 안전한 경계가 없으면(예: 아주 긴 줄거리) 어쩔 수 없이 그대로 자른다.
      const safeBottoms = blockBottomsPx.filter((b) => b > renderedHeight + 1 && b <= maxBottom);
      const sliceEnd = safeBottoms.length > 0 ? safeBottoms[safeBottoms.length - 1] : maxBottom;
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
        body: JSON.stringify({ messages: next, model, planningData: planning, researchData: research }),
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
        body: JSON.stringify({ messages: next, model, context: 'research', researchData: research }),
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

    // Storage 키는 ASCII만 허용 — 한글·특수문자는 밑줄로 치환 (화면 표시용 file.name은 그대로 유지)
    // \w는 [A-Za-z0-9_]라 한글은 매칭 안 됨 → 한글 파일명은 밑줄로 바뀜
    const safeName = file.name.replace(/[^\w.-]/g, '_').replace(/_+/g, '_');
    // src.id(UUID) 접두사로 파일명이 밑줄만 남더라도 경로가 겹치지 않게 보장
    const path = `${userId}/${currentId}/${src.id}_${safeName}`;
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

    // 텍스트·PDF만 AI 분석 대상 (이미지 등은 저장만)
    const isTextFile = file.type.startsWith('text/') || /\.(txt|md|markdown|csv)$/i.test(file.name);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isTextFile && !isPdf) {
      setSourceStatus({ uploadStatus: 'done', storagePath: path, analysisStatus: 'done' });
      setResearchMsgs((prev) => [...prev, { role: 'assistant', content: `"${file.name}" 파일을 저장했어요. (이미지 등은 자동 분석 대상이 아니라 저장만 했습니다.)` }]);
      return;
    }

    setSourceStatus({ uploadStatus: 'done', storagePath: path, analysisStatus: 'analyzing' });

    // 원작 텍스트/PDF를 읽어 AI로 각색 리서치 필드 추출
    try {
      // PDF는 base64로, 텍스트 파일은 문자열로 서버에 전달
      const body = isPdf
        ? { pdfBase64: await fileToBase64(file), fileName: file.name, model }
        : { text: await file.text(), model };
      const res = await fetch('/api/analyze-source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      recordUsage('research-analyze', data.usage, data.usedModel as ModelId | undefined);

      const ext = (data.extracted ?? {}) as Partial<ResearchData>;
      const keys = (Object.keys(ext) as (keyof ResearchData)[]).filter((k) => ext[k]);

      if (keys.length > 0) {
        setResearch((prev) => {
          const u = { ...prev };
          for (const k of keys) (u as Record<string, unknown>)[k] = ext[k];
          return u;
        });
        setResearchStatuses((prev) => {
          const s = { ...prev };
          for (const k of keys) s[k] = 'inferred';
          return s;
        });
      }

      setSourceStatus({ analysisStatus: 'done' });

      if (keys.length > 0) {
        // 원작 파일로는 알 수 없는 필드(플랫폼 지표·독자 반응·시장 리서치)가 비었으면
        // 지어내지 않고, 어떻게 채우는지 방법을 안내한다.
        const filledOrExt = (k: keyof ResearchData) => ext[k] || research[k];
        const needsPlatformData = !filledOrExt('metricsOfficial') || !filledOrExt('reactionPositive') || !filledOrExt('reactionNegative');
        const needsMarketResearch = !filledOrExt('similarWorks') || !filledOrExt('genreTrends') || !filledOrExt('differentiation');

        const parts = [`"${file.name}" 원작을 분석해서 오른쪽 리서치 정보를 채웠어요. 확인하고 맞으면 "확정"해주세요.`];
        if (needsPlatformData || needsMarketResearch) {
          parts.push('\n아직 비어 있는 항목은 원작 파일만으로는 알 수 없어요. 이렇게 채울 수 있어요:');
        }
        if (needsPlatformData) {
          parts.push(
            '\n📊 플랫폼 지표·독자 반응 (조회수·평점·댓글)\n'
            + '  ① 오른쪽 "원작명"을 확인하고 그 아래 🔍 "AI로 자동 조사하기"를 누르면 게재 플랫폼을 찾아드려요.\n'
            + '  ② 카카오페이지·문피아·리디 등 작품 페이지를 열어 조회수·평점·별점, 그리고 댓글/리뷰를 드래그해 복사하세요.\n'
            + '  ③ 🔗 "플랫폼 데이터 가져오기 도우미"에 붙여넣고 "분석해서 채우기"를 누르면 지표·긍정/부정 반응으로 정리해드려요. (숫자는 제가 만들지 않고 붙여주신 것만 정리해요)'
          );
        }
        if (needsMarketResearch) {
          parts.push('\n🔍 유사 작품·장르 트렌드·차별화 포인트\n  채팅으로 "유사작이랑 차별화 포인트 분석해줘"라고 말씀해주시면 제가 정리해드릴게요.');
        }
        setResearchMsgs((prev) => [...prev, { role: 'assistant', content: parts.join('\n') }]);
      } else {
        setResearchMsgs((prev) => [...prev, {
          role: 'assistant',
          content: `"${file.name}"을 읽었는데 각색 리서치 정보를 뽑아내지 못했어요. 파일 내용을 확인해주세요.`,
        }]);
      }
    } catch (e: any) {
      console.error('원작 분석 실패:', e);
      setSourceStatus({ analysisStatus: 'error' });
      const content = e?.message || `"${file.name}" 분석 중 오류가 발생했어요. 다시 시도해주세요.`;
      setResearchMsgs((prev) => [...prev, { role: 'assistant', content }]);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFileSource(file);
    e.target.value = '';
    setAttachOpen(false);
  }

  /* ── 드래그 앤 드롭 첨부 (리서치 탭 전용) ── */
  function handleChatDragOver(e: React.DragEvent) {
    if (tab !== 'research') return;
    e.preventDefault();
    setDragOverChat(true);
  }
  function handleChatDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverChat(false);
  }
  function handleChatDrop(e: React.DragEvent) {
    if (tab !== 'research') return;
    e.preventDefault();
    setDragOverChat(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setPendingDropFile(file);
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
          <div
            className="relative flex flex-col flex-1"
            style={{ minWidth: 0 }}
            onDragOver={handleChatDragOver}
            onDragLeave={handleChatDragLeave}
            onDrop={handleChatDrop}
          >
            {dragOverChat && (
              <div className="absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-emerald-400 bg-emerald-50/80 pointer-events-none">
                <p className="text-sm font-semibold text-emerald-600">여기에 파일을 놓아주세요</p>
              </div>
            )}
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
                  onChange={handlePlanningFieldChange}
                  onToggleConfirm={togglePlanningConfirm}
                />
              ) : (
                <ResearchPanel
                  research={research}
                  statuses={researchStatuses}
                  model={model}
                  onChange={handleResearchFieldChange}
                  onAnalyzeMetrics={analyzePastedMetrics}
                  onDiscover={discoverFromTitle}
                  onApplyToPlanning={applyResearchToPlanning}
                  onAddMetric={addPlatformMetric}
                  onUpdateMetric={updatePlatformMetric}
                  onRemoveMetric={removePlatformMetric}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 팀 AI 사용량 */}
      {showUsage && <UsageSummary userEmail={userEmail} onClose={() => setShowUsage(false)} />}

      {/* 드래그로 끌어온 파일 첨부 확인 */}
      {pendingDropFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl shadow-xl p-5 w-80">
            <p className="text-sm font-semibold text-gray-800 mb-1">이 파일을 첨부하시겠습니까?</p>
            <p className="text-xs text-gray-500 mb-4 truncate">{pendingDropFile.name}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingDropFile(null)}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => { uploadFileSource(pendingDropFile); setPendingDropFile(null); }}
                className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
              >
                첨부
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
