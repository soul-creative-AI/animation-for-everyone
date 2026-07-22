import type { Project, PlanningData, WorkType } from '@/types';
import { defaultPlanningData, defaultResearchData, defaultArchive } from '@/types';
import { PLANNING_FIRST, RESEARCH_FIRST, ARCHIVE_FIRST } from '@/lib/mock';

// ── 구버전 데이터 마이그레이션 ─────────────────────────────────
// (현재는 호출되는 곳이 없음 — 구버전 JSON 구조 복구가 필요해질 때 사용)
export function migrateProject(raw: any): Project {
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
    archive:        raw.archive        ?? { volumes: [] },
    archiveMessages: raw.archiveMessages ?? [{ role: 'assistant', content: ARCHIVE_FIRST }],
  };
}

// ── 새 프로젝트 생성 ──────────────────────────────────────────
export function createProject(): Project {
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
    archive: { ...defaultArchive, volumes: [] },
    archiveMessages: [{ role: 'assistant', content: ARCHIVE_FIRST }],
  };
}

// ── 프로젝트 복제 ─────────────────────────────────────────────
// 기존 프로젝트를 깊은 복사해서 새 id·제목("… (사본)")·타임스탬프로 만든다.
export function duplicateProject(src: Project): Project {
  const now = new Date().toISOString();
  // 구조가 중첩된 객체·배열이라 JSON 깊은 복사로 원본과 참조를 완전히 끊는다
  const clone = JSON.parse(JSON.stringify(src)) as Project;
  return {
    ...clone,
    id: crypto.randomUUID(),
    title: `${src.title} (사본)`,
    createdAt: now,
    updatedAt: now,
    sortOrder: 0, // saveProject에서 맨 뒤 순서로 재배정됨
  };
}

// ── 사이드바 날짜 표기 (M/D HH:MM) ────────────────────────────
export function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
