/**
 * Blogger 연결 점검: 토큰 갱신 → 블로그 정보 조회.
 *   npm run blogger:check
 */
import { getBloggerConfig } from '../src/config/env.ts';
import { BloggerApi } from '../src/publishing/blogger/blogger-api.ts';
import { BloggerAuth } from '../src/publishing/blogger/blogger-auth.ts';

async function main() {
  const cfg = getBloggerConfig();
  const api = new BloggerApi(new BloggerAuth(cfg));
  const blog = await api.getBlog(cfg.blogId);
  console.log(`✅ Blogger 연결 정상\n블로그: ${blog.name}\nURL: ${blog.url}\n글 수: ${blog.posts?.totalItems ?? 0}`);
}

main().catch((e) => {
  console.error(`❌ Blogger 연결 실패: ${(e as Error).message}`);
  process.exit(1);
});
