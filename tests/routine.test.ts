import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { LocalPreviewHost, type MediaHost } from '../src/media/media-host.ts';
import { BloggerApi } from '../src/publishing/blogger/blogger-api.ts';
import { BloggerAuth } from '../src/publishing/blogger/blogger-auth.ts';
import { BloggerPublisher } from '../src/publishing/blogger/blogger-publisher.ts';
import { runDailyRoutine } from '../src/scheduler/daily-routine.ts';
import { listRunLogs } from '../src/storage/execution-log.ts';
import { MemoryLedger } from '../src/storage/publish-ledger.ts';
import { readHistory } from '../src/storage/history.ts';
import { FakeBlogger } from './helpers/fake-blogger.ts';

const SAMPLE = 'data/articles/2026/10/20261002-001/draft.json';
const noSleep = async () => {};

/** 업로드를 흉내 내는 호스트: 파일명으로 가짜 CDN URL을 만든다 */
class FakeCdn implements MediaHost {
  readonly name = 'fake-cdn';
  uploads: string[] = [];
  async upload(_local: string, remote: string) {
    this.uploads.push(remote);
    return `https://cdn.example.com/${remote}`;
  }
}

async function setup(opts: { draftPatch?: (d: any) => void } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'routine-'));
  const draftPath = join(dir, 'draft.json');
  const d = JSON.parse(await readFile(SAMPLE, 'utf8'));
  opts.draftPatch?.(d);
  await writeFile(draftPath, JSON.stringify(d));
  const fake = new FakeBlogger({}, 'BLOG1');
  const creds = { clientId: 'c', clientSecret: 's', refreshToken: 'r' };
  const api = new BloggerApi(new BloggerAuth(creds, fake.fetch), fake.fetch, { sleep: noSleep });
  const publisher = new BloggerPublisher({ blogId: 'BLOG1', api, ledger: new MemoryLedger(), fetchFn: fake.fetch, sleep: noSleep, verifyRetry: { sleep: noSleep } });
  const cdn = new FakeCdn();
  const paths = { logs: join(dir, 'logs'), history: join(dir, 'history.json') };
  // 발행되면 공개 페이지에 본문이 보이도록 가짜 블로그 페이지를 채운다
  const origPublish = publisher.publish.bind(publisher);
  publisher.publish = async (c) => {
    const r = await origPublish(c);
    if (r.url) fake.publicPages.set(new URL(r.url).pathname, { status: 200, html: `<h3>${c.title}</h3>${c.html}` });
    return r;
  };
  return { dir, draftPath, fake, publisher, cdn, paths };
}

describe('daily-blog 실행기', { timeout: 120_000 }, () => {
  it('preview: 미디어 생성 + 검사 통과, 발행하지 않음', async () => {
    const s = await setup();
    const r = await runDailyRoutine(s.draftPath, 'preview', { mediaHost: new LocalPreviewHost(s.dir), paths: s.paths, sleep: noSleep });
    assert.equal(r.log.status, 'SUCCESS', r.log.errors.join('\n'));
    assert.equal(r.log.publishStatus, 'NOT_EXECUTED');
    assert.equal(r.log.imageCount, 6);
    assert.equal(r.log.videoCreated, true);
    assert.equal(s.fake.posts.size, 0);
  });

  it('publish: 업로드 → 발행 → 공개 URL 검증 → 이력 저장', async () => {
    const s = await setup();
    const r = await runDailyRoutine(s.draftPath, 'publish', { mediaHost: s.cdn, publisher: s.publisher, paths: s.paths, sleep: noSleep });
    assert.equal(r.log.status, 'SUCCESS', r.log.errors.join('\n'));
    assert.equal(r.log.publishStatus, 'PUBLISHED');
    assert.match(r.log.bloggerUrl!, /blogspot\.com/);
    assert.equal(s.cdn.uploads.length, 8); // 이미지 6 + 영상 + 포스터
    assert.equal(r.log.steps.verify_publish?.status, 'SUCCESS');
    const post = [...s.fake.posts.values()][0]!;
    assert.match(post.content!, /cdn\.example\.com/);
    const hist = await readHistory(s.paths.history);
    assert.equal(hist.length, 1);
    assert.equal(hist[0]!.contentId, '20261002-001');
    const logs = await listRunLogs(s.paths.logs);
    assert.equal(logs.length, 1);
  });

  it('같은 원고를 두 번 실행해도 한 번만 발행된다', async () => {
    const s = await setup();
    const deps = { mediaHost: s.cdn, publisher: s.publisher, paths: s.paths, sleep: noSleep };
    await runDailyRoutine(s.draftPath, 'publish', deps);
    const r2 = await runDailyRoutine(s.draftPath, 'publish', deps);
    assert.equal(s.fake.posts.size, 1);
    assert.equal(r2.log.publishStatus, 'ALREADY_PUBLISHED');
    assert.equal((await readHistory(s.paths.history)).length, 1);
  });

  it('출처 충돌이 있으면 미디어·발행 없이 REVIEW_REQUIRED', async () => {
    const s = await setup({ draftPatch: (d) => { d.claims[0].conflict = true; d.claims[0].conflictDetail = 'A 3.00% / B 3.25%'; } });
    const r = await runDailyRoutine(s.draftPath, 'publish', { mediaHost: s.cdn, publisher: s.publisher, paths: s.paths, sleep: noSleep });
    assert.equal(r.log.status, 'REVIEW_REQUIRED');
    assert.equal(s.cdn.uploads.length, 0);
    assert.equal(s.fake.posts.size, 0);
  });

  it('미디어 업로드가 계속 실패하면 발행하지 않고 FAILED', async () => {
    const s = await setup();
    const broken: MediaHost = { name: 'broken', upload: async () => { throw new Error('upload 403'); } };
    const r = await runDailyRoutine(s.draftPath, 'publish', { mediaHost: broken, publisher: s.publisher, paths: s.paths, sleep: noSleep });
    assert.equal(r.log.status, 'FAILED');
    assert.equal(r.log.publishStatus, 'NOT_EXECUTED');
    assert.equal(s.fake.posts.size, 0);
    assert.match(r.log.steps.media?.detail ?? '', /upload 403/);
  });

  it('공개 페이지 확인이 안 되면 재발행하지 않고 PUBLISHED_UNVERIFIED', async () => {
    // 공개 페이지를 채우지 않는 Publisher로 구성 → 검증이 계속 실패하는 상황
    const s2 = await setup();
    const plain = new BloggerPublisher({
      blogId: 'BLOG1',
      api: new BloggerApi(new BloggerAuth({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }, s2.fake.fetch), s2.fake.fetch, { sleep: noSleep }),
      ledger: new MemoryLedger(), fetchFn: s2.fake.fetch, sleep: noSleep, verifyRetry: { sleep: noSleep },
    });
    const r = await runDailyRoutine(s2.draftPath, 'publish', { mediaHost: s2.cdn, publisher: plain, paths: s2.paths, sleep: noSleep });
    assert.equal(r.log.publishStatus, 'PUBLISHED_UNVERIFIED');
    assert.equal(r.log.status, 'FAILED');
    assert.equal(r.log.steps.verify_publish?.attempts, 3);
    assert.equal(s2.fake.posts.size, 1);
  });
});
