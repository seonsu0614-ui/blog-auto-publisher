import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 무료 범위 유지용 상한 (config/limits.json).
 * - maxPostsPerDay / maxPostsPerMonth: 발행 수 상한 (Blogger 스팸 판정·jsDelivr 월 50MB 한도 대비)
 * - videoCrf: 영상 압축 강도 (클수록 작고 화질 낮음, 23=기본 화질, 28=약 절반 용량)
 * - maxMediaMBPerPost: 글 1편 미디어 합계 상한. 넘으면 발행 중단 (월 31편 × 1.5MB = 46.5MB < 50MB)
 */
export interface Limits {
  maxPostsPerDay: number;
  maxPostsPerMonth: number;
  videoCrf: number;
  maxMediaMBPerPost: number;
}

export const DEFAULT_LIMITS: Limits = { maxPostsPerDay: 1, maxPostsPerMonth: 31, videoCrf: 28, maxMediaMBPerPost: 1.5 };

export function loadLimits(path = resolve('config/limits.json')): Limits {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Limits>;
    return { ...DEFAULT_LIMITS, ...raw };
  } catch {
    return DEFAULT_LIMITS;
  }
}

/** 오늘·이번 달 발행 수가 상한에 닿았는지 (같은 원고 재실행은 세지 않음) */
export function quotaCheck(
  history: Array<{ date: string; contentId: string; url?: string }>,
  o: { date: string; contentId: string; limits: Limits },
): { ok: boolean; reason?: string; today: number; month: number } {
  const others = history.filter((h) => h.contentId !== o.contentId && h.url);
  const today = others.filter((h) => h.date === o.date).length;
  const month = others.filter((h) => h.date.slice(0, 7) === o.date.slice(0, 7)).length;
  if (today >= o.limits.maxPostsPerDay) return { ok: false, reason: `오늘 발행 상한 도달 (${today}/${o.limits.maxPostsPerDay}편)`, today, month };
  if (month >= o.limits.maxPostsPerMonth) return { ok: false, reason: `이번 달 발행 상한 도달 (${month}/${o.limits.maxPostsPerMonth}편)`, today, month };
  return { ok: true, today, month };
}
