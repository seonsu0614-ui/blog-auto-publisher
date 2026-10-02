/**
 * daily-blog 실행 CLI
 *
 *   npm run daily-blog -- <draft.json>              # = --preview (발행 안 함)
 *   npm run daily-blog -- <draft.json> --preview    # 미디어 생성 + 전체 검사, 발행 안 함
 *   npm run daily-blog -- <draft.json> --publish    # 검사 통과 시 Blogger 자동 발행 + 공개 URL 검증
 *   npm run daily-blog -- --retry                   # 가장 최근 실패/미검증 실행을 같은 원고로 다시 실행
 *   npm run daily-blog -- --report                  # 최근 실행·발행 이력 요약
 *
 * publish 모드: 미디어는 GitHub 공개 저장소(jsDelivr)에 올리고, 글은 Blogger API로 발행한다.
 * 필요한 환경변수: GOOGLE_*, BLOGGER_BLOG_ID, GITHUB_MEDIA_REPO, GITHUB_MEDIA_TOKEN
 */
import { resolve } from 'node:path';
import { optionalEnv, requireEnv } from '../src/config/env.ts';
import { GitHubCdnHost, LocalPreviewHost, type MediaHost } from '../src/media/media-host.ts';
import { createPublisher } from '../src/publishing/publisher.ts';
import { DEFAULT_PATHS, runDailyRoutine } from '../src/scheduler/daily-routine.ts';
import { loadLimits } from '../src/config/limits.ts';
import { listRunLogs, type RunLog } from '../src/storage/execution-log.ts';
import { readHistory } from '../src/storage/history.ts';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const draftArg = args.find((a) => !a.startsWith('--'));

function summary(l: RunLog): string {
  const icon = l.status === 'SUCCESS' ? '✅' : l.status === 'REVIEW_REQUIRED' ? '⚠️' : l.status === 'SKIPPED' ? '⏭' : '❌';
  return [
    `${icon} [${l.mode.toUpperCase()}] ${l.status}  (${((l.executionTimeMs ?? 0) / 1000).toFixed(1)}초)`,
    `날짜: ${l.date} / 콘텐츠: ${l.contentId ?? '-'}`,
    `카테고리: ${l.category ?? '-'} / 주제: ${l.topic ?? '-'}`,
    `제목: ${l.title ?? '-'}`,
    `글자수: ${l.wordCount ?? '-'}자 / 이미지: ${l.imageCount ?? 0}개 / 영상: ${l.videoCreated ? '있음' : '없음'}`,
    `팩트체크: ${l.factCheck ?? '-'} / 품질검사: ${l.qualityCheck ?? '-'}`,
    `Blogger 발행: ${l.publishStatus ?? '-'}${l.duplicatePrevented ? ' (중복 방지로 재발행 안 함)' : ''}`,
    `URL: ${l.bloggerUrl ?? '-'}`,
    ...Object.entries(l.steps).map(([k, s]) => `  · ${k}: ${s!.status}${s!.attempts > 1 ? ` (${s!.attempts}회 시도)` : ''}${s!.error && s!.status !== 'SUCCESS' ? ` — ${s!.error}` : ''}`),
    ...(l.errors.length ? ['오류:', ...l.errors.map((e) => `  - ${e}`)] : []),
  ].join('\n');
}

function mediaHostFor(mode: 'preview' | 'publish', draftPath: string): MediaHost {
  if (mode === 'preview') return new LocalPreviewHost(dirname(resolve(draftPath)));
  const e = requireEnv(['GITHUB_MEDIA_REPO', 'GITHUB_MEDIA_TOKEN']);
  return new GitHubCdnHost({ repo: e.GITHUB_MEDIA_REPO, token: e.GITHUB_MEDIA_TOKEN, branch: optionalEnv('GITHUB_MEDIA_BRANCH') ?? 'auto' });
}

async function run(draftPath: string, mode: 'preview' | 'publish') {
  const res = await runDailyRoutine(draftPath, mode, {
    mediaHost: mediaHostFor(mode, draftPath),
    publisher: mode === 'publish' ? createPublisher('blogger') : undefined,
    paths: DEFAULT_PATHS,
    requireVideo: (optionalEnv('REQUIRE_VIDEO') ?? 'true') !== 'false',
    limits: loadLimits(),
    log: (m) => console.log(m),
  });
  console.log('\n' + summary(res.log));
  console.log(`\n로그: ${res.logFile}`);
  process.exitCode = res.log.status === 'SUCCESS' || res.log.status === 'SKIPPED' ? 0 : res.log.status === 'REVIEW_REQUIRED' ? 3 : 1;
}

async function main() {
  if (flag('--report')) {
    const logs = await listRunLogs(DEFAULT_PATHS.logs, 10);
    const hist = await readHistory(DEFAULT_PATHS.history);
    console.log(`# 최근 실행 ${logs.length}건\n`);
    for (const l of logs) console.log(summary(l) + '\n');
    console.log(`# 발행 이력 ${hist.length}건`);
    for (const h of hist.slice(-10)) console.log(`- ${h.date} [${h.category}] ${h.title} ${h.url ?? ''}`);
    console.log('\n성과 데이터: 아직 수집 전 (Phase 6에서 실측값만 연결)');
    return;
  }
  if (flag('--retry')) {
    const last = (await listRunLogs(DEFAULT_PATHS.logs, 50)).find((l) => l.status === 'FAILED' || l.publishStatus === 'PUBLISHED_UNVERIFIED');
    if (!last) {
      console.log('다시 실행할 실패 기록이 없습니다.');
      return;
    }
    console.log(`재시도: ${last.runId} (${last.draftPath}, ${last.mode})`);
    return run(last.draftPath, last.mode);
  }
  if (!draftArg) {
    console.error('사용법: npm run daily-blog -- <draft.json> [--preview|--publish] | --retry | --report');
    process.exit(2);
  }
  return run(draftArg, flag('--publish') ? 'publish' : 'preview');
}

main().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
});
