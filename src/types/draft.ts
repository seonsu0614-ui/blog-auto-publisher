import type { ContentCategory, FAQItem, Source } from './content.ts';
import type { MediaSpec } from './media.ts';

/**
 * 작성 단계의 원고 구조 (ArticleDraft).
 * Claude가 리서치·팩트체크 후 이 JSON을 만들고, 코드가 HTML 변환·검사를 담당한다.
 * 본문 문장에는 출처 표시 [S1], 근거 표시 {C1}을 붙일 수 있다.
 *   [S1] → 출처 목록 1번 각주 링크로 변환
 *   {C1} → 화면에는 보이지 않음. "이 숫자는 주장 C1로 검증됨"을 검사기에 알리는 표시
 * 굵게: **문장**
 */

export type Block =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'table'; caption?: string; headers: string[]; rows: string[][]; note?: string }
  | { type: 'callout'; text: string }
  | { type: 'image'; slot: number } // Phase 3에서 이미지로 치환되는 자리
  | { type: 'video' }; // Phase 3에서 영상으로 치환되는 자리

export interface Section {
  heading: string;
  level: 2 | 3;
  blocks: Block[];
}

/** 검증 대상 주장. 숫자·날짜·정책 내용은 반드시 여기 등록된 근거를 가져야 한다. */
export interface Claim {
  id: string; // C1, C2 ...
  claim: string;
  /** 본문에 쓰인 값 그대로 (예: "2.50%", "1,000만 원", "2026년 1월 1일") */
  value?: string;
  referenceDate?: string; // 자료 기준일 YYYY-MM-DD
  condition?: string; // 적용 조건
  sourceIds: string[]; // S1, S2 ...
  /** 계산 주장: 예 "100000000 * 0.04 * 1" — 검사기가 직접 계산해 value와 비교 */
  formula?: string;
  verified: boolean;
  conflict: boolean;
  /** 충돌 시 각 출처가 말하는 값 */
  conflictDetail?: string;
  notes?: string;
}

export interface DraftSource extends Source {
  id: string; // S1, S2 ...
}

/** 주제 평가 요소: 데이터가 없으면 'unknown'으로 두고 절대 숫자를 지어내지 않는다 */
export type Level = 'high' | 'medium' | 'low' | 'unknown';

export interface TopicFactors {
  searchDemand: Level;
  adValue: Level;
  freshness: Level;
  depth: Level;
  differentiation: Level;
  intentClarity: Level;
  competition: Level;
  factCheckDifficulty: Level;
  contentRisk: Level;
}

export interface TopicCandidate {
  topic: string;
  category: ContentCategory;
  primaryKeyword: string;
  angle: string; // 이 글만의 관점
  whyNow: string; // 지금 써야 하는 이유 (근거 출처 포함 가능)
  factors: TopicFactors;
  /** 실측 데이터가 있을 때만 기록 (예: 검색량 도구 결과). 없으면 비워둔다 */
  measured?: { searchVolume?: number; cpc?: number; source: string };
  evidenceUrls?: string[];
}

export interface ArticleDraft {
  contentId: string; // YYYYMMDD-NNN
  date: string; // YYYY-MM-DD (작성 기준일)
  topic: string;
  category: ContentCategory;
  searchIntent: string;
  differentiation?: string; // 기존 글과 다른 점 (중복 판정 완화용)

  title: string;
  seoTitle: string;
  metaDescription: string;
  slug?: string;

  primaryKeyword: string;
  secondaryKeywords: string[];
  relatedKeywords: string[];

  hook: string[]; // 첫 3~5문장
  summary: string[]; // 핵심 요약 bullet
  sections: Section[];
  faq: FAQItem[];
  closing: string[]; // 핵심 정리 bullet

  sources: DraftSource[];
  claims: Claim[];
  tags: string[];

  /** 이미지·영상 사양 (Phase 3). 안의 문장도 팩트체크 대상 */
  media?: MediaSpec;

  topicCandidates?: TopicCandidate[]; // 주제 선정 근거 기록
}
