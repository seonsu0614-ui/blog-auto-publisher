import type { BlogContent } from '../../types/content.ts';
import type { FetchLike, RetryOptions } from '../../util/http.ts';
import {
  buildMarker,
  contentHash,
  parseMarker,
  sourceHash,
  type LedgerEntry,
  type PublishLedger,
} from '../../storage/publish-ledger.ts';
import type {
  BlogPublisher,
  DeleteResult,
  DraftResult,
  PublishResult,
  UpdateResult,
  VerificationResult,
  VerifyExpectations,
} from '../adapters/publisher-interface.ts';
import type { BloggerApi, BloggerPost } from './blogger-api.ts';
import { verifyPublishedPage } from './blogger-verifier.ts';

const PLATFORM = 'blogger';
/** Blogger 라벨 전체 길이 제한(쉼표 포함 약 200자)을 넘지 않도록 자른다 */
const LABELS_MAX_TOTAL = 200;

export class PublishGateError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`발행 차단: ${reasons.join(' / ')}`);
    this.name = 'PublishGateError';
  }
}

/** 자동 발행 전 마지막 안전장치. 파이프라인 QA와 별개로 Publisher가 한 번 더 확인한다. */
export function publishGate(c: BlogContent): string[] {
  const r: string[] = [];
  if (c.factCheck.status !== 'PASS') r.push(`팩트체크 ${c.factCheck.status}`);
  if (c.qualityCheck.status !== 'PASS') r.push(`품질검사 ${c.qualityCheck.status}`);
  if (!c.title.trim()) r.push('제목 없음');
  if (c.sources.length === 0) r.push('출처 없음');
  for (const img of c.images) {
    if (!img.licenseVerified) r.push(`이미지 라이선스 미확인: ${img.localPath}`);
    if (!img.publicUrl) r.push(`이미지 호스팅 URL 없음: ${img.localPath}`);
    else if (!c.html.includes(img.publicUrl)) r.push(`본문에 이미지 미삽입: ${img.publicUrl}`);
    if (!img.altText.trim()) r.push(`Alt 텍스트 없음: ${img.localPath}`);
  }
  if (c.video && !c.video.licenseVerified) r.push('영상 라이선스 미확인');
  return r;
}

export function buildLabels(c: BlogContent): string[] {
  const out: string[] = [];
  let total = 0;
  for (const raw of [c.category, ...c.tags]) {
    const l = raw.replace(/,/g, ' ').trim();
    if (!l || out.includes(l)) continue;
    const add = l.length + (out.length ? 1 : 0);
    if (total + add > LABELS_MAX_TOTAL) break;
    out.push(l);
    total += add;
  }
  return out;
}

export function buildPostBody(c: BlogContent): { html: string; hash: string } {
  const hash = contentHash(c);
  return { html: `${c.html.trim()}\n${buildMarker(c.contentId, hash)}`, hash };
}

const normTitle = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();

export interface BloggerPublisherOptions {
  blogId: string;
  api: BloggerApi;
  ledger: PublishLedger;
  fetchFn?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  verifyRetry?: RetryOptions;
  log?: (msg: string) => void;
}

export class BloggerPublisher implements BlogPublisher {
  readonly platform = PLATFORM;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly o: BloggerPublisherOptions) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = o.maxAttempts ?? 3;
    this.log = o.log ?? (() => {});
  }

  /** 같은 글이 이미 블로그에 있는지 원장 → 원격 순서로 확인 */
  async findExisting(c: BlogContent): Promise<{ postId: string; status: string; url?: string } | undefined> {
    const hash = contentHash(c);
    const local = (await this.o.ledger.findByContentId(c.contentId)) ?? (await this.o.ledger.findByHash(hash));
    if (local?.postId) return { postId: local.postId, status: local.status, url: local.url };

    const { items = [] } = await this.o.api.listRecentPosts(this.o.blogId, { maxResults: 50, fetchBodies: true });
    const match = items.find((p) => {
      const m = parseMarker(p.content);
      return (m && (m.contentId === c.contentId || m.hash === hash)) || normTitle(p.title) === normTitle(c.title);
    });
    return match ? { postId: match.id, status: match.status ?? 'UNKNOWN', url: match.url } : undefined;
  }

  private async record(c: BlogContent, post: BloggerPost, status: LedgerEntry['status']): Promise<void> {
    await this.o.ledger.upsert({
      contentId: c.contentId,
      hash: contentHash(c),
      sourceHash: sourceHash(c),
      platform: PLATFORM,
      title: c.title,
      primaryKeyword: c.primaryKeyword,
      postId: post.id,
      url: post.url,
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  async createDraft(c: BlogContent): Promise<DraftResult> {
    try {
      const existing = await this.findExisting(c);
      if (existing) {
        this.log(`기존 글 재사용: ${existing.postId} (${existing.status})`);
        return { success: true, postId: existing.postId, reusedExisting: true };
      }
      const { html } = buildPostBody(c);
      let lastErr: unknown;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        try {
          const post = await this.o.api.insertPost(this.o.blogId, { title: c.title, content: html, labels: buildLabels(c) }, { isDraft: true });
          await this.record(c, post, 'DRAFT');
          return { success: true, postId: post.id, editUrl: `https://www.blogger.com/blog/post/edit/${this.o.blogId}/${post.id}` };
        } catch (e) {
          lastErr = e;
          this.log(`초안 생성 실패 (${attempt}/${this.maxAttempts}): ${(e as Error).message}`);
          // 서버에선 생성됐는데 응답만 실패했을 수 있으므로, 재시도 전에 반드시 다시 찾아본다
          const created = await this.findExisting(c).catch(() => undefined);
          if (created) return { success: true, postId: created.postId, reusedExisting: true };
          if (attempt < this.maxAttempts) await this.sleep(1000 * 2 ** (attempt - 1));
        }
      }
      return { success: false, error: String((lastErr as Error)?.message ?? lastErr) };
    } catch (e) {
      return { success: false, error: String((e as Error).message ?? e) };
    }
  }

  async publish(c: BlogContent): Promise<PublishResult> {
    const blocked = publishGate(c);
    if (blocked.length) return { success: false, error: new PublishGateError(blocked).message };

    let existing: Awaited<ReturnType<BloggerPublisher['findExisting']>>;
    try {
      existing = await this.findExisting(c);
    } catch (e) {
      // 중복 여부를 확인할 수 없으면 발행하지 않는다 (중복 발행보다 미발행이 안전)
      return { success: false, error: `중복 확인 실패로 발행 중단: ${(e as Error).message}` };
    }
    if (existing?.status === 'LIVE') {
      this.log(`이미 발행된 글 → 중복 발행 차단: ${existing.postId}`);
      return { success: true, postId: existing.postId, url: existing.url, duplicatePrevented: true };
    }

    const draft = existing ? { success: true, postId: existing.postId } : await this.createDraft(c);
    if (!draft.success || !draft.postId) return { success: false, error: `초안 단계 실패: ${draft.error}` };

    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const post = await this.o.api.publishPost(this.o.blogId, draft.postId);
        await this.record(c, post, 'LIVE');
        return { success: true, postId: post.id, url: post.url, publishedAt: post.published };
      } catch (e) {
        lastErr = e;
        this.log(`발행 실패 (${attempt}/${this.maxAttempts}): ${(e as Error).message}`);
        // 실제로는 발행됐는지 확인 후 재시도
        const post = await this.o.api.getPost(this.o.blogId, draft.postId).catch(() => undefined);
        if (post?.status === 'LIVE') {
          await this.record(c, post, 'LIVE');
          return { success: true, postId: post.id, url: post.url, publishedAt: post.published };
        }
        if (attempt < this.maxAttempts) await this.sleep(1000 * 2 ** (attempt - 1));
      }
    }
    return { success: false, postId: draft.postId, error: String((lastErr as Error)?.message ?? lastErr) };
  }

  async update(postId: string, c: BlogContent): Promise<UpdateResult> {
    try {
      const { html } = buildPostBody(c);
      const post = await this.o.api.updatePost(this.o.blogId, postId, { title: c.title, content: html, labels: buildLabels(c) });
      await this.record(c, post, post.status === 'LIVE' ? 'LIVE' : 'DRAFT');
      return { success: true, postId, url: post.url, updatedAt: post.updated };
    } catch (e) {
      return { success: false, postId, error: String((e as Error).message ?? e) };
    }
  }

  async delete(postId: string): Promise<DeleteResult> {
    try {
      await this.o.api.deletePost(this.o.blogId, postId);
      const entry = (await this.o.ledger.all()).find((e) => e.postId === postId);
      if (entry) await this.o.ledger.upsert({ ...entry, status: 'DELETED', updatedAt: new Date().toISOString() });
      return { success: true, postId };
    } catch (e) {
      return { success: false, postId, error: String((e as Error).message ?? e) };
    }
  }

  verify(url: string, expect?: VerifyExpectations): Promise<VerificationResult> {
    return verifyPublishedPage(url, expect, this.o.fetchFn ?? fetch, this.o.verifyRetry);
  }
}
