import type { QualityCheckItem, QualityCheckResult } from '../types/content.ts';
import type { ArticleDraft } from '../types/draft.ts';
import type { MediaSlots } from './html-builder.ts';
import { visibleText } from './html-builder.ts';
import { mediaTexts } from '../types/media.ts';

/**
 * 발행 직전 품질검사.
 * critical 항목이 하나라도 실패하면 자동 발행 금지.
 * stage='text'는 Phase 2(미디어 연결 전) 미리보기용: 이미지·영상 항목을 PENDING으로 표시한다.
 */

export const MIN_CHARS_NO_SPACE = 1500;
export const TARGET_CHARS = { min: 2000, max: 3000 };

/** 낚시·과장·공포 표현 (근거가 있어도 제목·본문에 쓰지 않는다) */
export const BANNED_PHRASES: RegExp[] = [
  /무조건/,
  /100\s*%\s*(확정|보장|승인|된다|가능)/,
  /정부가\s*숨기/,
  /충격(적인|!|\s*진실)/,
  /돈\s*번다/,
  /대출\s*(무조건|100%|반드시)\s*(된|나)/,
  /반드시\s*(폭등|폭락)/,
  /큰일\s*납니다/,
  /!!+/,
  /안녕하세요\s*여러분/,
  /오늘은\s*.{0,20}에\s*대해\s*알아보겠습니다/,
  /좋아요와\s*구독/,
  /수익\s*(보장|확정)/,
];

/** 근거 없이 쓰면 안 되는 단정 표현 → 경고(비치명) */
export const CAUTION_PHRASES: RegExp[] = [/반드시/, /확실히/, /틀림없이/, /절대(로)?\s/];

/** 정치 콘텐츠 금지 표현 */
export const POLITICS_BANNED: RegExp[] = [
  /(지지|투표)\s*(하세요|해야|합시다|해\s*주세요)/,
  /(찍어야|뽑아야|뽑읍시다)/,
  /(당선|낙선)\s*(될|확실|유력|예상)/,
  /(정신|건강)\s*(상태|이상)/,
  /선거\s*결과\s*(예측|전망)/,
];

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.?!다요])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15);
}

function balanceOk(html: string): { ok: boolean; detail?: string } {
  const voids = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'source', 'wbr']);
  const stack: string[] = [];
  for (const m of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z0-9]+)[^>]*?(\/?)>/g)) {
    const [, close, rawTag, selfClose] = m;
    const tag = rawTag!.toLowerCase();
    if (voids.has(tag) || selfClose) continue;
    if (!close) stack.push(tag);
    else {
      const top = stack.pop();
      if (top !== tag) return { ok: false, detail: `<${top ?? '없음'}> 위치에서 </${tag}> 닫힘` };
    }
  }
  return stack.length ? { ok: false, detail: `닫히지 않은 태그: ${stack.join(', ')}` } : { ok: true };
}

export interface QualityInput {
  draft: ArticleDraft;
  html: string;
  media?: MediaSlots;
  factStatus: 'PASS' | 'FAIL' | 'REVIEW_REQUIRED' | 'NOT_RUN';
  duplicate: { isDuplicate: boolean; detail?: string };
  stage?: 'text' | 'full';
  requireVideo?: boolean;
}

export interface QualityReport extends QualityCheckResult {
  stats: { charsNoSpace: number; charsWithSpace: number; h2: number; h3: number; images: number; paragraphs: number; longParagraphs: number };
  warnings: string[];
}

export function runQualityCheck(q: QualityInput): QualityReport {
  const { draft: d, html } = q;
  const stage = q.stage ?? 'full';
  const items: QualityCheckItem[] = [];
  const warnings: string[] = [];
  const add = (id: string, label: string, critical: boolean, passed: boolean | 'pending', detail?: string) =>
    items.push({ id, label, critical, passed: passed === true, detail: passed === 'pending' ? `PENDING (Phase 3) ${detail ?? ''}`.trim() : detail });

  const text = visibleText(html);
  const charsNoSpace = text.replace(/\s/g, '').length;
  const h2 = (html.match(/<h2[\s>]/g) ?? []).length;
  const h3 = (html.match(/<h3[\s>]/g) ?? []).length;
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => visibleText(m[1]!));
  const longParagraphs = paragraphs.filter((p) => p.replace(/\s/g, '').length > 220).length;

  // ── QUALITY ──
  add('length', `본문 ${MIN_CHARS_NO_SPACE}자 이상(공백 제외)`, true, charsNoSpace >= MIN_CHARS_NO_SPACE, `${charsNoSpace}자`);
  if (charsNoSpace < TARGET_CHARS.min) warnings.push(`권장 분량(${TARGET_CHARS.min}~${TARGET_CHARS.max}자)보다 짧음: ${charsNoSpace}자`);

  const all = [d.title, text, ...mediaTexts(d.media)].join('\n');
  const banned = BANNED_PHRASES.filter((r) => r.test(all)).map((r) => r.source);
  add('banned', '금지 표현(낚시·과장·공포·AI 상투구) 없음', true, banned.length === 0, banned.join(', ') || undefined);

  const cautions = CAUTION_PHRASES.filter((r) => r.test(all)).map((r) => r.source);
  if (cautions.length) warnings.push(`단정 표현 사용(근거 확인 필요): ${cautions.join(', ')}`);

  if (d.category === '정치') {
    const pol = POLITICS_BANNED.filter((r) => r.test(all)).map((r) => r.source);
    add('politics', '정치 중립(지지·반대 유도, 선거 예측, 공인 추측 없음)', true, pol.length === 0, pol.join(', ') || undefined);
  }

  const sents = sentencesOf(text);
  const seen = new Map<string, number>();
  for (const s of sents) seen.set(s, (seen.get(s) ?? 0) + 1);
  const dupSents = [...seen].filter(([, n]) => n > 1).map(([s]) => s.slice(0, 30));
  add('dup_sentence', '중복 문장 없음', true, dupSents.length === 0, dupSents.join(' / ') || undefined);

  // ── SEO ──
  add('title', '제목 존재(15~60자)', true, d.title.length >= 15 && d.title.length <= 60, `${d.title.length}자`);
  add('seo_title', 'SEO 제목 존재', false, d.seoTitle.trim().length > 0);
  add('h1', 'H1(게시물 제목) 존재', true, d.title.trim().length > 0, 'Blogger 테마가 제목을 H1로 렌더링');
  add('no_body_h1', '본문에 H1 중복 없음', true, !/<h1[\s>]/.test(html));
  add('h2', 'H2 3개 이상', true, h2 >= 3, `H2 ${h2}개, H3 ${h3}개`);
  const kw = d.primaryKeyword.trim();
  const kwCount = kw ? text.split(kw).length - 1 : 0;
  add('keyword_title', '핵심 키워드가 제목에 포함', true, !!kw && d.title.includes(kw.split(' ')[0]!), kw);
  add('keyword_body', '핵심 키워드 본문 2~12회(도배 금지)', true, kwCount >= 2 && kwCount <= 12, `${kwCount}회`);
  add('meta', '메타 설명 50~160자', true, d.metaDescription.length >= 50 && d.metaDescription.length <= 160, `${d.metaDescription.length}자`);
  add('faq', 'FAQ 2개 이상', true, d.faq.length >= 2, `${d.faq.length}개`);
  add('hook', '도입 Hook 2~5문장', false, d.hook.length >= 2 && d.hook.length <= 5);
  add('tags', '태그 3~15개', false, d.tags.length >= 3 && d.tags.length <= 15, `${d.tags.length}개`);
  add('mobile', '모바일 가독성(긴 문단 없음, 220자 초과 문단 0개)', true, longParagraphs === 0, `${longParagraphs}개`);

  // ── FACT ──
  add('fact', '팩트체크 PASS', true, q.factStatus === 'PASS', q.factStatus);
  add('sources', '출처 2개 이상 + 공식기관 1개 이상', true, d.sources.length >= 2 && d.sources.some((s) => s.tier === 1), `${d.sources.length}개`);
  add('source_links', '출처 링크가 본문에 표시', true, d.sources.every((s) => html.includes(s.url.replace(/&/g, '&amp;'))));
  add('duplicate', '기존 글과 중복 아님', true, !q.duplicate.isDuplicate, q.duplicate.detail);

  // ── HTML ──
  const bal = balanceOk(html);
  add('html_valid', 'HTML 태그 짝 맞음', true, bal.ok, bal.detail);
  add('html_safe', '스크립트·iframe·인라인 이벤트 없음', true, !/<script|<iframe|\son\w+=/i.test(html));

  // ── MEDIA ──
  const images = q.media?.images ?? [];
  if (stage === 'text') {
    add('images', '이미지 5개 이상', true, 'pending');
    add('image_license', '이미지 라이선스 확인', true, 'pending');
    add('image_alt', '이미지 Alt 텍스트', true, 'pending');
    add('video', '숏폼 영상 1개', !!q.requireVideo, 'pending');
  } else {
    add('images', '이미지 5개 이상', true, images.length >= 5, `${images.length}개`);
    add('image_license', '이미지 라이선스 확인', true, images.every((i) => i.licenseVerified));
    add('image_alt', '이미지 Alt 텍스트', true, images.every((i) => i.altText.trim().length >= 5));
    add('image_in_html', '이미지가 본문에 삽입됨', true, images.every((i) => !!i.publicUrl && html.includes(i.publicUrl)));
    const kw = d.primaryKeyword.trim();
    const stuffed = images.filter((i) => kw && i.altText.split(kw).length - 1 > 1);
    add('image_alt_natural', 'Alt 텍스트 키워드 반복 없음', true, stuffed.length === 0, stuffed.map((i) => i.altText).join(' / ') || undefined);
    add('image_size', '이미지 용량 500KB 이하', false, images.every((i) => (i.fileSizeBytes ?? 0) <= 500 * 1024));
    const v = q.media?.video;
    add('video', '숏폼 영상 1개(라이선스 확인·본문 삽입)', q.requireVideo ?? true, !!v && v.licenseVerified && !!v.publicUrl && html.includes(v.publicUrl));
    if (v) add('video_spec', '영상 10~30초, 1080×1920, H.264', true, v.durationSec >= 10 && v.durationSec <= 30.5 && v.width === 1080 && v.height === 1920 && v.codec === 'h264', `${v.durationSec}초 ${v.width}×${v.height} ${v.codec}`);
  }

  const pending = items.some((i) => i.detail?.startsWith('PENDING'));
  const criticalFail = items.some((i) => i.critical && !i.passed && !i.detail?.startsWith('PENDING'));
  const status = criticalFail ? 'FAIL' : pending ? 'NOT_RUN' : 'PASS';
  return {
    status,
    checkedAt: new Date().toISOString(),
    items,
    warnings,
    stats: { charsNoSpace, charsWithSpace: text.length, h2, h3, images: images.length, paragraphs: paragraphs.length, longParagraphs },
  };
}
