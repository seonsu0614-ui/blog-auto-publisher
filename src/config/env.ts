import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 환경변수 로딩. 실제 값은 .env(로컬) 또는 GitHub Secrets(Actions)에서만 온다.
 * 코드에 비밀값을 절대 넣지 않는다.
 */
let loaded = false;

export function loadEnv(cwd: string = process.cwd()): void {
  if (loaded) return;
  const envPath = resolve(cwd, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  loaded = true;
}

export class MissingEnvError extends Error {
  constructor(public readonly names: string[]) {
    super(`필수 환경변수가 없습니다: ${names.join(', ')} (.env.example 참고)`);
    this.name = 'MissingEnvError';
  }
}

export function requireEnv<const K extends string>(names: readonly K[]): Record<K, string> {
  loadEnv();
  const missing = names.filter((n) => !process.env[n]?.trim());
  if (missing.length) throw new MissingEnvError(missing);
  return Object.fromEntries(names.map((n) => [n, process.env[n]!.trim()])) as Record<K, string>;
}

export function optionalEnv(name: string): string | undefined {
  loadEnv();
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export interface BloggerConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  blogId: string;
}

export function getBloggerConfig(): BloggerConfig {
  const e = requireEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'BLOGGER_BLOG_ID']);
  return {
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    refreshToken: e.GOOGLE_REFRESH_TOKEN,
    blogId: e.BLOGGER_BLOG_ID,
  };
}
