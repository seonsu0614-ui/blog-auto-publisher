import type { Level, TopicCandidate, TopicFactors } from '../types/draft.ts';

/**
 * 주제 점수 (정성 평가).
 * Topic Score = 검색수요 + 광고가치 + 최신성 + 확장성 + 차별화 + 의도명확성 - 경쟁도 - 검증난이도 - 리스크
 * 실측 검색량/CPC가 없으면 'unknown' → 0점 처리하고 "확인 불가"로 표시한다. 숫자를 지어내지 않는다.
 */

const LV: Record<Level, number | null> = { high: 3, medium: 2, low: 1, unknown: null };

const POSITIVE: Array<keyof TopicFactors> = ['searchDemand', 'adValue', 'freshness', 'depth', 'differentiation', 'intentClarity'];
const NEGATIVE: Array<keyof TopicFactors> = ['competition', 'factCheckDifficulty', 'contentRisk'];

export const FACTOR_LABEL: Record<keyof TopicFactors, string> = {
  searchDemand: '검색 수요',
  adValue: '광고 가치',
  freshness: '최신성',
  depth: '정보 확장성',
  differentiation: '차별화',
  intentClarity: '검색 의도 명확성',
  competition: '경쟁도',
  factCheckDifficulty: '사실검증 난이도',
  contentRisk: '콘텐츠 리스크',
};

export interface ScoredTopic {
  candidate: TopicCandidate;
  score: number;
  unknownFactors: string[];
  excluded?: string;
  breakdown: string;
}

export function scoreTopic(c: TopicCandidate): ScoredTopic {
  let score = 0;
  const unknown: string[] = [];
  const parts: string[] = [];
  for (const k of [...POSITIVE, ...NEGATIVE]) {
    const v = LV[c.factors[k]];
    const sign = NEGATIVE.includes(k) ? -1 : 1;
    if (v === null) {
      unknown.push(FACTOR_LABEL[k]);
      parts.push(`${FACTOR_LABEL[k]} 확인 불가`);
      continue;
    }
    score += sign * v;
    parts.push(`${FACTOR_LABEL[k]} ${sign > 0 ? '+' : '-'}${v}`);
  }
  let excluded: string | undefined;
  if (c.factors.contentRisk === 'high') excluded = '콘텐츠 리스크 높음';
  else if (c.factors.factCheckDifficulty === 'high' && c.category !== '생활경제') excluded = '사실검증 난이도 높음';
  return { candidate: c, score, unknownFactors: unknown, excluded, breakdown: parts.join(', ') };
}

/** 점수순 정렬, 제외 조건·중복 키워드 제거 후 1위 선택 */
export function selectTopic(cands: TopicCandidate[], recentKeywords: string[] = []): { selected?: ScoredTopic; ranked: ScoredTopic[] } {
  const ranked = cands
    .map(scoreTopic)
    .map((s) => (recentKeywords.includes(s.candidate.primaryKeyword) ? { ...s, excluded: s.excluded ?? '최근 사용한 핵심 키워드' } : s))
    .sort((a, b) => b.score - a.score);
  return { selected: ranked.find((r) => !r.excluded), ranked };
}
