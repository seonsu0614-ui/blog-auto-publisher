import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { generateInfographics, GENERATED_LICENSE } from '../src/media/image-engine.ts';
import { seoFileName } from '../src/media/image-processor.ts';
import { renderInfographicSvg } from '../src/media/infographic.ts';
import { GitHubCdnHost, LocalPreviewHost, monthlyBranch } from '../src/media/media-host.ts';
import { clean, wrap } from '../src/media/svg-kit.ts';
import { plannedDuration, sceneSvg } from '../src/media/video-generator.ts';
import { runFactCheck } from '../src/research/fact-checker.ts';
import { mediaTexts, type MediaSpec } from '../src/types/media.ts';
import type { ArticleDraft } from '../src/types/draft.ts';

describe('SVG 도구', () => {
  it('한글 어절 단위로 줄바꿈하고 최대 줄 수를 지킨다', () => {
    const lines = wrap('기준금리가 오르면 내 대출금리는 언제 얼마나 오르는지 확인해야 합니다', 400, 40, 2);
    assert.equal(lines.length, 2);
    assert.ok(lines[1]!.endsWith('…'));
  });
  it('원고 표시({C1}, [S1], **)를 제거한다', () => {
    assert.equal(clean('**3.00%**{C1}[S2]'), '3.00%');
  });
  it('특수문자를 이스케이프해 깨진 SVG를 만들지 않는다', () => {
    const svg = renderInfographicSvg({ kind: 'cover', slot: 1, alt: 'a', title: 'A & B <테스트>' }, '2026-10-02');
    assert.ok(svg.includes('A &amp; B &lt;테스트&gt;'));
  });
});

describe('이미지 생성', () => {
  it('인포그래픽을 JPEG로 만들고 라이선스 매니페스트 필드를 채운다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'img-'));
    const [img] = await generateInfographics(
      [{ kind: 'stats', slot: 2, alt: '기준금리 변화를 보여주는 숫자 카드', title: '기준금리', stats: [{ label: '8월', value: '3.00%' }] }],
      { date: '2026-10-02', slug: 'Base Rate Hike!', outDir: dir },
    );
    assert.ok(img);
    assert.equal(img.slot, 2);
    assert.equal(img.licenseVerified, true);
    assert.equal(img.license, GENERATED_LICENSE);
    assert.match(img.localPath, /base-rate-hike-02-stats\.jpg$/);
    const meta = await sharp(img.localPath).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.ok((img.fileSizeBytes ?? 0) < 300 * 1024);
  });
  it('SEO 파일명은 영문 소문자·하이픈만 사용', () => {
    assert.equal(seoFileName('기준금리 Loan_Rate 2026', 3, 'table'), 'loan-rate-2026-03-table.jpg');
  });
});

describe('영상', () => {
  const spec = {
    alt: '요약 영상',
    scenes: [
      { kind: 'hook' as const, heading: '질문' },
      { kind: 'fact' as const, heading: '숫자', big: '3.00%' },
      { kind: 'explain' as const, heading: '설명' },
      { kind: 'cta' as const, heading: '본문에서' },
    ],
  };
  it('장면 길이 합계가 10~30초 안에 든다', () => {
    const d = plannedDuration(spec);
    assert.ok(d >= 10 && d <= 30, String(d));
  });
  it('세로 1080×1920 장면 SVG를 만든다', () => {
    const svg = sceneSvg(spec.scenes[1]!, 1, 4, '2026-10-02');
    assert.match(svg, /width="1080" height="1920"/);
    assert.ok(svg.includes('3.00%'));
  });
});

describe('호스팅', () => {
  it('로컬 미리보기는 상대 경로를 돌려준다', async () => {
    const h = new LocalPreviewHost('/a/b');
    assert.equal(await h.upload('/a/b/media/x.jpg'), 'media/x.jpg');
  });
  it('GitHub 업로드 후 커밋 고정 jsDelivr URL을 돌려준다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gh-'));
    const file = join(dir, 'x.jpg');
    await writeFile(file, 'img');
    const calls: string[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/git/ref/')) return new Response('{}', { status: 200 });
      if ((init?.method ?? 'GET') === 'GET') return new Response('{"message":"Not Found"}', { status: 404 });
      return new Response(JSON.stringify({ commit: { sha: 'abc123' } }), { status: 201 });
    };
    const host = new GitHubCdnHost({ repo: 'me/blog-media', token: 't', branch: 'main', fetchFn });
    const url = await host.upload(file, 'media/2026/10/x.jpg');
    assert.equal(url, 'https://cdn.jsdelivr.net/gh/me/blog-media@abc123/media/2026/10/x.jpg');
    assert.equal(calls.length, 3); // 브랜치 확인 + 파일 확인 + 업로드
  });
  it('이미 있는 파일은 그 파일의 커밋으로 고정된 같은 URL을 돌려준다', async () => {
    const fetchFn = async (url: string) => {
      if (url.includes('/git/ref/')) return new Response('{}', { status: 200 });
      if (url.includes('/contents/')) return new Response(JSON.stringify({ sha: 'blob1' }), { status: 200 });
      if (url.includes('/commits?')) return new Response(JSON.stringify([{ sha: 'def456' }]), { status: 200 });
      return new Response('{}', { status: 500 });
    };
    const host = new GitHubCdnHost({ repo: 'me/blog-media', token: 't', fetchFn });
    assert.equal(await host.upload('/nope', 'media/x.jpg'), 'https://cdn.jsdelivr.net/gh/me/blog-media@def456/media/x.jpg');
  });
});

describe('jsDelivr 50MB 대응 (월별 미디어 브랜치)', () => {
  it('경로에서 월별 브랜치 이름을 만든다', () => {
    assert.equal(monthlyBranch('media/2026/10/20261002-001/a.jpg'), 'media-2026-10');
  });
  it('월별 브랜치가 없으면 빈 브랜치를 만들고 그 브랜치에 올린다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gh2-'));
    const file = join(dir, 'x.jpg');
    await writeFile(file, 'img');
    const calls: string[] = [];
    let putBody: any;
    const fetchFn = async (url: string, init?: RequestInit) => {
      const m = init?.method ?? 'GET';
      calls.push(`${m} ${url.replace('https://api.github.com/repos/me/r', '')}`);
      if (m === 'GET') return new Response('{"message":"Not Found"}', { status: 404 });
      if (url.endsWith('/git/trees')) return new Response(JSON.stringify({ sha: 'tree1' }), { status: 201 });
      if (url.endsWith('/git/commits')) {
        assert.deepEqual(JSON.parse(String(init!.body)).parents, []); // 코드와 섞이지 않는 독립 브랜치
        return new Response(JSON.stringify({ sha: 'c0' }), { status: 201 });
      }
      if (url.endsWith('/git/refs')) return new Response('{}', { status: 201 });
      putBody = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ commit: { sha: 'c1' } }), { status: 201 });
    };
    const host = new GitHubCdnHost({ repo: 'me/r', token: 't', branch: 'auto', fetchFn });
    const url = await host.upload(file, 'media/2026/11/p/x.jpg');
    assert.equal(url, 'https://cdn.jsdelivr.net/gh/me/r@c1/media/2026/11/p/x.jpg');
    assert.equal(putBody.branch, 'media-2026-11');
    assert.ok(calls.some((c) => c === 'POST /git/refs'));
  });
});

describe('미디어 팩트체크', () => {
  const base = (media: MediaSpec): ArticleDraft => ({
    contentId: 'x', date: '2026-10-02', topic: 't', category: '생활경제', searchIntent: 's',
    title: '제목입니다 제목입니다', seoTitle: 's', metaDescription: 'm', primaryKeyword: 'k', secondaryKeywords: [], relatedKeywords: [],
    hook: [], summary: [], sections: [], faq: [], closing: [],
    sources: [{ id: 'S1', title: 't', url: 'https://bok.or.kr', publisher: '한국은행', tier: 1, accessedAt: '2026-10-02' }],
    claims: [{ id: 'C1', claim: '기준금리 3.00%', value: '3.00%', referenceDate: '2026-08-27', sourceIds: ['S1'], verified: true, conflict: false }],
    tags: [], media,
  });
  it('이미지 안의 검증된 숫자는 통과', () => {
    const d = base({ images: [{ kind: 'stats', slot: 1, alt: 'a', title: 't', stats: [{ label: '기준금리', value: '3.00%' }] }] });
    assert.equal(runFactCheck(d).status, 'PASS');
  });
  it('이미지·영상 안의 근거 없는 숫자는 FAIL', () => {
    const d = base({ images: [], video: { alt: 'a', scenes: [{ kind: 'fact', heading: '인상 폭', big: '0.75%p' }] } });
    const r = runFactCheck(d);
    assert.equal(r.status, 'FAIL');
    assert.ok(r.issues.some((i) => i.message.includes('0.75%p')));
  });
  it('mediaTexts는 모든 장면·셀 문장을 모은다', () => {
    const t = mediaTexts({ images: [{ kind: 'table', slot: 1, alt: 'alt', title: 'T', headers: ['h'], rows: [['r1']] }], video: { alt: 'v', scenes: [{ kind: 'cta', heading: 'H', body: 'B' }] } });
    for (const s of ['alt', 'T', 'h', 'r1', 'H', 'B', 'v']) assert.ok(t.includes(s), s);
  });
});
