import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BloggerApi } from '../src/publishing/blogger/blogger-api.ts';
import { BloggerAuth, buildAuthUrl, OAuthError } from '../src/publishing/blogger/blogger-auth.ts';
import { buildLabels, BloggerPublisher, publishGate } from '../src/publishing/blogger/blogger-publisher.ts';
import { contentHash, MemoryLedger, parseMarker } from '../src/storage/publish-ledger.ts';
import type { BlogContent } from '../src/types/content.ts';
import { fetchWithRetry, HttpError } from '../src/util/http.ts';
import { FakeBlogger, type FakeOptions } from './helpers/fake-blogger.ts';

const noSleep = async () => {};
const creds = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt' };

function content(over: Partial<BlogContent> = {}): BlogContent {
  const img = (n: number) => ({
    localPath: `data/images/i${n}.jpg`,
    publicUrl: `https://cdn.example.com/i${n}.jpg`,
    licenseVerified: true,
    commercialUse: true,
    origin: 'generated' as const,
    license: '자체 제작',
    downloadedAt: '2026-10-02',
    altText: `설명 이미지 ${n}`,
  });
  const images = [1, 2, 3, 4, 5].map(img);
  return {
    contentId: '20261002-001',
    topic: '기준금리와 대출이자',
    category: '생활경제',
    title: '기준금리가 바뀌면 내 대출이자는 얼마나 달라질까?',
    seoTitle: '기준금리 변동과 대출이자 계산',
    h1: '기준금리가 바뀌면 내 대출이자는 얼마나 달라질까?',
    metaDescription: '기준금리 변화가 대출이자에 미치는 영향',
    primaryKeyword: '기준금리 대출이자',
    secondaryKeywords: [],
    relatedKeywords: [],
    summary: '요약',
    html: '<h2>핵심</h2><p>본문</p>' + images.map((i) => `<img src="${i.publicUrl}" alt="${i.altText}">`).join(''),
    faq: [],
    sources: [{ title: '한국은행 기준금리', url: 'https://www.bok.or.kr/', publisher: '한국은행', tier: 1, accessedAt: '2026-10-02' }],
    images,
    tags: ['금리', '대출'],
    factCheck: { status: 'PASS', claims: [] },
    qualityCheck: { status: 'PASS', items: [] },
    ...over,
  };
}

function setup(opts: FakeOptions = {}) {
  const fake = new FakeBlogger(opts);
  const auth = new BloggerAuth(creds, fake.fetch, Date.now, { sleep: noSleep });
  const api = new BloggerApi(auth, fake.fetch, { sleep: noSleep });
  const ledger = new MemoryLedger();
  const publisher = new BloggerPublisher({ blogId: fake.blogId, api, ledger, fetchFn: fake.fetch, sleep: noSleep, verifyRetry: { sleep: noSleep } });
  return { fake, auth, api, ledger, publisher };
}

describe('HTTP 재시도', () => {
  it('503은 재시도 후 성공한다', async () => {
    let n = 0;
    const f = async () => (++n < 3 ? new Response('x', { status: 503 }) : new Response('ok'));
    const res = await fetchWithRetry(f, 'https://x.test', {}, { sleep: noSleep });
    assert.equal(await res.text(), 'ok');
    assert.equal(n, 3);
  });
  it('400은 재시도하지 않는다', async () => {
    let n = 0;
    const f = async () => (n++, new Response('bad', { status: 400 }));
    await assert.rejects(fetchWithRetry(f, 'https://x.test', {}, { sleep: noSleep }), HttpError);
    assert.equal(n, 1);
  });
  it('최대 3회 후 실패한다', async () => {
    let n = 0;
    const f = async () => (n++, new Response('x', { status: 500 }));
    await assert.rejects(fetchWithRetry(f, 'https://x.test', {}, { sleep: noSleep }));
    assert.equal(n, 3);
  });
});

describe('Google OAuth', () => {
  it('Access Token을 캐시한다', async () => {
    const { fake, auth } = setup();
    await auth.getAccessToken();
    await auth.getAccessToken();
    assert.equal(fake.tokenRequests, 1);
  });
  it('Refresh Token 만료 시 재인증 안내 오류를 낸다', async () => {
    const { auth } = setup({ refreshInvalid: true });
    await assert.rejects(auth.getAccessToken(), (e: unknown) => e instanceof OAuthError && e.code === 'invalid_grant');
  });
  it('인증 URL에 offline·PKCE·blogger scope가 포함된다', () => {
    const u = new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1:1/callback', state: 's', codeChallenge: 'cc' }));
    assert.equal(u.searchParams.get('access_type'), 'offline');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/blogger');
  });
  it('401이면 토큰을 갱신해 한 번 더 시도한다', async () => {
    const { fake, api } = setup({ unauthorized: 1 });
    const blog = await api.getBlog(fake.blogId);
    assert.equal(blog.id, fake.blogId);
    assert.equal(fake.tokenRequests, 2);
  });
});

describe('초안 생성과 중복 방지', () => {
  it('초안을 만들고 숨김 마커를 넣는다', async () => {
    const { fake, publisher } = setup();
    const r = await publisher.createDraft(content());
    assert.ok(r.success);
    const post = fake.posts.get(r.postId!)!;
    assert.equal(post.status, 'DRAFT');
    assert.equal(parseMarker(post.content)?.contentId, '20261002-001');
  });
  it('같은 글을 다시 요청하면 새로 만들지 않는다 (원장이 비어 있어도)', async () => {
    const { fake, publisher } = setup();
    await publisher.createDraft(content());
    const second = new BloggerPublisher({
      blogId: fake.blogId,
      api: new BloggerApi(new BloggerAuth(creds, fake.fetch), fake.fetch, { sleep: noSleep }),
      ledger: new MemoryLedger(), // 원장 유실 상황
      sleep: noSleep,
    });
    const r = await second.createDraft(content());
    assert.ok(r.reusedExisting);
    assert.equal(fake.posts.size, 1);
  });
  it('생성 응답이 실패해도(서버엔 생성됨) 중복 생성하지 않는다', async () => {
    const { fake, publisher } = setup({ insertCreatesThenFails: 1 });
    const r = await publisher.createDraft(content());
    assert.ok(r.success);
    assert.equal(fake.posts.size, 1);
  });
});

describe('발행', () => {
  it('정상 발행 후 원장에 LIVE로 기록한다', async () => {
    const { ledger, publisher } = setup();
    const r = await publisher.publish(content());
    assert.ok(r.success, r.error);
    assert.match(r.url!, /blogspot\.com/);
    assert.equal((await ledger.findByContentId('20261002-001'))?.status, 'LIVE');
  });
  it('이미 발행된 글은 다시 발행하지 않는다', async () => {
    const { fake, publisher } = setup();
    await publisher.publish(content());
    const r = await publisher.publish(content());
    assert.ok(r.duplicatePrevented);
    assert.equal(fake.posts.size, 1);
  });
  it('제목만 같은 다른 글도 중복으로 막는다', async () => {
    const { fake, publisher } = setup();
    await publisher.publish(content());
    const r = await publisher.publish(content({ contentId: '20261003-001', html: content().html + '<p>추가</p>' }));
    assert.ok(r.duplicatePrevented);
    assert.equal(fake.posts.size, 1);
  });
  it('발행 응답이 실패했지만 실제로 발행됐으면 성공으로 처리한다', async () => {
    const { fake, publisher } = setup({ publishSucceedsThenFails: 1 });
    const r = await publisher.publish(content());
    assert.ok(r.success, r.error);
    assert.equal(fake.calls.filter((c) => c.endsWith('/publish')).length, 1);
  });
  it('팩트체크가 PASS가 아니면 발행을 차단한다', async () => {
    const { fake, publisher } = setup();
    const r = await publisher.publish(content({ factCheck: { status: 'REVIEW_REQUIRED', claims: [] } }));
    assert.equal(r.success, false);
    assert.match(r.error!, /팩트체크 REVIEW_REQUIRED/);
    assert.equal(fake.posts.size, 0);
  });
  it('라이선스 미확인 이미지가 있으면 발행을 차단한다', () => {
    const c = content();
    c.images[0]!.licenseVerified = false;
    assert.ok(publishGate(c).some((r) => r.includes('라이선스 미확인')));
  });
  it('API 장애로 중복 확인을 못 하면 발행하지 않는다', async () => {
    const { fake, publisher } = setup({ transient503: 10 });
    const r = await publisher.publish(content());
    assert.equal(r.success, false);
    assert.match(r.error!, /중복 확인 실패/);
    assert.equal(fake.posts.size, 0);
  });
});

describe('수정·삭제', () => {
  it('글을 수정하고 삭제한다', async () => {
    const { fake, ledger, publisher } = setup();
    const p = await publisher.publish(content());
    const u = await publisher.update(p.postId!, content({ html: content().html + '<p>업데이트</p>' }));
    assert.ok(u.success);
    assert.match(fake.posts.get(p.postId!)!.content!, /업데이트/);
    const d = await publisher.delete(p.postId!);
    assert.ok(d.success);
    assert.equal(fake.posts.size, 0);
    assert.equal((await ledger.all())[0]?.status, 'DELETED');
  });
});

describe('발행 검증', () => {
  it('공개 페이지에서 제목·이미지·출처를 확인한다', async () => {
    const { fake, publisher } = setup();
    const c = content();
    const p = await publisher.publish(c);
    const path = new URL(p.url!).pathname;
    fake.publicPages.set(path, { status: 200, html: `<h3>${c.title}</h3>${c.html}<a href="https://www.bok.or.kr/">출처</a>` });
    const v = await publisher.verify(p.url!, { title: c.title, imageUrls: c.images.map((i) => i.publicUrl!), sourceUrls: [c.sources[0]!.url] });
    assert.ok(v.success, v.error);
  });
  it('이미지가 빠져 있으면 검증 실패', async () => {
    const { fake, publisher } = setup();
    fake.publicPages.set('/x.html', { status: 200, html: '<h3>제목</h3>' });
    const v = await publisher.verify('https://example.blogspot.com/x.html', { title: '제목', imageUrls: ['https://cdn.example.com/i1.jpg'] });
    assert.equal(v.success, false);
  });
  it('404면 검증 실패', async () => {
    const { publisher } = setup();
    const v = await publisher.verify('https://example.blogspot.com/none.html', {});
    assert.equal(v.success, false);
    assert.equal(v.httpStatus, 404);
  });
});

describe('보조 기능', () => {
  it('라벨은 200자를 넘지 않는다', () => {
    const labels = buildLabels(content({ tags: Array.from({ length: 50 }, (_, i) => `아주긴태그이름-${i}`) }));
    assert.ok(labels.join(',').length <= 200);
    assert.equal(labels[0], '생활경제');
  });
  it('공백만 다른 본문은 같은 해시', () => {
    assert.equal(contentHash({ title: 'A', html: '<p>x  y</p>' }), contentHash({ title: 'A', html: '<p>x y</p>\n' }));
  });
});
