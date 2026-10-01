import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BlogContent } from '../types/content.ts';

/**
 * 중복 발행 방지 (idempotency).
 * 1) 본문에 숨김 마커(<!-- bap:... -->)를 넣어 블로그 쪽에서도 같은 글을 찾을 수 있게 하고
 * 2) 로컬/영구 저장소의 발행 원장(ledger)에 contentId·hash·postId를 기록한다.
 * 원장이 유실돼도 Blogger의 최근 글에서 마커를 찾아 중복을 막는다.
 */

export const MARKER_PREFIX = 'bap:';

function normalize(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function contentHash(c: Pick<BlogContent, 'title' | 'html'>): string {
  return createHash('sha256').update(normalize(c.title)).update('\n').update(normalize(c.html)).digest('hex').slice(0, 16);
}

export function sourceHash(c: Pick<BlogContent, 'sources'>): string {
  const urls = c.sources.map((s) => s.url.trim().toLowerCase()).sort();
  return createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 16);
}

export function buildMarker(contentId: string, hash: string): string {
  return `<!-- ${MARKER_PREFIX}id=${contentId} hash=${hash} -->`;
}

export function parseMarker(html: string | undefined): { contentId: string; hash: string } | undefined {
  if (!html) return undefined;
  const m = html.match(/<!--\s*bap:id=([\w-]+)\s+hash=([0-9a-f]+)\s*-->/);
  return m ? { contentId: m[1]!, hash: m[2]! } : undefined;
}

export interface LedgerEntry {
  contentId: string;
  hash: string;
  sourceHash: string;
  platform: string;
  title: string;
  primaryKeyword: string;
  postId?: string;
  url?: string;
  status: 'DRAFT' | 'LIVE' | 'DELETED';
  updatedAt: string;
}

export interface PublishLedger {
  findByContentId(contentId: string): Promise<LedgerEntry | undefined>;
  findByHash(hash: string): Promise<LedgerEntry | undefined>;
  upsert(entry: LedgerEntry): Promise<void>;
  all(): Promise<LedgerEntry[]>;
}

export class MemoryLedger implements PublishLedger {
  private entries: LedgerEntry[] = [];
  async findByContentId(id: string) {
    return this.entries.find((e) => e.contentId === id && e.status !== 'DELETED');
  }
  async findByHash(h: string) {
    return this.entries.find((e) => e.hash === h && e.status !== 'DELETED');
  }
  async upsert(entry: LedgerEntry) {
    const i = this.entries.findIndex((e) => e.contentId === entry.contentId && e.platform === entry.platform);
    if (i >= 0) this.entries[i] = entry;
    else this.entries.push(entry);
  }
  async all() {
    return [...this.entries];
  }
}

/** JSON 파일 원장. 워크스페이스가 비영구적이므로 실행 후 GitHub/Drive로 반드시 동기화한다. */
export class JsonFileLedger extends MemoryLedger {
  private loadedOnce = false;
  constructor(private readonly path: string) {
    super();
  }
  private async load() {
    if (this.loadedOnce) return;
    this.loadedOnce = true;
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8')) as LedgerEntry[];
      for (const e of data) await super.upsert(e);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  override async findByContentId(id: string) {
    await this.load();
    return super.findByContentId(id);
  }
  override async findByHash(h: string) {
    await this.load();
    return super.findByHash(h);
  }
  override async all() {
    await this.load();
    return super.all();
  }
  override async upsert(entry: LedgerEntry) {
    await this.load();
    await super.upsert(entry);
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(await super.all(), null, 2));
    await rename(tmp, this.path); // 원자적 교체
  }
}
