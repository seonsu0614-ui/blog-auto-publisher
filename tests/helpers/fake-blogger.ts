/**
 * 테스트용 가짜 Google/Blogger 서버 (fetch 대체).
 * 실제 네트워크 없이 Blogger API v3의 동작(초안·발행·조회·목록·삭제·토큰)을 흉내 낸다.
 */
import type { BloggerPost } from '../../src/publishing/blogger/blogger-api.ts';
import type { FetchLike } from '../../src/util/http.ts';

export interface FakeOptions {
  /** 다음 N번의 insert 요청은 글을 만든 뒤 500을 돌려준다 (응답 유실 상황) */
  insertCreatesThenFails?: number;
  /** 다음 N번의 publish 요청은 발행한 뒤 503을 돌려준다 */
  publishSucceedsThenFails?: number;
  /** 다음 N번의 아무 API 요청에 503 */
  transient503?: number;
  /** 다음 N번의 API 요청에 401 (토큰 만료 흉내) */
  unauthorized?: number;
  refreshInvalid?: boolean;
}

export class FakeBlogger {
  posts = new Map<string, BloggerPost>();
  calls: string[] = [];
  tokenRequests = 0;
  private seq = 1000;
  publicPages = new Map<string, { status: number; html: string }>();

  constructor(public opts: FakeOptions = {}, public blogId = 'BLOG1') {}

  fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    this.calls.push(`${method} ${url.pathname}`);

    if (url.host === 'oauth2.googleapis.com') {
      this.tokenRequests++;
      if (this.opts.refreshInvalid) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return json(200, { access_token: `at-${this.tokenRequests}`, expires_in: 3600, token_type: 'Bearer' });
    }

    if (url.host === 'example.blogspot.com') {
      const page = this.publicPages.get(url.pathname) ?? { status: 404, html: 'not found' };
      return new Response(page.html, { status: page.status });
    }

    if (this.opts.unauthorized && this.opts.unauthorized > 0) {
      this.opts.unauthorized--;
      return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
    }
    if (this.opts.transient503 && this.opts.transient503 > 0) {
      this.opts.transient503--;
      return json(503, { error: { code: 503, message: 'Backend Error' } });
    }

    const base = `/blogger/v3/blogs/${this.blogId}/posts`;
    const p = url.pathname;

    if (method === 'POST' && p === base) {
      const body = JSON.parse(String(init?.body));
      const id = String(this.seq++);
      const isDraft = url.searchParams.get('isDraft') === 'true';
      const post: BloggerPost = {
        id,
        title: body.title,
        content: body.content,
        labels: body.labels,
        status: isDraft ? 'DRAFT' : 'LIVE',
        url: isDraft ? undefined : `https://example.blogspot.com/2026/10/post-${id}.html`,
      };
      this.posts.set(id, post);
      if (this.opts.insertCreatesThenFails && this.opts.insertCreatesThenFails > 0) {
        this.opts.insertCreatesThenFails--;
        return json(500, { error: { code: 500, message: 'Internal error' } });
      }
      return json(200, post);
    }

    const pub = p.match(new RegExp(`^${base}/(\\w+)/publish$`));
    if (method === 'POST' && pub) {
      const post = this.posts.get(pub[1]!);
      if (!post) return json(404, { error: { code: 404 } });
      post.status = 'LIVE';
      // 실제 Blogger처럼 '처음 발행할 때의 제목'으로 주소를 만든다 (영문이 없으면 숫자형)
      const words = post.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      post.url ??= `https://example.blogspot.com/2026/10/${words || `post-${post.id}`}.html`;
      post.published = '2026-10-02T07:10:00+09:00';
      if (this.opts.publishSucceedsThenFails && this.opts.publishSucceedsThenFails > 0) {
        this.opts.publishSucceedsThenFails--;
        return json(503, { error: { code: 503 } });
      }
      return json(200, post);
    }

    const one = p.match(new RegExp(`^${base}/(\\w+)$`));
    if (one) {
      const post = this.posts.get(one[1]!);
      if (!post) return json(404, { error: { code: 404 } });
      if (method === 'GET') return json(200, post);
      if (method === 'DELETE') {
        this.posts.delete(one[1]!);
        return new Response(null, { status: 204 });
      }
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body));
        Object.assign(post, { title: body.title, content: body.content, labels: body.labels, updated: '2026-10-02T08:00:00+09:00' });
        return json(200, post);
      }
    }

    if (method === 'GET' && p === base) {
      return json(200, { items: [...this.posts.values()].reverse() });
    }
    if (method === 'GET' && p === `/blogger/v3/blogs/${this.blogId}`) {
      return json(200, { id: this.blogId, name: '테스트 블로그', url: 'https://example.blogspot.com/', posts: { totalItems: this.posts.size } });
    }
    if (method === 'GET' && p === '/blogger/v3/users/self/blogs') {
      return json(200, { items: [{ id: this.blogId, name: '테스트 블로그', url: 'https://example.blogspot.com/' }] });
    }
    return json(404, { error: { code: 404, message: `unhandled ${method} ${p}` } });
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
