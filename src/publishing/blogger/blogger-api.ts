import { fetchWithRetry, HttpError, type FetchLike, type RetryOptions } from '../../util/http.ts';
import type { BloggerAuth } from './blogger-auth.ts';

/**
 * Blogger API v3 얇은 클라이언트 (공식 REST API만 사용, 브라우저 자동화 없음).
 * https://developers.google.com/blogger/docs/3.0/reference
 */

export const BLOGGER_API_BASE = 'https://www.googleapis.com/blogger/v3';

export type BloggerPostStatus = 'LIVE' | 'DRAFT' | 'SCHEDULED' | 'SOFT_TRASHED';

export interface BloggerPost {
  kind?: 'blogger#post';
  id: string;
  blog?: { id: string };
  url?: string;
  selfLink?: string;
  title: string;
  content?: string;
  labels?: string[];
  status?: BloggerPostStatus;
  published?: string;
  updated?: string;
}

export interface BloggerBlog {
  id: string;
  name: string;
  url: string;
  posts?: { totalItems: number };
}

export interface PostInput {
  title: string;
  content: string;
  labels?: string[];
}

export class BloggerApi {
  constructor(
    private readonly auth: BloggerAuth,
    private readonly fetchFn: FetchLike = fetch,
    private readonly retry: RetryOptions = {},
    private readonly base: string = BLOGGER_API_BASE,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | string[] | undefined>,
    retryOverride?: RetryOptions,
  ): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
    }
    const send = async () =>
      fetchWithRetry(
        this.fetchFn,
        url.toString(),
        {
          method,
          headers: {
            authorization: `Bearer ${await this.auth.getAccessToken()}`,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        },
        { ...this.retry, ...retryOverride },
      );

    let res: Response;
    try {
      res = await send();
    } catch (e) {
      // Access Token 만료 직후 401이면 한 번만 토큰을 갱신해 재시도
      if (e instanceof HttpError && e.status === 401) {
        this.auth.invalidate();
        res = await send();
      } else throw e;
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** 인증된 사용자가 소유한 블로그 목록 (BLOGGER_BLOG_ID 확인용) */
  listMyBlogs(): Promise<{ items?: BloggerBlog[] }> {
    return this.request('GET', '/users/self/blogs');
  }

  getBlog(blogId: string): Promise<BloggerBlog> {
    return this.request('GET', `/blogs/${encodeURIComponent(blogId)}`);
  }

  /**
   * 글 생성은 멱등하지 않다(서버에서 생성된 뒤 응답만 실패할 수 있음).
   * 그래서 여기서는 자동 재시도를 하지 않고, 재시도 전 중복 여부 확인은 Publisher가 담당한다.
   */
  insertPost(blogId: string, post: PostInput, opts: { isDraft: boolean }): Promise<BloggerPost> {
    return this.request(
      'POST',
      `/blogs/${encodeURIComponent(blogId)}/posts`,
      { kind: 'blogger#post', ...post },
      { isDraft: String(opts.isDraft) },
      { maxAttempts: 1 },
    );
  }

  publishPost(blogId: string, postId: string): Promise<BloggerPost> {
    return this.request(
      'POST',
      `/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}/publish`,
      undefined,
      undefined,
      { maxAttempts: 1 },
    );
  }

  getPost(blogId: string, postId: string): Promise<BloggerPost> {
    return this.request('GET', `/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`, undefined, {
      view: 'AUTHOR',
    });
  }

  updatePost(blogId: string, postId: string, post: PostInput): Promise<BloggerPost> {
    return this.request('PUT', `/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`, {
      kind: 'blogger#post',
      id: postId,
      blog: { id: blogId },
      ...post,
    });
  }

  deletePost(blogId: string, postId: string): Promise<void> {
    return this.request('DELETE', `/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`);
  }

  /** 최근 글 목록 (중복 발행 검사용). 초안까지 보려면 view=AUTHOR 필요 */
  listRecentPosts(blogId: string, opts: { maxResults?: number; fetchBodies?: boolean } = {}): Promise<{ items?: BloggerPost[] }> {
    return this.request('GET', `/blogs/${encodeURIComponent(blogId)}/posts`, undefined, {
      status: ['live', 'draft', 'scheduled'],
      view: 'AUTHOR',
      orderBy: 'UPDATED',
      maxResults: String(opts.maxResults ?? 30),
      fetchBodies: String(opts.fetchBodies ?? true),
      fetchImages: 'false',
    });
  }
}
