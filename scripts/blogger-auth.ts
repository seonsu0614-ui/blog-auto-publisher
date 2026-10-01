/**
 * 최초 1회 Google OAuth 인증 → Refresh Token 발급.
 *
 * 사용법 (반드시 본인 PC에서 실행. 브라우저 로그인이 필요합니다):
 *   1) .env 에 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET 입력
 *   2) npm run blogger:auth
 *   3) 출력된 URL을 브라우저에서 열고 Blogger 블로그 소유 계정으로 로그인·승인
 *   4) 터미널에 출력된 GOOGLE_REFRESH_TOKEN / BLOGGER_BLOG_ID 를 .env (또는 GitHub Secrets)에 저장
 *      --save 옵션을 주면 로컬 .env 에 자동 기록합니다.
 *
 * 이 스크립트는 비밀번호를 받거나 저장하지 않습니다. 로그인은 사용자가 Google 화면에서 직접 합니다.
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { requireEnv } from '../src/config/env.ts';
import { BloggerApi } from '../src/publishing/blogger/blogger-api.ts';
import { BloggerAuth, buildAuthUrl, exchangeCode } from '../src/publishing/blogger/blogger-auth.ts';

const b64url = (b: Buffer) => b.toString('base64url');

/** 인증 주소를 기본 브라우저로 자동으로 연다 (실패해도 주소는 화면에 출력되어 있으므로 무시) */
function openBrowser(url: string) {
  if (process.argv.includes('--no-open')) return;
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    console.log('(브라우저를 자동으로 열었습니다. 열리지 않으면 위 주소를 복사해 여세요)');
  } catch {
    /* 무시 */
  }
}

function upsertEnvFile(updates: Record<string, string>) {
  const path = '.env';
  let text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
  }
  writeFileSync(path, text, { mode: 0o600 });
}

async function main() {
  const save = process.argv.includes('--save');
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = requireEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);

  const codeVerifier = b64url(randomBytes(48));
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
  const state = b64url(randomBytes(16));

  const code = await new Promise<{ code: string; redirectUri: string }>((resolveCode, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get('error');
      if (err || u.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('인증 실패 또는 state 불일치. 터미널을 확인하세요.');
        server.close();
        reject(new Error(err ?? 'state mismatch'));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('인증 완료. 이 창을 닫고 터미널로 돌아가세요.');
      const port = (server.address() as AddressInfo).port;
      server.close();
      resolveCode({ code: u.searchParams.get('code')!, redirectUri: `http://127.0.0.1:${port}/callback` });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      const url = buildAuthUrl({ clientId, redirectUri: `http://127.0.0.1:${port}/callback`, state, codeChallenge });
      console.log('\n아래 주소를 브라우저에서 열고, Blogger 블로그를 소유한 Google 계정으로 승인하세요:\n');
      console.log(url + '\n');
      openBrowser(url);
      console.log('(5분 안에 승인하지 않으면 종료됩니다)');
    });
    setTimeout(() => {
      server.close();
      reject(new Error('시간 초과'));
    }, 5 * 60_000).unref();
  });

  const tokens = await exchangeCode({ clientId, clientSecret, code: code.code, redirectUri: code.redirectUri, codeVerifier });
  if (!tokens.refresh_token) {
    throw new Error(
      'refresh_token이 오지 않았습니다. https://myaccount.google.com/permissions 에서 이 앱 권한을 제거한 뒤 다시 실행하세요.',
    );
  }

  const api = new BloggerApi(new BloggerAuth({ clientId, clientSecret, refreshToken: tokens.refresh_token }));
  const { items = [] } = await api.listMyBlogs();

  console.log('\n✅ 인증 성공\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  if (items.length === 0) console.log('⚠️ 이 계정에 Blogger 블로그가 없습니다. blogger.com 에서 블로그를 먼저 만드세요.');
  for (const b of items) console.log(`블로그: ${b.name}  ${b.url}\nBLOGGER_BLOG_ID=${b.id}\n`);

  if (save) {
    const updates: Record<string, string> = { GOOGLE_REFRESH_TOKEN: tokens.refresh_token };
    if (items.length === 1) updates.BLOGGER_BLOG_ID = items[0]!.id;
    upsertEnvFile(updates);
    console.log('.env 에 저장했습니다. (.env 는 git에 올라가지 않습니다)');
  } else {
    console.log('위 값을 .env 또는 GitHub Secrets에 저장하세요. (자동 저장: npm run blogger:auth -- --save)');
  }
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}`);
  process.exit(1);
});
