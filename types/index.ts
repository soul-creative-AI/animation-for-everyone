export type FieldStatus = 'confirmed' | 'inferred' | 'undecided' | 'suggested';
export type ProjectTab   = 'planning' | 'research';
export type ResearchMode = 'original' | 'adaptation';

// ── 메시지 ──────────────────────────────────────────────────
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  card?: MessageCard;
}

export type MessageCard =
  | { type: 'attachment';      source: UploadedSource }
  | { type: 'proposal';        proposals: Proposal[] }
  | { type: 'change-proposal'; change: PendingChange };

// ── 기획 데이터 ──────────────────────────────────────────────
export type WorkType = 'original' | 'adaptation' | 'series' | 'feature' | 'undecided';

export interface PlanningData {
  title: string;
  workType: WorkType;
  genre: string;
  tone: string;
  logline: string;
  theme: string;
  synopsis: string;
  visualStyle: string;
  targetAudience: string;
  episodeCount: string;
  runtime: string;
  protagonist: string;
  keyCharacters: string;
}

export const defaultPlanningData: PlanningData = {
  title: '',
  workType: 'undecided',
  genre: '',
  tone: '',
  logline: '',
  theme: '',
  synopsis: '',
  visualStyle: '',
  targetAudience: '',
  episodeCount: '',
  runtime: '',
  protagonist: '',
  keyCharacters: '',
};

export type PlanningStatuses = Record<string, FieldStatus | undefined>;

// ── 리서치 데이터 ─────────────────────────────────────────────
export interface ResearchData {
  // 공통
  purpose: string; subject: string; scope: string; summary: string;
  keyFindings: string; similarWorks: string; marketResponse: string;
  targetResponse: string; differentiation: string; planningPoints: string;
  risks: string; sources: string;
  // 원작 각색
  originalTitle: string; originalFormat: string; fullPlot: string;
  episodeSummaries: string; mainCharacters: string; characterRelations: string;
  worldRules: string; keyEvents: string; emotionalArcs: string; keyTwists: string;
  mustKeep: string; compressible: string; removable: string;
  adaptationRisks: string; fanSensitivities: string;
  // 오리지널
  sourceBackground: string; similarMaterials: string; genreTrends: string;
  targetPreferences: string; overusedCliches: string; newCombinations: string;
  productionDifficulty: string;
}

export const defaultResearchData: ResearchData = {
  purpose: '', subject: '', scope: '', summary: '', keyFindings: '',
  similarWorks: '', marketResponse: '', targetResponse: '', differentiation: '',
  planningPoints: '', risks: '', sources: '',
  originalTitle: '', originalFormat: '', fullPlot: '', episodeSummaries: '',
  mainCharacters: '', characterRelations: '', worldRules: '', keyEvents: '',
  emotionalArcs: '', keyTwists: '', mustKeep: '', compressible: '',
  removable: '', adaptationRisks: '', fanSensitivities: '',
  sourceBackground: '', similarMaterials: '', genreTrends: '',
  targetPreferences: '', overusedCliches: '', newCombinations: '',
  productionDifficulty: '',
};

export type ResearchStatuses = Partial<Record<keyof ResearchData, FieldStatus>>;

// ── 첨부 자료 ─────────────────────────────────────────────────
export interface UploadedSource {
  id: string;
  type: 'file' | 'link' | 'text';
  name: string;
  uploadStatus: 'uploading' | 'done' | 'error';
  analysisStatus: 'pending' | 'analyzing' | 'done' | 'error';
}

// ── A/B/C 제안 ────────────────────────────────────────────────
export interface Proposal {
  id: string;
  label: 'A' | 'B' | 'C';
  title: string;
  summary: string;
  pros: string[];
  cons: string[];
  differentiation: string;
  expectedTarget: string;
  productionDifficulty: '쉬움' | '보통' | '어려움';
  affectedFields: Partial<PlanningData>;
}

// ── 기획 변경 제안 ────────────────────────────────────────────
export interface PendingChange {
  id: string;
  fieldKey: keyof PlanningData;
  fieldLabel: string;
  current: string;
  suggested: string;
  reason: string;
}

// ── 프로젝트 ──────────────────────────────────────────────────
export interface Project {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  selectedTab: ProjectTab;
  // 기획 탭
  planningMessages: Message[];
  planning: PlanningData;
  planningStatuses: PlanningStatuses;
  // 리서치 탭
  researchMessages: Message[];
  research: ResearchData;
  researchStatuses: ResearchStatuses;
  researchMode: ResearchMode;
  uploadedSources: UploadedSource[];
  pendingChanges: PendingChange[];
}
