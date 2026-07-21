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

// ── 독자 감정 비율 (AI가 댓글·리뷰를 분석해 산출, 도넛 차트용) ──────────
export interface SentimentBreakdown {
  positive: number;  // 긍정 % (0~100)
  negative: number;  // 부정 %
  neutral: number;   // 중립 %
}

// ── 플랫폼별 지표 (조회수·평점) — 플랫폼마다 한 행 ─────────────────
export interface PlatformMetric {
  id: string;
  platform: string;  // 플랫폼명 (카카오페이지, 문피아 등)
  url: string;       // 작품 페이지 링크 (자동조사로 채워지거나 직접 입력)
  views: string;     // 조회수 (직접 확인한 수치)
  rating: string;    // 평점/별점
  comments: string;  // 이 플랫폼의 댓글·리뷰 (페이지에서 복사한 것)
}

// ── 리서치 데이터 (원작 IP 분석 보고서 구조) ─────────────────────
export interface ResearchData {
  // 1. 작품 개요 — AI 분석 가능 (원작 텍스트 기반)
  originalTitle: string;        // 원작명
  overviewAuthor: string;       // 작가
  originalFormat: string;       // 원작 형식 (웹툰/웹소설 등)
  overviewGenreStatus: string;  // 장르 / 연재 상태
  overviewPlatforms: string;    // 유통 플랫폼
  overviewPremise: string;      // 핵심 설정
  // 2. 플랫폼 공식 지표 — 반드시 직접 확인한 수치만 (AI가 채우지 않음)
  platformMetrics: PlatformMetric[]; // 플랫폼별 조회수·평점 (플랫폼마다 한 행)
  metricsOfficial: string;      // (레거시) 이전 버전의 단일 텍스트 지표 — 하위호환용
  metricsInterpretation: string;// 지표 해석 (기획 관점)
  // 3. 독자 반응 분석 — 직접 수집한 리뷰/댓글 기반
  reactionPositive: string;     // 긍정 반응 키워드/요지
  reactionNegative: string;     // 부정 반응 키워드/요지
  sentiment: SentimentBreakdown | null; // AI가 산출한 긍정/부정/중립 비율 (없으면 null)
  // 4. 독자층 프로파일 — 관측 가능한 신호 기반 정성 해석
  audienceProfile: string;
  // 5. 작품 요소/평가/근거요지
  elementEvaluation: string;
  // 6. 애니메이션 각색 관점 시사점
  adaptationInsights: string;
  // 시장 리서치 (공통)
  similarWorks: string; genreTrends: string;
  differentiation: string; planningPoints: string;
  // 원작 콘텐츠 분석 (각색 작업용)
  fullPlot: string;
  episodeSummaries: string; mainCharacters: string; characterRelations: string;
  keyEvents: string;
  mustKeep: string; compressible: string; removable: string;
}

export const defaultResearchData: ResearchData = {
  originalTitle: '', overviewAuthor: '', originalFormat: '',
  overviewGenreStatus: '', overviewPlatforms: '', overviewPremise: '',
  platformMetrics: [], metricsOfficial: '', metricsInterpretation: '',
  reactionPositive: '', reactionNegative: '', sentiment: null,
  audienceProfile: '', elementEvaluation: '',
  adaptationInsights: '',
  similarWorks: '', genreTrends: '',
  differentiation: '', planningPoints: '',
  fullPlot: '', episodeSummaries: '',
  mainCharacters: '', characterRelations: '', keyEvents: '',
  mustKeep: '', compressible: '', removable: '',
};

export type ResearchStatuses = Partial<Record<keyof ResearchData, FieldStatus>>;

// ── 첨부 자료 ─────────────────────────────────────────────────
export interface UploadedSource {
  id: string;
  type: 'file' | 'link' | 'text';
  name: string;
  uploadStatus: 'uploading' | 'done' | 'error';
  analysisStatus: 'pending' | 'analyzing' | 'done' | 'error';
  storagePath?: string; // Supabase Storage(research-sources 버킷) 안의 원본 파일 경로, type: 'file'만 해당
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
