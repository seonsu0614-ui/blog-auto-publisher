/**
 * 미리보기: 원고 JSON → 검사 → 결과 파일 생성. Blogger 발행은 하지 않는다.
 *   npm run preview -- data/articles/2026/10/20261002-001/draft.json
 * 출력 (원고와 같은 폴더):
 *   article.html  — Blogger에 들어갈 본문 HTML
 *   preview.html  — 브라우저로 열어 보는 미리보기 페이지(모바일 폭)
 *   report.json / report.md — 팩트체크·중복·품질 검사 결과
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runTextPipeline } from '../src/content/pipeline.ts';
import type { HistoryEntry } from '../src/content/duplicate-checker.ts';
import { escapeHtml, type MediaSlots } from '../src/content/html-builder.ts';
import { LocalPreviewHost } from '../src/media/media-host.ts';
import { buildMedia } from '../src/media/media-pipeline.ts';
import type { ArticleDraft } from '../src/types/draft.ts';

const args = process.argv.slice(2);
const draftPath = args.find((a) => !a.startsWith('--'));
if (!draftPath) {
  console.error('사용법: npm run preview -- <draft.json> [--media] [--stage=text|full] [--history=data/history.json]');
  process.exit(2);
}
const withMedia = args.includes('--media');
const stage = (args.find((a) => a.startsWith('--stage='))?.split('=')[1] ?? (withMedia ? 'full' : 'text')) as 'text' | 'full';
const historyPath = args.find((a) => a.startsWith('--history='))?.split('=')[1] ?? 'data/history.json';

const draft = JSON.parse(readFileSync(resolve(draftPath), 'utf8')) as ArticleDraft;
const history: HistoryEntry[] = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) : [];
const outDir = dirname(resolve(draftPath));
let media: MediaSlots | undefined;
let mediaErrors: string[] = [];
if (withMedia) {
  const built = await buildMedia(draft, { outDir, host: new LocalPreviewHost(outDir) });
  media = built.slots;
  mediaErrors = built.manifest.errors;
}
const r = runTextPipeline(draft, { history, stage, media });

writeFileSync(join(outDir, 'article.html'), r.content.html);
writeFileSync(
  join(outDir, 'preview.html'),
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(draft.title)}</title><meta name="description" content="${escapeHtml(draft.metaDescription)}">
<style>body{max-width:720px;margin:0 auto;padding:16px;font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.75;color:#222;background:#fff}h1{font-size:1.6em;line-height:1.35}h2{margin-top:2em;border-bottom:2px solid #e3e8ef;padding-bottom:4px}a{color:#2b6cb0}.meta{color:#666;font-size:.9em}</style>
</head><body><p class="meta">미리보기 · ${escapeHtml(draft.category)} · ${escapeHtml(draft.date)} · 상태: ${r.decision}</p><h1>${escapeHtml(draft.title)}</h1>
${r.content.html}</body></html>`,
);
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ decision: r.decision, reasons: r.reasons, fact: r.fact, duplicate: r.duplicate, quality: r.quality }, null, 2));

const line = (ok: boolean, pending?: boolean) => (pending ? '⏳' : ok ? '✅' : '❌');
const md = [
  `# 미리보기 결과 — ${draft.contentId}`,
  '',
  `- 결정: **${r.decision}**`,
  `- 제목: ${draft.title}`,
  `- 핵심 키워드: ${draft.primaryKeyword}`,
  `- 분량: 공백 제외 ${r.quality.stats.charsNoSpace}자 / 공백 포함 ${r.quality.stats.charsWithSpace}자`,
  `- 팩트체크: ${r.fact.status} (숫자 ${r.fact.checkedNumbers}개 대조, 주장 ${draft.claims.length}개, 출처 ${draft.sources.length}개)`,
  ...(media ? [`- 미디어: 이미지 ${media.images.length}개${media.video ? `, 영상 ${media.video.durationSec}초 ${media.video.width}×${media.video.height}` : ', 영상 없음'}`] : []),
  ...(mediaErrors.length ? ['', '## 미디어 오류', ...mediaErrors.map((e) => `- ${e}`)] : []),
  '',
  '## 품질검사',
  ...r.quality.items.map((i) => `- ${line(i.passed, i.detail?.startsWith('PENDING'))} ${i.label}${i.detail ? ` — ${i.detail}` : ''}${i.critical ? '' : ' (권장)'}`),
  ...(r.quality.warnings.length ? ['', '## 경고', ...r.quality.warnings.map((w) => `- ${w}`)] : []),
  ...(r.fact.issues.length ? ['', '## 팩트체크 이슈', ...r.fact.issues.map((i) => `- [${i.level}] ${i.message}`)] : []),
  ...(r.reasons.length ? ['', '## 사유', ...r.reasons.map((x) => `- ${x}`)] : []),
].join('\n');
writeFileSync(join(outDir, 'report.md'), md + '\n');

console.log(md);
console.log(`\n출력: ${outDir}`);
process.exit(r.decision === 'BLOCKED' ? 1 : 0);
