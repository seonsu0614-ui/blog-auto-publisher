/**
 * Blogger 조회수 확인 (읽기 전용): 최근 7일·30일·전체 조회수와 글 수.
 *   npx tsx scripts/blogger-stats.ts
 * 비밀값은 출력하지 않는다.
 */
import { getBloggerConfig } from '../src/config/env.ts';
import { BloggerApi } from '../src/publishing/blogger/blogger-api.ts';
import { BloggerAuth } from '../src/publishing/blogger/blogger-auth.ts';

async function main() {
  const cfg = getBloggerConfig();
  const api = new BloggerApi(new BloggerAuth(cfg));
  const blog = await api.getBlog(cfg.blogId);
  const pv = await api.getPageViews(cfg.blogId, ['7DAYS', '30DAYS', 'all']);
  const out = {
    checkedAt: new Date().toISOString(),
    blog: blog.url,
    posts: blog.posts?.totalItems ?? 0,
    pageViews: Object.fromEntries((pv.counts ?? []).map((c) => [c.timeRange, Number(c.count)])),
  };
  console.log('BLOGGER_STATS ' + JSON.stringify(out));
}

main().catch((e) => {
  console.error(`❌ 조회수 확인 실패: ${(e as Error).message}`);
  process.exit(1);
});
