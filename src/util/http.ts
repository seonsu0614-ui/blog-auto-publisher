/**
 * 재시도 가능한 HTTP 호출.
 * - 429 / 5xx / 네트워크 오류만 재시도한다 (4xx 인증·요청 오류는 즉시 실패).
 * - 최대 시도 횟수 기본 3회, 지수 백오프 + Retry-After 존중.
 * - fetch는 주입 가능 (테스트에서 모의 응답 사용).
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; reason: string; delayMs: number }) => void;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
  get retryable(): boolean {
    return isRetryableStatus(this.status);
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const sec = Number(h);
  if (Number.isFinite(sec)) return sec * 1000;
  const date = Date.parse(h);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export async function fetchWithRetry(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const cap = opts.maxDelayMs ?? 30_000;
  const sleep = opts.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let delay = Math.min(cap, base * 2 ** (attempt - 1));
    try {
      const res = await fetchFn(url, init);
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      const err = new HttpError(res.status, body, url);
      if (!err.retryable || attempt === maxAttempts) throw err;
      delay = Math.min(cap, retryAfterMs(res) ?? delay);
      lastError = err;
      opts.onRetry?.({ attempt, reason: `HTTP ${res.status}`, delayMs: delay });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // 네트워크 오류 (연결 끊김, 타임아웃 등)
      lastError = e;
      if (attempt === maxAttempts) break;
      opts.onRetry?.({ attempt, reason: String((e as Error)?.message ?? e), delayMs: delay });
    }
    await sleep(delay);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
