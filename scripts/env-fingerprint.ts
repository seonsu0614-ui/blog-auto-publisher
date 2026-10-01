/**
 * 비밀값 비교용 지문 출력 (값 자체는 절대 출력하지 않음).
 * 길이 + SHA-256 앞 8자리 + 앞뒤 공백·따옴표·줄바꿈 포함 여부만 보여준다.
 * PC의 .env와 GitHub Secrets가 같은 값인지 비교할 때 사용.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { sanitizeSecret } from '../src/config/env.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'BLOGGER_BLOG_ID']) {
  const raw = process.env[k] ?? '';
  const v = raw.trim();
  const fp = createHash('sha256').update(v).digest('hex').slice(0, 8);
  const flags = [raw !== v ? '앞뒤공백있음' : '', /["']/.test(v) ? '따옴표포함' : '', /\s/.test(v) ? '중간공백있음' : '', v.includes('=') ? '등호포함' : ''].filter(Boolean).join(',');
  const c = sanitizeSecret(k, raw);
  const cfp = createHash('sha256').update(c).digest('hex').slice(0, 8);
  console.log(`${k.padEnd(22)} 길이=${String(v.length).padStart(3)} 지문=${fp} ${flags} → 보정 후 길이=${c.length} 지문=${cfp}`);
}
