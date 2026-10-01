/**
 * Phase 1 실제 테스트: 공개 발행 없이 "초안"만 만든다.
 *   npm run blogger:draft-test             → 테스트 초안 생성 (blogger.com 에서 확인)
 *   npm run blogger:draft-test -- --cleanup → 생성 직후 초안 삭제까지 확인
 * 같은 명령을 두 번 실행해도 초안이 2개 생기지 않아야 한다 (중복 방지 테스트).
 */
import { MemoryLedger } from '../src/storage/publish-ledger.ts';
import { createPublisher } from '../src/publishing/publisher.ts';
import type { BlogContent } from '../src/types/content.ts';

const today = new Date().toISOString().slice(0, 10);

const sample: BlogContent = {
  contentId: `test-${today}`,
  topic: '연결 테스트',
  category: '생활경제',
  title: `[연결 테스트] Blogger 자동화 초안 ${today}`,
  seoTitle: 'Blogger 자동화 연결 테스트',
  h1: 'Blogger 자동화 연결 테스트',
  metaDescription: 'Blogger API 초안 생성 테스트 글입니다.',
  primaryKeyword: '연결 테스트',
  secondaryKeywords: [],
  relatedKeywords: [],
  summary: '자동화 시스템의 초안 생성 테스트입니다. 공개 발행되지 않습니다.',
  html: '<h2>연결 테스트</h2>\n<p>이 글은 자동화 시스템의 초안 생성 테스트입니다. 공개 발행되지 않으며 삭제해도 됩니다.</p>',
  faq: [],
  sources: [],
  images: [],
  tags: ['테스트'],
  factCheck: { status: 'NOT_RUN', claims: [] },
  qualityCheck: { status: 'NOT_RUN', items: [] },
};

async function main() {
  // 테스트는 운영 원장을 건드리지 않는다. 중복 방지는 원격 마커 검사로 확인된다.
  const publisher = createPublisher('blogger', { ledger: new MemoryLedger() });
  const draft = await publisher.createDraft(sample);
  if (!draft.success) throw new Error(draft.error);
  console.log(`✅ 초안 ${draft.reusedExisting ? '재사용(중복 방지 동작)' : '생성'}: postId=${draft.postId}`);
  if (draft.editUrl) console.log(`편집 화면: ${draft.editUrl}`);

  if (process.argv.includes('--cleanup')) {
    const del = await publisher.delete(draft.postId!);
    console.log(del.success ? '🗑  테스트 초안 삭제 완료' : `삭제 실패: ${del.error}`);
  }
}

main().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
});
