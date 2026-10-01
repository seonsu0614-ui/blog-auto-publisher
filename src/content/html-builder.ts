import type { BlogImage, BlogVideo } from '../types/content.ts';
import type { ArticleDraft, Block } from '../types/draft.ts';

/**
 * ArticleDraft → Blogger 본문 HTML.
 * - 글 제목(H1)은 Blogger 테마가 게시물 제목으로 렌더링하므로 본문에는 H2부터 쓴다
 *   (본문에도 H1을 넣으면 한 페이지에 H1이 두 개가 되어 SEO에 불리).
 * - 스크립트·외부 CSS 없이 인라인 스타일 최소한만 사용 (Blogger 편집기 호환).
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 인라인 마크업 변환: **굵게**, [S1] 출처 각주, {C1} 근거 표시(제거) */
export function renderInline(text: string, sourceIndex: Map<string, number>): string {
  let s = escapeHtml(text.replace(/\{C\d+\}/g, ''));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[(S\d+)\]/g, (_, id: string) => {
    const n = sourceIndex.get(id);
    return n ? `<sup><a href="#src-${n}">[${n}]</a></sup>` : '';
  });
  return s.replace(/\s+(<sup>)/g, '$1').trim();
}

function renderBlock(b: Block, idx: Map<string, number>, media: MediaSlots): string {
  switch (b.type) {
    case 'p':
      return `<p>${renderInline(b.text, idx)}</p>`;
    case 'ul':
    case 'ol':
      return `<${b.type}>${b.items.map((i) => `<li>${renderInline(i, idx)}</li>`).join('')}</${b.type}>`;
    case 'callout':
      return `<blockquote style="border-left:4px solid #2b6cb0;margin:16px 0;padding:8px 14px;background:#f5f8fc">${renderInline(b.text, idx)}</blockquote>`;
    case 'table': {
      const head = `<thead><tr>${b.headers.map((h) => `<th style="border:1px solid #ccd;padding:6px 8px;background:#eef2f7">${renderInline(h, idx)}</th>`).join('')}</tr></thead>`;
      const body = `<tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #ccd;padding:6px 8px">${renderInline(c, idx)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      const cap = b.caption ? `<caption style="text-align:left;font-weight:bold;padding:4px 0">${renderInline(b.caption, idx)}</caption>` : '';
      const note = b.note ? `<p style="font-size:0.9em;color:#555">${renderInline(b.note, idx)}</p>` : '';
      return `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:0.95em">${cap}${head}${body}</table></div>${note}`;
    }
    case 'image': {
      const img = media.images[b.slot - 1];
      if (!img?.publicUrl) return `<!-- image slot ${b.slot} -->`;
      const credit = img.origin === 'generated' ? '' : `<br/><small>${escapeHtml(img.author ?? '')} / ${escapeHtml(img.license ?? '')}</small>`;
      return `<figure style="margin:16px 0;text-align:center"><img src="${escapeHtml(img.publicUrl)}" alt="${escapeHtml(img.altText)}" width="${img.width ?? ''}" height="${img.height ?? ''}" loading="lazy" style="max-width:100%;height:auto"/>${img.caption || credit ? `<figcaption style="font-size:0.85em;color:#666">${escapeHtml(img.caption ?? '')}${credit}</figcaption>` : ''}</figure>`;
    }
    case 'video': {
      const v = media.video;
      if (!v?.publicUrl) return '<!-- video slot -->';
      return `<figure style="margin:16px 0;text-align:center"><video src="${escapeHtml(v.publicUrl)}" ${v.posterUrl ? `poster="${escapeHtml(v.posterUrl)}"` : ''} controls playsinline muted style="max-width:360px;width:100%"></video></figure>`;
    }
  }
}

export interface MediaSlots {
  images: BlogImage[];
  video?: BlogVideo;
}

export function buildHtml(d: ArticleDraft, media: MediaSlots = { images: [] }): string {
  const idx = new Map(d.sources.map((s, i) => [s.id, i + 1] as const));
  const out: string[] = [];

  out.push(...d.hook.map((h) => `<p>${renderInline(h, idx)}</p>`));
  out.push(
    `<div style="border:1px solid #d6e0ef;border-radius:8px;padding:12px 16px;margin:16px 0;background:#f8fafd"><p style="margin:0 0 6px"><strong>핵심 요약</strong> <small style="color:#666">(기준일 ${escapeHtml(d.date)})</small></p><ul style="margin:0">${d.summary
      .map((s) => `<li>${renderInline(s, idx)}</li>`)
      .join('')}</ul></div>`,
  );

  for (const sec of d.sections) {
    out.push(`<h${sec.level}>${escapeHtml(sec.heading)}</h${sec.level}>`);
    for (const b of sec.blocks) out.push(renderBlock(b, idx, media));
  }

  if (d.faq.length) {
    out.push('<h2>자주 묻는 질문</h2>');
    for (const f of d.faq) out.push(`<h3>Q. ${escapeHtml(f.question)}</h3>`, `<p>${renderInline(f.answer, idx)}</p>`);
  }

  out.push('<h2>핵심 정리</h2>', `<ul>${d.closing.map((c) => `<li>${renderInline(c, idx)}</li>`).join('')}</ul>`);

  out.push('<h2>출처</h2>', '<ol style="font-size:0.9em">');
  d.sources.forEach((s, i) => {
    const ref = s.referenceDate ? `, 기준일 ${escapeHtml(s.referenceDate)}` : '';
    out.push(
      `<li id="src-${i + 1}">${escapeHtml(s.publisher)}, 「<a href="${escapeHtml(s.url)}" rel="noopener" target="_blank">${escapeHtml(s.title)}</a>」${ref} (확인일 ${escapeHtml(s.accessedAt)})</li>`,
    );
  });
  out.push('</ol>');

  if (['생활경제', '경제', '정책제도'].includes(d.category)) {
    out.push(
      `<p style="font-size:0.85em;color:#666">이 글은 ${escapeHtml(d.date)} 기준 공개 자료를 정리한 일반 정보이며 금융·세무·법률 자문이 아닙니다. 상품 조건과 제도는 바뀔 수 있으니 신청 전 해당 기관의 최신 공지를 확인하세요.</p>`,
    );
  }
  if (d.category === '정치') {
    out.push(
      `<p style="font-size:0.85em;color:#666">이 글은 특정 정당·후보에 대한 지지나 반대를 목적으로 하지 않으며, ${escapeHtml(d.date)} 기준 공식 자료를 바탕으로 사실과 쟁점을 정리한 정보 글입니다.</p>`,
    );
  }
  return out.join('\n');
}

/** HTML에서 화면에 보이는 텍스트만 추출 */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
