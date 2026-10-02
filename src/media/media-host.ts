import { readFile } from 'node:fs/promises';
import { basename, relative } from 'node:path';
import { fetchWithRetry, HttpError, type FetchLike } from '../util/http.ts';

/**
 * 미디어 호스팅. Blogger API는 이미지·영상 업로드를 지원하지 않으므로
 * 파일을 다른 곳에 올리고 공개 URL을 본문에 넣는다.
 */
export interface MediaHost {
  readonly name: string;
  /** 업로드 후 공개 URL 반환. 같은 경로가 이미 있으면 덮어쓰지 않고 기존 URL 반환(멱등) */
  upload(localPath: string, remotePath: string): Promise<string>;
}

/** 미리보기용: 파일을 옮기지 않고 미리보기 HTML 기준 상대 경로를 돌려준다 */
export class LocalPreviewHost implements MediaHost {
  readonly name = 'local-preview';
  constructor(private readonly baseDir: string) {}
  async upload(localPath: string): Promise<string> {
    return relative(this.baseDir, localPath).split('\\').join('/');
  }
}

/**
 * GitHub 공개 저장소 + jsDelivr CDN (무료).
 * - GitHub Contents API로 파일 커밋 → https://cdn.jsdelivr.net/gh/{owner}/{repo}@{commit}/{path}
 * - jsDelivr 무료 한도: 파일당 20MB, "저장소(해당 시점 스냅샷)" 50MB.
 *   그래서 미디어는 main이 아니라 월별 전용 브랜치(media-YYYY-MM, 코드 없이 미디어만)에 올린다.
 *   한 달치(글 1편당 약 0.5~1MB × 31편)가 50MB를 넘지 않도록 하고, URL은 커밋 해시로 고정해 이후에도 바뀌지 않는다.
 * 필요한 환경변수: GITHUB_MEDIA_REPO(owner/repo), GITHUB_MEDIA_TOKEN(contents 쓰기 권한),
 *   GITHUB_MEDIA_BRANCH(비우거나 auto = 월별 브랜치, 그 외 값 = 그 브랜치 고정)
 */
export const JSDELIVR_FILE_LIMIT = 20 * 1024 * 1024;
export const JSDELIVR_REPO_LIMIT = 50 * 1024 * 1024;

/** media/2026/10/... → media-2026-10 */
export function monthlyBranch(remotePath: string, now = new Date()): string {
  const m = remotePath.match(/(\d{4})\/(\d{2})\//);
  if (m) return `media-${m[1]}-${m[2]}`;
  return `media-${now.toISOString().slice(0, 7)}`;
}

export class GitHubCdnHost implements MediaHost {
  readonly name = 'github-jsdelivr';
  private ensured = new Set<string>();
  constructor(
    private readonly o: { repo: string; token: string; branch?: string; fetchFn?: FetchLike },
  ) {}

  private get f() {
    return this.o.fetchFn ?? fetch;
  }
  private get headers() {
    return { authorization: `Bearer ${this.o.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  }
  private api(path: string) {
    return `https://api.github.com/repos/${this.o.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  private branchFor(remotePath: string): string {
    const b = this.o.branch?.trim();
    return !b || b === 'auto' ? monthlyBranch(remotePath) : b;
  }

  /** 월별 브랜치가 없으면 코드 없는 빈 브랜치(README 1개)로 만든다 */
  private async ensureBranch(branch: string): Promise<void> {
    if (this.ensured.has(branch)) return;
    const base = `https://api.github.com/repos/${this.o.repo}/git`;
    try {
      await fetchWithRetry(this.f, `${base}/ref/heads/${branch}`, { headers: this.headers });
      this.ensured.add(branch);
      return;
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404) throw e;
    }
    const post = async (url: string, body: unknown) =>
      (await (await fetchWithRetry(this.f, url, { method: 'POST', headers: { ...this.headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as { sha: string };
    const tree = await post(`${base}/trees`, {
      tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: `# ${branch}\n\n블로그 이미지·영상 전용 브랜치 (jsDelivr 50MB 한도 대응, 월별 분리).\n` }],
    });
    const commit = await post(`${base}/commits`, { message: `media branch ${branch}`, tree: tree.sha, parents: [] });
    try {
      await post(`${base}/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
    } catch (e) {
      // 동시에 다른 실행이 만들었으면(422) 그대로 사용
      if (!(e instanceof HttpError) || e.status !== 422) throw e;
    }
    this.ensured.add(branch);
  }

  async upload(localPath: string, remotePath: string): Promise<string> {
    const branch = this.branchFor(remotePath);
    await this.ensureBranch(branch);

    // 이미 있으면 그 파일을 마지막으로 바꾼 커밋으로 고정한 URL 재사용 (같은 파일 = 항상 같은 URL)
    try {
      const res = await fetchWithRetry(this.f, `${this.api(remotePath)}?ref=${branch}`, { headers: this.headers });
      const meta = (await res.json()) as { sha: string };
      if (meta.sha) {
        const c = await fetchWithRetry(this.f, `https://api.github.com/repos/${this.o.repo}/commits?path=${encodeURIComponent(remotePath)}&sha=${branch}&per_page=1`, { headers: this.headers });
        const commits = (await c.json()) as Array<{ sha: string }>;
        return this.cdnUrl(commits[0]?.sha ?? branch, remotePath);
      }
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404) throw e;
    }

    const buf = await readFile(localPath);
    if (buf.length > JSDELIVR_FILE_LIMIT) throw new Error(`파일이 jsDelivr 한도(20MB)를 넘음: ${basename(localPath)} ${(buf.length / 1048576).toFixed(1)}MB`);
    const res = await fetchWithRetry(this.f, this.api(remotePath), {
      method: 'PUT',
      headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ message: `media: ${basename(remotePath)}`, content: buf.toString('base64'), branch }),
    });
    const out = (await res.json()) as { commit: { sha: string } };
    return this.cdnUrl(out.commit.sha, remotePath);
  }

  private cdnUrl(ref: string, path: string) {
    return `https://cdn.jsdelivr.net/gh/${this.o.repo}@${ref}/${path}`;
  }
}
