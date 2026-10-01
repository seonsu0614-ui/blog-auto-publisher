import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HistoryEntry } from '../content/duplicate-checker.ts';

/**
 * 발행 이력 (data/history.json). 중복 검사·내부 링크 후보·향후 성과 분석의 기준 데이터.
 * 성과 필드(views 등)는 실제 데이터가 들어오기 전까지 비워 둔다(임의 값 금지).
 */

export interface PublishedEntry extends HistoryEntry {
  contentId: string;
  category: string;
  postId?: string;
  secondaryKeywords?: string[];
  searchIntent?: string;
  wordCount?: number;
  imageCount?: number;
  videoCreated?: boolean;
  publishedAt?: string;
  // Phase 6에서 채움 (실측값만)
  metrics?: {
    collectedAt: string;
    pageViews?: number;
    organicSearchTraffic?: number;
    searchImpressions?: number;
    clicks?: number;
    ctr?: number;
    averageEngagementTimeSec?: number;
    adImpressions?: number;
    adClicks?: number;
    estimatedRevenue?: number;
    rpm?: number;
    source: string;
  }[];
}

export async function readHistory(path: string): Promise<PublishedEntry[]> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PublishedEntry[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** contentId 기준 upsert (재실행해도 중복 행이 생기지 않음) */
export async function upsertHistory(path: string, entry: PublishedEntry): Promise<void> {
  const all = await readHistory(path);
  const i = all.findIndex((e) => e.contentId === entry.contentId);
  if (i >= 0) all[i] = { ...all[i], ...entry, metrics: all[i]!.metrics ?? entry.metrics };
  else all.push(entry);
  all.sort((a, b) => a.date.localeCompare(b.date));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(all, null, 2));
  await rename(`${path}.tmp`, path);
}
