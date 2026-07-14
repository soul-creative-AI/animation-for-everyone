import type { Proposal, PendingChange, ResearchData, PlanningData } from '@/types';

const PLANNING_FIRST = '어떤 애니메이션을 만들고 싶으세요?\n간단한 아이디어도 좋아요. 장르, 분위기, 떠오르는 장면 등 자유롭게 말씀해주세요!';
const RESEARCH_FIRST = '리서치를 시작하기 전에 하나만 확인할게요.\n이 작품은 오리지널인가요, 아니면 원작이 있는 각색 작품인가요? 각색이라면 원작 파일을 첨부해주셔도 좋아요. (오른쪽 패널의 "원작 각색" 항목은 오리지널이면 비워두시면 됩니다.)';

export { PLANNING_FIRST, RESEARCH_FIRST };

// ── 리서치 탭 mock 응답 ───────────────────────────────────────

interface ResearchResponse {
  text: string;
  extractedResearch?: Partial<ResearchData>;
  pendingChange?: PendingChange;
  proposals?: Proposal[];
}

export function getMockResearchResponse(input: string, turnIndex: number): ResearchResponse {
  const lower = input.toLowerCase();

  if (turnIndex === 0 || lower.includes('시작') || lower.includes('분석') || lower.includes('리서치')) {
    return {
      text: '분석을 시작할게요. 유사 작품과 장르 트렌드를 조사했습니다.',
      extractedResearch: {
        similarWorks: '소녀혁명 우테나, 마법소녀 마도카☆마기카, 스티븐 유니버스. '
          + 'OTT 기반 감성 판타지 수요 증가 추세 속 흥행작들 — 캐릭터 심리 묘사에 대한 호평이 공통적으로 많음.',
        genreTrends: '10대 후반~20대 초반 여성 타깃 작품 흥행률 상승. 단순 배틀물 구성에는 피로감을 느낀다는 반응이 많음.',
      },
    };
  }

  if (lower.includes('타깃') || lower.includes('target')) {
    return {
      text: '타깃 분석 결과, 기획의 장르 방향을 조정하는 것이 유리할 수 있어요.',
      pendingChange: {
        id: crypto.randomUUID(),
        fieldKey: 'genre',
        fieldLabel: '장르',
        current: '판타지',
        suggested: '판타지, 감성 성장',
        reason: '유사 작품 흥행 데이터와 OTT 시청자 분석 결과, 감성 성장 요소가 결합된 판타지 작품의 반응률이 높게 나타남.',
      },
    };
  }

  if (lower.includes('방향') || lower.includes('제안') || lower.includes('안을') || turnIndex >= 3) {
    return {
      text: '리서치 결과를 바탕으로 세 가지 방향을 제안드릴게요.',
      proposals: getMockProposals(),
    };
  }

  if (lower.includes('차별') || lower.includes('경쟁')) {
    return {
      text: '차별화 가능성을 분석했습니다.',
      extractedResearch: {
        differentiation: '감정 성장 + 로봇 서사 조합은 국내에 전례 없는 포지션. 판타지 세계관 내 기계 문명 설정이 차별 포인트. '
          + '피해야 할 클리셰: 선택받은 주인공, 비밀 특수 능력 각성, 악당의 갑작스러운 선행. '
          + '시도해볼 조합: 로봇 + 감정 성장 + 판타지 세계관 / 앙상블 구조 + 단독 주인공 없는 서사',
      },
    };
  }

  return {
    text: '흥미로운 포인트네요. 조금 더 구체적으로 말씀해주시면 더 정확한 리서치 결과를 드릴 수 있어요. 유사 작품, 시장 반응, 차별화 가능성 중 어느 방향이 궁금하신가요?',
  };
}

// ── A/B/C 제안 mock 데이터 ────────────────────────────────────

export function getMockProposals(): Proposal[] {
  return [
    {
      id: 'a',
      label: 'A',
      title: '따뜻한 감성 성장물',
      summary: '로봇이 인간과의 교감을 통해 감정을 배워가는 치유 서사',
      pros: ['넓은 타깃 공감대', 'OTT 흥행 가능성 높음', '캐릭터 상품화 유리'],
      cons: ['장르 경쟁 치열', '차별화 포인트 약함'],
      differentiation: '판타지 세계관 + 로봇이라는 독특한 조합',
      expectedTarget: '15~29세, 감성 콘텐츠 선호층',
      productionDifficulty: '보통',
      affectedFields: { genre: '판타지, 감성 성장', tone: '따뜻하고 잔잔한' },
    },
    {
      id: 'b',
      label: 'B',
      title: '코미디 액션 판타지',
      summary: '감정을 오해하며 벌어지는 소동과 모험',
      pros: ['가벼운 진입 장벽', '다양한 연령대 접근 가능', '시즌 확장 용이'],
      cons: ['감동 요소 약화', '캐릭터 깊이 확보 어려움'],
      differentiation: '웃음과 액션 속에서 드러나는 감정 성장',
      expectedTarget: '10~24세, 액션+코미디 선호층',
      productionDifficulty: '보통',
      affectedFields: { genre: '판타지, 코미디, 액션', tone: '유쾌하고 경쾌한' },
    },
    {
      id: 'c',
      label: 'C',
      title: '미스터리 판타지',
      summary: '로봇이 감정을 숨기는 이유를 추적하는 서사',
      pros: ['강한 몰입감', '마니아층 형성 유리', '작품성 인정 가능성'],
      cons: ['진입 장벽 높음', '대중적 흥행 불확실'],
      differentiation: '감정이 범죄/비밀과 연결되는 독창적 구조',
      expectedTarget: '18~35세, 서사 깊이 선호층',
      productionDifficulty: '어려움',
      affectedFields: { genre: '판타지, 미스터리', tone: '긴장감 있고 어두운' },
    },
  ];
}

// ── 기획 탭: AI 필드 추출 시 상태 inferred 처리는 page.tsx에서 ──
