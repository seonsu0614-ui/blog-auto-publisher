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

/**
 * 복사·붙여넣기 실수 보정: "NAME=값", 따옴표, 앞뒤 공백·줄바꿈을 걷어낸다.
 * Refresh Token은 Google 형식(1//로 시작, 영문·숫자·_-)만 골라낸다.
 */
export function sanitizeSecret(name: string, raw: string): string {
  let v = raw.trim();
  const prefix = new RegExp(`^${name}\\s*=\\s*`);
  v = v.replace(prefix, '').trim().replace(/^["']|["']$/g, '').trim();
  if (name === 'GOOGLE_REFRESH_TOKEN') {
    const m = v.match(/1\/\/[A-Za-z0-9_-]{20,}/);
    if (m) return m[0];
  }
  return v;
}

export function getBloggerConfig(): BloggerConfig {
  const e = requireEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'BLOGGER_BLOG_ID']);
  return {
    clientId: sanitizeSecret('GOOGLE_CLIENT_ID', e.GOOGLE_CLIENT_ID),
    clientSecret: sanitizeSecret('GOOGLE_CLIENT_SECRET', e.GOOGLE_CLIENT_SECRET),
    refreshToken: sanitizeSecret('GOOGLE_REFRESH_TOKEN', e.GOOGLE_REFRESH_TOKEN),
    blogId: sanitizeSecret('BLOGGER_BLOG_ID', e.BLOGGER_BLOG_ID),
  };
}
