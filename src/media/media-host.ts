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
 * GitHub 공개 저장소 + jsDelivr CDN.
 * - GitHub Contents API로 파일 커밋 → https://cdn.jsdelivr.net/gh/{owner}/{repo}@{commit}/{path}
 * - 커밋 해시로 고정된 URL이라 캐시 문제 없음. jsDelivr는 파일당 20MB 제한(이미지·숏폼 영상은 충분)
 * 필요한 환경변수: GITHUB_MEDIA_REPO(owner/repo), GITHUB_MEDIA_TOKEN(해당 저장소 contents 쓰기 권한), GITHUB_MEDIA_BRANCH(기본 main)
 */
export class GitHubCdnHost implements MediaHost {
  readonly name = 'github-jsdelivr';
  constructor(
    private readonly o: { repo: string; token: string; branch?: string; fetchFn?: FetchLike },
  ) {}

  private api(path: string) {
    return `https://api.github.com/repos/${this.o.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  async upload(localPath: string, remotePath: string): Promise<string> {
    const f = this.o.fetchFn ?? fetch;
    const branch = this.o.branch ?? 'main';
    const headers = { authorization: `Bearer ${this.o.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };

    // 이미 있으면 그 파일을 마지막으로 바꾼 커밋으로 고정한 URL 재사용 (같은 파일 = 항상 같은 URL)
    try {
      const res = await fetchWithRetry(f, `${this.api(remotePath)}?ref=${branch}`, { headers });
      const meta = (await res.json()) as { sha: string };
      if (meta.sha) {
        const c = await fetchWithRetry(f, `https://api.github.com/repos/${this.o.repo}/commits?path=${encodeURIComponent(remotePath)}&sha=${branch}&per_page=1`, { headers });
        const commits = (await c.json()) as Array<{ sha: string }>;
        return this.cdnUrl(commits[0]?.sha ?? branch, remotePath);
      }
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404) throw e;
    }

    const content = (await readFile(localPath)).toString('base64');
    const res = await fetchWithRetry(f, this.api(remotePath), {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ message: `media: ${basename(remotePath)}`, content, branch }),
    });
    const out = (await res.json()) as { commit: { sha: string } };
    return this.cdnUrl(out.commit.sha, remotePath);
  }

  private cdnUrl(ref: string, path: string) {
    return `https://cdn.jsdelivr.net/gh/${this.o.repo}@${ref}/${path}`;
  }
}
