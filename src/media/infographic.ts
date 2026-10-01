import type { ImageSpec } from '../types/media.ts';
import { BRAND, FONT, clean, svgDoc, textBlock, textWidth, wrap, x } from './svg-kit.ts';

/**
 * 직접 제작 인포그래픽 (1200×675, 16:9).
 * 외부 이미지를 쓰지 않으므로 저작권 문제가 없고, 숫자는 검증된 값만 들어간다.
 */

export const IMG_W = 1200;
export const IMG_H = 675;
const PAD = 64;
const CONTENT_W = IMG_W - PAD * 2;

function frame(date: string, title: string, footnote: string | undefined, content: (top: number) => string): string {
  const titleLines = wrap(title, CONTENT_W, 44, 2);
  const titleSvg = textBlock(titleLines, { x: PAD, y: 128, size: 44, weight: 700, fill: BRAND.navy, lineHeight: 56 });
  const top = 128 + (titleLines.length - 1) * 56 + 44;
  const foot = footnote ? textBlock(wrap(footnote, CONTENT_W, 20, 2), { x: PAD, y: IMG_H - 46, size: 20, fill: BRAND.muted, lineHeight: 26 }) : '';
  return svgDoc(
    IMG_W,
    IMG_H,
    `<rect x="0" y="0" width="${IMG_W}" height="8" fill="${BRAND.blue}"/>
     <text x="${PAD}" y="62" font-family="${FONT}" font-size="22" font-weight="700" fill="${BRAND.blue}">${x(BRAND.name)}</text>
     <text x="${IMG_W - PAD}" y="62" font-family="${FONT}" font-size="20" fill="${BRAND.muted}" text-anchor="end">기준일 ${x(date)}</text>
     ${titleSvg}${content(top)}${foot}`,
  );
}

function cover(s: Extract<ImageSpec, { kind: 'cover' }>, date: string): string {
  const titleLines = wrap(s.title, CONTENT_W, 64, 3);
  const titleTop = 340 - ((titleLines.length - 1) * 80) / 2;
  const sub = s.subtitle ? wrap(s.subtitle, CONTENT_W, 30, 2) : [];
  return svgDoc(
    IMG_W,
    IMG_H,
    `<rect x="0" y="${IMG_H - 10}" width="${IMG_W}" height="10" fill="${BRAND.accent}"/>
     <text x="${PAD}" y="80" font-family="${FONT}" font-size="24" font-weight="700" fill="#9cc3ee">${x(BRAND.name)}</text>
     <text x="${IMG_W - PAD}" y="80" font-family="${FONT}" font-size="22" fill="#9cc3ee" text-anchor="end">기준일 ${x(date)}</text>
     ${s.eyebrow ? `<text x="${PAD}" y="${titleTop - 70}" font-family="${FONT}" font-size="30" font-weight="700" fill="${BRAND.accent}">${x(clean(s.eyebrow))}</text>` : ''}
     ${textBlock(titleLines, { x: PAD, y: titleTop, size: 64, weight: 800, fill: BRAND.white, lineHeight: 80 })}
     ${textBlock(sub, { x: PAD, y: titleTop + titleLines.length * 80 + 30, size: 30, fill: '#d6e4f5', lineHeight: 42 })}`,
    BRAND.navy,
  );
}

function stats(s: Extract<ImageSpec, { kind: 'stats' }>, date: string): string {
  return frame(date, clean(s.title), s.footnote && clean(s.footnote), (top) => {
    const n = Math.min(s.stats.length, 3);
    const gap = 28;
    const cw = (CONTENT_W - gap * (n - 1)) / n;
    const ch = IMG_H - top - 120;
    return s.stats
      .slice(0, 3)
      .map((st, i) => {
        const cx = PAD + i * (cw + gap);
        const value = clean(st.value);
        let vs = 72;
        while (textWidth(value, vs) > cw - 48 && vs > 34) vs -= 4;
        return `<rect x="${cx}" y="${top}" width="${cw}" height="${ch}" rx="18" fill="${BRAND.white}" stroke="${BRAND.line}"/>
          ${textBlock(wrap(st.label, cw - 48, 26, 2), { x: cx + 24, y: top + 52, size: 26, fill: BRAND.muted, lineHeight: 34 })}
          <text x="${cx + 24}" y="${top + ch / 2 + 40}" font-family="${FONT}" font-size="${vs}" font-weight="800" fill="${BRAND.blue}">${x(value)}</text>
          ${st.note ? textBlock(wrap(st.note, cw - 48, 22, 2), { x: cx + 24, y: top + ch - 40, size: 22, fill: BRAND.muted, lineHeight: 28 }) : ''}`;
      })
      .join('');
  });
}

function table(s: Extract<ImageSpec, { kind: 'table' }>, date: string): string {
  return frame(date, clean(s.title), s.footnote && clean(s.footnote), (top) => {
    const cols = s.headers.length;
    const colW = CONTENT_W / cols;
    const rows = s.rows.slice(0, 5);
    const rh = Math.min(78, (IMG_H - top - 110) / (rows.length + 1));
    const fs = Math.min(30, rh * 0.42);
    let out = `<rect x="${PAD}" y="${top}" width="${CONTENT_W}" height="${rh}" rx="10" fill="${BRAND.navy}"/>`;
    s.headers.forEach((h, c) => {
      out += `<text x="${PAD + c * colW + colW / 2}" y="${top + rh / 2 + fs * 0.36}" font-family="${FONT}" font-size="${fs}" font-weight="700" fill="${BRAND.white}" text-anchor="middle">${x(clean(h))}</text>`;
    });
    rows.forEach((r, ri) => {
      const y = top + rh * (ri + 1);
      out += `<rect x="${PAD}" y="${y}" width="${CONTENT_W}" height="${rh}" fill="${ri % 2 ? BRAND.sky : BRAND.white}"/>`;
      r.forEach((cell, c) => {
        out += `<text x="${PAD + c * colW + colW / 2}" y="${y + rh / 2 + fs * 0.36}" font-family="${FONT}" font-size="${fs}" font-weight="${c === cols - 1 ? 700 : 400}" fill="${c === cols - 1 ? BRAND.blue : BRAND.ink}" text-anchor="middle">${x(clean(cell))}</text>`;
      });
    });
    out += `<rect x="${PAD}" y="${top}" width="${CONTENT_W}" height="${rh * (rows.length + 1)}" rx="10" fill="none" stroke="${BRAND.line}" stroke-width="2"/>`;
    return out;
  });
}

function checklist(s: Extract<ImageSpec, { kind: 'checklist' }>, date: string): string {
  return frame(date, clean(s.title), s.footnote && clean(s.footnote), (top) => {
    const items = s.items.slice(0, 5);
    const avail = IMG_H - top - 100;
    const step = avail / items.length;
    const fs = Math.min(32, step * 0.42);
    return items
      .map((it, i) => {
        const cy = top + step * i + step / 2;
        const lines = wrap(it, CONTENT_W - 90, fs, 2);
        const ty = cy - ((lines.length - 1) * fs * 1.3) / 2 + fs * 0.35;
        return `<circle cx="${PAD + 22}" cy="${cy}" r="20" fill="${BRAND.blue}"/>
          <path d="M${PAD + 12} ${cy} l7 8 l14 -16" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          ${textBlock(lines, { x: PAD + 64, y: ty, size: fs, fill: BRAND.ink, lineHeight: fs * 1.3, weight: 500 })}`;
      })
      .join('');
  });
}

function timeline(s: Extract<ImageSpec, { kind: 'timeline' }>, date: string): string {
  return frame(date, clean(s.title), s.footnote && clean(s.footnote), (top) => {
    const ev = s.events.slice(0, 4);
    const ly = top + (IMG_H - top - 100) / 2;
    const seg = CONTENT_W / ev.length;
    let out = `<line x1="${PAD}" y1="${ly}" x2="${IMG_W - PAD}" y2="${ly}" stroke="${BRAND.line}" stroke-width="6" stroke-linecap="round"/>`;
    ev.forEach((e, i) => {
      const cx = PAD + seg * i + seg / 2;
      const last = i === ev.length - 1;
      out += `<circle cx="${cx}" cy="${ly}" r="${last ? 18 : 14}" fill="${last ? BRAND.accent : BRAND.blue}"/>
        <text x="${cx}" y="${ly - 42}" font-family="${FONT}" font-size="30" font-weight="800" fill="${BRAND.navy}" text-anchor="middle">${x(clean(e.date))}</text>
        ${textBlock(wrap(e.label, seg - 24, 26, 3), { x: cx, y: ly + 60, size: 26, fill: BRAND.ink, anchor: 'middle', lineHeight: 34 })}`;
    });
    return out;
  });
}

function flow(s: Extract<ImageSpec, { kind: 'flow' }>, date: string): string {
  return frame(date, clean(s.title), s.footnote && clean(s.footnote), (top) => {
    const st = s.steps.slice(0, 4);
    const gap = 48;
    const bw = (CONTENT_W - gap * (st.length - 1)) / st.length;
    const bh = Math.min(240, IMG_H - top - 120);
    const by = top + (IMG_H - top - 100 - bh) / 2;
    return st
      .map((t, i) => {
        const bx = PAD + i * (bw + gap);
        const lines = wrap(t, bw - 36, 28, 4);
        const ty = by + bh / 2 - ((lines.length - 1) * 36) / 2 + 10;
        const arrow = i < st.length - 1 ? `<path d="M${bx + bw + 10} ${by + bh / 2} l${gap - 24} 0 m-12 -12 l12 12 l-12 12" stroke="${BRAND.accent}" stroke-width="5" fill="none" stroke-linecap="round"/>` : '';
        return `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="16" fill="${i === st.length - 1 ? BRAND.navy : BRAND.white}" stroke="${BRAND.line}" stroke-width="2"/>
          <text x="${bx + 20}" y="${by + 38}" font-family="${FONT}" font-size="22" font-weight="700" fill="${i === st.length - 1 ? '#9cc3ee' : BRAND.blue}">${i + 1}</text>
          ${textBlock(lines, { x: bx + bw / 2, y: ty, size: 28, weight: 700, fill: i === st.length - 1 ? BRAND.white : BRAND.ink, anchor: 'middle', lineHeight: 36 })}${arrow}`;
      })
      .join('');
  });
}

export function renderInfographicSvg(spec: ImageSpec, date: string): string {
  switch (spec.kind) {
    case 'cover':
      return cover(spec, date);
    case 'stats':
      return stats(spec, date);
    case 'table':
      return table(spec, date);
    case 'checklist':
      return checklist(spec, date);
    case 'timeline':
      return timeline(spec, date);
    case 'flow':
      return flow(spec, date);
  }
}
