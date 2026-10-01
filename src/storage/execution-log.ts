import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * 실행 로그. 실행 1회 = 파일 1개 (data/logs/YYYY/MM/<runId>.json).
 * 단계마다 상태·시작/종료 시간·재시도 횟수·오류를 남긴다.
 * 워크스페이스가 비영구적일 수 있으므로 실행 후 GitHub/Drive로 동기화하는 것을 전제로 한다.
 */

export type RunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'RESEARCHING'
  | 'WRITING'
  | 'MEDIA_CREATING'
  | 'QA'
  | 'PUBLISHING'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED'
  | 'REVIEW_REQUIRED';

export type StepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'REVIEW_REQUIRED';

export type StepName = 'load_draft' | 'fact_check' | 'media' | 'quality_check' | 'publish' | 'verify_publish' | 'save_history';

export interface StepLog {
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  attempts: number;
  detail?: string;
  error?: string;
}

export interface RunLog {
  runId: string;
  mode: 'preview' | 'publish';
  date: string;
  contentId?: string;
  draftPath: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  executionTimeMs?: number;
  steps: Partial<Record<StepName, StepLog>>;
  // 요약 (요청서 28번 항목)
  topic?: string;
  category?: string;
  keywords?: string[];
  title?: string;
  sources?: string[];
  imageCount?: number;
  videoCreated?: boolean;
  wordCount?: number;
  factCheck?: string;
  qualityCheck?: string;
  publishStatus?: string;
  bloggerPostId?: string;
  bloggerUrl?: string;
  duplicatePrevented?: boolean;
  errors: string[];
}

const nowIso = () => new Date().toISOString();

export function newRunLog(o: { mode: RunLog['mode']; draftPath: string; date?: string }): RunLog {
  const d = o.date ?? new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  return { runId: `${stamp}-${o.mode}`, mode: o.mode, date: d, draftPath: o.draftPath, status: 'PENDING', startedAt: nowIso(), steps: {}, errors: [] };
}

/** 단계 실행 래퍼: 상태·시간·재시도·오류를 자동 기록 */
export async function step<T>(
  log: RunLog,
  name: StepName,
  fn: (attempt: number) => Promise<T>,
  opts: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void>; persist?: (l: RunLog) => Promise<void> } = {},
): Promise<T> {
  const retries = opts.retries ?? 1;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const s: StepLog = { status: 'RUNNING', startedAt: nowIso(), attempts: 0 };
  log.steps[name] = s;
  await opts.persist?.(log);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    s.attempts = attempt;
    try {
      const out = await fn(attempt);
      s.status = 'SUCCESS';
      s.endedAt = nowIso();
      await opts.persist?.(log);
      return out;
    } catch (e) {
      lastErr = e;
      s.error = (e as Error).message ?? String(e);
      if (attempt < retries) await sleep((opts.delayMs ?? 2000) * attempt);
    }
  }
  s.status = 'FAILED';
  s.endedAt = nowIso();
  log.errors.push(`[${name}] ${s.error} (시도 ${s.attempts}회)`);
  await opts.persist?.(log);
  throw lastErr;
}

export function markStep(log: RunLog, name: StepName, status: StepStatus, detail?: string): void {
  const prev = log.steps[name];
  log.steps[name] = { ...prev, status, attempts: prev?.attempts ?? 0, startedAt: prev?.startedAt ?? nowIso(), endedAt: nowIso(), detail };
}

export function finish(log: RunLog, status: RunStatus): RunLog {
  log.status = status;
  log.endedAt = nowIso();
  log.executionTimeMs = Date.parse(log.endedAt) - Date.parse(log.startedAt);
  return log;
}

export function logPath(root: string, log: RunLog): string {
  return join(root, log.date.slice(0, 4), log.date.slice(5, 7), `${log.runId}.json`);
}

export async function saveRunLog(root: string, log: RunLog): Promise<string> {
  const p = logPath(root, log);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(`${p}.tmp`, JSON.stringify(log, null, 2));
  await rename(`${p}.tmp`, p);
  return p;
}

/** 최근 로그 목록 (최신순) */
export async function listRunLogs(root: string, limit = 30): Promise<RunLog[]> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.json')) files.push(p);
    }
  };
  await walk(root);
  files.sort().reverse();
  const out: RunLog[] = [];
  for (const f of files.slice(0, limit)) {
    try {
      out.push(JSON.parse(await readFile(f, 'utf8')) as RunLog);
    } catch {
      /* 손상된 로그는 건너뜀 */
    }
  }
  return out;
}
