import type { BlogContent } from '../types/content.ts';
import type { ArticleDraft } from '../types/draft.ts';
import { runFactCheck, type FactCheckReport } from '../research/fact-checker.ts';
import { checkDuplicate, type DuplicateResult, type HistoryEntry } from './duplicate-checker.ts';
import { buildHtml, type MediaSlots } from './html-builder.ts';
import { runQualityCheck, type QualityReport } from './quality-checker.ts';

/**
 * 텍스트 파이프라인: 원고(ArticleDraft) → 팩트체크 → 중복검사 → HTML → 품질검사 → BlogContent.
 * 순서 고정: 사실 확인이 끝난 원고만 HTML·품질검사로 넘어간다.
 */

export interface PipelineResult {
  content: BlogContent;
  fact: FactCheckReport;
  duplicate: DuplicateResult;
  quality: QualityReport;
  /** 자동 발행 가능 여부와 상태 */
  decision: 'PUBLISHABLE' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'TEXT_READY';
  reasons: string[];
}

export function runTextPipeline(
  draft: ArticleDraft,
  opts: { history?: HistoryEntry[]; media?: MediaSlots; stage?: 'text' | 'full'; requireVideo?: boolean } = {},
): PipelineResult {
  const fact = runFactCheck(draft);
  const duplicate = checkDuplicate(draft, opts.history ?? []);
  const media = opts.media ?? { images: [] };
  const html = buildHtml(draft, media);
  const quality = runQualityCheck({
    draft,
    html,
    media,
    factStatus: fact.status,
    duplicate,
    stage: opts.stage ?? 'full',
    requireVideo: opts.requireVideo ?? true,
  });

  const content: BlogContent = {
    contentId: draft.contentId,
    topic: draft.topic,
    category: draft.category,
    title: draft.title,
    seoTitle: draft.seoTitle,
    h1: draft.title,
    slug: draft.slug,
    metaDescription: draft.metaDescription,
    primaryKeyword: draft.primaryKeyword,
    secondaryKeywords: draft.secondaryKeywords,
    relatedKeywords: draft.relatedKeywords,
    summary: draft.summary.join(' '),
    html,
    faq: draft.faq,
    sources: draft.sources,
    images: media.images,
    video: media.video,
    tags: draft.tags,
    factCheck: {
      status: fact.status,
      checkedAt: new Date().toISOString(),
      claims: draft.claims.map((c) => ({
        claim: c.claim,
        value: c.value,
        referenceDate: c.referenceDate,
        condition: c.condition,
        sourceUrls: c.sourceIds.map((id) => draft.sources.find((s) => s.id === id)?.url ?? id),
        verified: c.verified,
        conflict: c.conflict,
        notes: c.notes,
      })),
    },
    qualityCheck: { status: quality.status, checkedAt: quality.checkedAt, items: quality.items },
  };

  const reasons: string[] = [];
  let decision: PipelineResult['decision'];
  if (fact.status === 'REVIEW_REQUIRED') {
    decision = 'REVIEW_REQUIRED';
    reasons.push(...fact.issues.map((i) => i.message));
  } else if (fact.status !== 'PASS' || quality.status === 'FAIL') {
    decision = 'BLOCKED';
    reasons.push(...fact.issues.map((i) => i.message));
    reasons.push(...quality.items.filter((i) => i.critical && !i.passed && !i.detail?.startsWith('PENDING')).map((i) => `${i.label}: ${i.detail ?? '실패'}`));
  } else if (quality.status === 'NOT_RUN') {
    decision = 'TEXT_READY';
    reasons.push('텍스트 검사 통과. 이미지·영상(Phase 3) 연결 후 발행 가능');
  } else {
    decision = 'PUBLISHABLE';
  }
  return { content, fact, duplicate, quality, decision, reasons };
}
