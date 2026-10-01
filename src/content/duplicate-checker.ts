import type { ArticleDraft } from '../types/draft.ts';

/**
 * 중복 콘텐츠 검사. 제목만 바꾼 재생산을 막는다.
 * 비교 대상: 발행 원장/이력 (제목, 핵심 키워드, 주제, 날짜).
 */

export interface HistoryEntry {
  date: string; // YYYY-MM-DD
  title: string;
  topic: string;
  primaryKeyword: string;
  url?: string;
  tags?: string[];
}

export interface DuplicateResult {
  isDuplicate: boolean;
  detail?: string;
  closest?: { title: string; titleSimilarity: number; topicSimilarity: number; sameKeyword: boolean; daysApart: number };
  internalLinkCandidates: HistoryEntry[];
}

function bigrams(s: string): Set<string> {
  const t = s.replace(/[\s\p{P}]/gu, '').toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

export const DUP_RULES = {
  titleSimilarity: 0.6, // 이 이상이면 중복
  topicSimilarity: 0.7,
  sameKeywordWindowDays: 14, // 같은 핵심 키워드는 14일 안에 다시 쓰지 않음(새 관점 명시 시 예외)
  relatedThreshold: 0.25, // 내부 링크 후보 기준
};

export function checkDuplicate(d: ArticleDraft, history: HistoryEntry[]): DuplicateResult {
  let worst: DuplicateResult['closest'];
  const reasons: string[] = [];
  const related: Array<{ h: HistoryEntry; score: number }> = [];

  for (const h of history) {
    const ts = similarity(d.title, h.title);
    const tp = similarity(d.topic, h.topic);
    const sameKw = h.primaryKeyword.trim() === d.primaryKeyword.trim();
    const gap = days(d.date, h.date);
    if (!worst || ts > worst.titleSimilarity) worst = { title: h.title, titleSimilarity: ts, topicSimilarity: tp, sameKeyword: sameKw, daysApart: gap };

    if (ts >= DUP_RULES.titleSimilarity) reasons.push(`제목 유사(${(ts * 100).toFixed(0)}%): ${h.title}`);
    else if (tp >= DUP_RULES.topicSimilarity) reasons.push(`주제 유사(${(tp * 100).toFixed(0)}%): ${h.topic}`);
    else if (sameKw && gap < DUP_RULES.sameKeywordWindowDays && !d.differentiation?.trim()) {
      reasons.push(`같은 핵심 키워드를 ${gap.toFixed(0)}일 전에 사용: ${h.title} (새 관점이면 differentiation에 기록)`);
    }

    const rel = Math.max(ts, tp, sameKw ? 0.5 : 0, ...(h.tags ?? []).map((t) => (d.tags.includes(t) ? 0.3 : 0)));
    if (rel >= DUP_RULES.relatedThreshold && h.url) related.push({ h, score: rel });
  }

  return {
    isDuplicate: reasons.length > 0,
    detail: reasons.join(' / ') || undefined,
    closest: worst,
    internalLinkCandidates: related.sort((a, b) => b.score - a.score).slice(0, 3).map((r) => r.h),
  };
}
