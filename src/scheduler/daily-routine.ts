import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { runTextPipeline, type PipelineResult } from '../content/pipeline.ts';
import type { MediaSlots } from '../content/html-builder.ts';
import type { MediaHost } from '../media/media-host.ts';
import { buildMedia } from '../media/media-pipeline.ts';
import type { BlogPublisher } from '../publishing/adapters/publisher-interface.ts';
import { finish, markStep, newRunLog, saveRunLog, step, type RunLog } from '../storage/execution-log.ts';
import { readHistory, upsertHistory } from '../storage/history.ts';
import type { ArticleDraft } from '../types/draft.ts';
import { DEFAULT_LIMITS, quotaCheck, type Limits } from '../config/limits.ts';

/**
 * daily-blog 실행기: 원고(draft.json) → 팩트체크·중복 → 미디어 → 품질검사 → 발행 → 공개 URL 검증 → 로그·이력.
 * (주제 선정·리서치·원고 작성은 Claude가 skills/daily-blog 절차로 수행해 draft.json을 만든다.)
 *
 * 안전 원칙
 * - 팩트체크 REVIEW_REQUIRED / 품질검사 FAIL → 발행하지 않는다.
 * - 영상 필수 정책(requireVideo)에서 영상이 없으면 발행하지 않는다.
 * - 발행 호출은 Publisher가 중복 방지(마커·원장·제목)를 보장한다. 재실행해도 두 번 올라가지 않는다.
 */

export interface RoutineDeps {
  mediaHost: MediaHost;
  publisher?: BlogPublisher; // publish 모드에서 필수
  paths: { logs: string; history: string };
  requireVideo?: boolean;
  /** 무료 범위 유지용 상한 (config/limits.json) */
  limits?: Limits;
  /** 공개 URL 검증 재시도 (Blogger 반영 지연 대비) */
  verifyAttempts?: number;
  verifyDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
}

export interface RoutineResult {
  log: RunLog;
  logFile: string;
  pipeline?: PipelineResult;
  media?: MediaSlots;
}

export async function runDailyRoutine(draftPath: string, mode: 'preview' | 'publish', deps: RoutineDeps): Promise<RoutineResult> {
  const say = deps.log ?? (() => {});
  const runLog = newRunLog({ mode, draftPath });
  const persist = async (l: RunLog) => {
    await saveRunLog(deps.paths.logs, l);
  };
  const S = { persist, sleep: deps.sleep };
  let pipeline: PipelineResult | undefined;
  let media: MediaSlots | undefined;

  try {
    runLog.status = 'RUNNING';
    const draft = await step(runLog, 'load_draft', async () => JSON.parse(await readFile(resolve(draftPath), 'utf8')) as ArticleDraft, S);
    Object.assign(runLog, {
      contentId: draft.contentId,
      date: draft.date,
      topic: draft.topic,
      category: draft.category,
      keywords: [draft.primaryKeyword, ...draft.secondaryKeywords],
      title: draft.title,
      sources: draft.sources.map((s) => s.url),
    });
    const history = await readHistory(deps.paths.history);

    // 1) 텍스트 단계 사전 검사: 사실 확인이 안 된 원고에 미디어를 만들지 않는다
    runLog.status = 'QA';
    const pre = runTextPipeline(draft, { history: history.filter((h) => h.contentId !== draft.contentId), stage: 'text' });
    runLog.factCheck = pre.fact.status;
    markStep(runLog, 'fact_check', pre.fact.status === 'PASS' ? 'SUCCESS' : pre.fact.status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'FAILED', pre.fact.issues.map((i) => i.message).join(' / ') || undefined);
    if (pre.decision === 'REVIEW_REQUIRED' || pre.decision === 'BLOCKED') {
      pipeline = pre;
      runLog.qualityCheck = pre.quality.status;
      runLog.errors.push(...pre.reasons);
      runLog.publishStatus = 'NOT_EXECUTED';
      finish(runLog, pre.decision === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'FAILED');
      return { log: runLog, logFile: await saveRunLog(deps.paths.logs, runLog), pipeline };
    }

    // 1-1) 발행 수 상한: 넘으면 미디어도 만들지 않고 건너뜀 (Actions 시간·저장 용량 절약)
    const limits = deps.limits ?? DEFAULT_LIMITS;
    if (mode === 'publish') {
      const q = quotaCheck(history, { date: draft.date, contentId: draft.contentId, limits });
      if (!q.ok) {
        markStep(runLog, 'publish', 'SKIPPED', q.reason);
        runLog.publishStatus = 'SKIPPED_QUOTA';
        runLog.errors.push(q.reason!);
        finish(runLog, 'SKIPPED');
        return { log: runLog, logFile: await saveRunLog(deps.paths.logs, runLog), pipeline: pre };
      }
    }

    // 2) 미디어
    runLog.status = 'MEDIA_CREATING';
    const outDir = dirname(resolve(draftPath));
    const built = await step(runLog, 'media', () => buildMedia(draft, { outDir, host: deps.mediaHost, videoCrf: limits.videoCrf }), S);
    media = built.slots;
    runLog.imageCount = media.images.filter((i) => i.publicUrl).length;
    runLog.videoCreated = !!media.video?.publicUrl;
    if (built.manifest.errors.length) {
      runLog.steps.media!.detail = built.manifest.errors.join(' / ');
    }
    const mediaMB = [...media.images.map((i) => i.fileSizeBytes ?? 0), media.video?.fileSizeBytes ?? 0, 0].reduce((a, b) => a + b, 0) / 1048576;
    if (mediaMB > limits.maxMediaMBPerPost) {
      const msg = `미디어 용량 ${mediaMB.toFixed(2)}MB가 상한 ${limits.maxMediaMBPerPost}MB 초과 (jsDelivr 월 50MB 한도 보호)`;
      runLog.errors.push(msg);
      runLog.publishStatus = 'NOT_EXECUTED';
      markStep(runLog, 'quality_check', 'FAILED', msg);
      finish(runLog, 'FAILED');
      return { log: runLog, logFile: await saveRunLog(deps.paths.logs, runLog), pipeline: pre, media };
    }

    // 3) 최종 품질검사 (미디어 포함)
    runLog.status = 'QA';
    pipeline = runTextPipeline(draft, {
      history: history.filter((h) => h.contentId !== draft.contentId),
      stage: 'full',
      media,
      requireVideo: deps.requireVideo ?? true,
    });
    runLog.wordCount = pipeline.quality.stats.charsNoSpace;
    runLog.qualityCheck = pipeline.quality.status;
    markStep(runLog, 'quality_check', pipeline.decision === 'PUBLISHABLE' ? 'SUCCESS' : 'FAILED', pipeline.reasons.join(' / ') || undefined);
    if (pipeline.decision !== 'PUBLISHABLE') {
      runLog.errors.push(...pipeline.reasons);
      runLog.publishStatus = 'NOT_EXECUTED';
      finish(runLog, pipeline.decision === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'FAILED');
      return { log: runLog, logFile: await saveRunLog(deps.paths.logs, runLog), pipeline, media };
    }

    if (mode === 'preview') {
      markStep(runLog, 'publish', 'SKIPPED', 'preview 모드');
      runLog.publishStatus = 'NOT_EXECUTED';
      finish(runLog, 'SUCCESS');
      return { log: runLog, logFile: await saveRunLog(deps.paths.logs, runLog), pipeline, media };
    }

    // 4) 발행 (Publisher 내부에서 중복 확인·재시도 수행 → 여기서는 1회 호출)
    if (!deps.publisher) throw new Error('publish 모드에는 publisher가 필요합니다');
    runLog.status = 'PUBLISHING';
    const pub = await step(runLog, 'publish', async () => {
      const r = await deps.publisher!.publish(pipeline!.content);
      if (!r.success) throw new Error(r.error ?? '발행 실패');
      return r;
    }, S);
    Object.assign(runLog, { bloggerPostId: pub.postId, bloggerUrl: pub.url, duplicatePrevented: !!pub.duplicatePrevented, publishStatus: pub.duplicatePrevented ? 'ALREADY_PUBLISHED' : 'PUBLISHED' });
    say(`발행 ${pub.duplicatePrevented ? '(이미 발행됨, 중복 방지)' : '완료'}: ${pub.url}`);

    // 5) 공개 URL 검증 (반영 지연을 고려해 재시도)
    const content = pipeline.content;
    const verification = await step(
      runLog,
      'verify_publish',
      async () => {
        if (!pub.url) throw new Error('발행 URL 없음');
        // 이미 발행돼 있던 글이면 이번 실행에서 새로 만든 미디어 주소와 비교하지 않는다 (발행된 글은 그대로이므로)
        const v = await deps.publisher!.verify(
          pub.url,
          pub.duplicatePrevented
            ? { title: content.title, postId: pub.postId }
            : {
                postId: pub.postId,
                title: content.title,
                imageUrls: content.images.map((i) => i.publicUrl!).filter(Boolean),
                videoUrl: content.video?.publicUrl,
                // 검증기가 페이지 HTML의 &amp; 등을 디코딩한 뒤 비교하므로 원래 URL 그대로 넘긴다
                sourceUrls: content.sources.slice(0, 3).map((s) => s.url),
              },
        );
        if (!v.success) {
          const failed = v.checks.filter((c) => !c.passed).map((c) => `${c.id}${c.detail ? `(${c.detail.slice(0, 90)})` : ''}`);
          throw new Error(`검증 실패: ${failed.join(', ') || v.error}`);
        }
        return v;
      },
      { ...S, retries: deps.verifyAttempts ?? 3, delayMs: deps.verifyDelayMs ?? 10_000 },
    ).catch((e) => {
      // 검증 실패는 '발행은 됐지만 확인 필요' 상태로 남긴다 (재발행하지 않음)
      runLog.publishStatus = 'PUBLISHED_UNVERIFIED';
      return { success: false, error: (e as Error).message };
    });

    // 6) 이력
    await step(runLog, 'save_history', () =>
      upsertHistory(deps.paths.history, {
        contentId: draft.contentId,
        date: draft.date,
        title: draft.title,
        topic: draft.topic,
        primaryKeyword: draft.primaryKeyword,
        secondaryKeywords: draft.secondaryKeywords,
        category: draft.category,
        searchIntent: draft.searchIntent,
        tags: draft.tags,
        url: pub.url,
        postId: pub.postId,
        publishedAt: pub.publishedAt,
        wordCount: runLog.wordCount,
        imageCount: runLog.imageCount,
        videoCreated: runLog.videoCreated,
      }), S);

    finish(runLog, verification.success ? 'SUCCESS' : 'FAILED');
    return { log: runLog, logFile: await saveRunLog(deps.paths.logs, runLog), pipeline, media };
  } catch (e) {
    if (!runLog.errors.length || !runLog.errors.some((x) => x.includes((e as Error).message))) runLog.errors.push((e as Error).message ?? String(e));
    runLog.publishStatus ??= 'NOT_EXECUTED';
    finish(runLog, 'FAILED');
    return { log: runLog, logFile: await saveRunLog(deps.paths.logs, runLog), pipeline, media };
  }
}

export const DEFAULT_PATHS = { logs: join('data', 'logs'), history: join('data', 'history.json') };
