/**
 * SVG 그리기 공용 도구: 한글 줄바꿈, 이스케이프, 브랜드 색상.
 * 글꼴은 Noto Sans CJK KR을 우선 사용하고, 없으면 맑은 고딕 등으로 대체된다.
 */

export const FONT = "'Noto Sans CJK KR','Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif";

export const BRAND = {
  name: '생활경제 브리핑',
  navy: '#1e3a5f',
  blue: '#2b6cb0',
  sky: '#e8f0fa',
  paper: '#f7f9fc',
  ink: '#1f2933',
  muted: '#5b6675',
  accent: '#e07a2e',
  line: '#d5deea',
  white: '#ffffff',
};

export function x(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 원고 표시 제거: {C1}, [S1], **굵게** */
export function clean(s: string): string {
  return s.replace(/\{C\d+\}/g, '').replace(/\[S\d+\]/g, '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
}

/** 글자 폭 추정: 한글·CJK 1.0em, 영문·숫자 0.58em, 공백 0.3em */
export function textWidth(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) w += 0.3;
    else if (/[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch)) w += 1.0;
    else if (/[A-Z%@#&]/.test(ch)) w += 0.68;
    else w += 0.58;
  }
  return w * fontSize;
}

/** 단어 단위 줄바꿈 (한글 어절 기준). 한 어절이 너무 길면 글자 단위로 자른다 */
export function wrap(s: string, maxWidth: number, fontSize: number, maxLines = 4): string[] {
  const words = clean(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  const push = () => {
    if (cur) lines.push(cur);
    cur = '';
  };
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, fontSize) <= maxWidth) {
      cur = next;
      continue;
    }
    push();
    if (textWidth(w, fontSize) <= maxWidth) cur = w;
    else {
      let piece = '';
      for (const ch of w) {
        if (textWidth(piece + ch, fontSize) > maxWidth) {
          lines.push(piece);
          piece = ch;
        } else piece += ch;
      }
      cur = piece;
    }
  }
  push();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1]!.replace(/.{1}$/, '…');
    return kept;
  }
  return lines;
}

/** 여러 줄 텍스트 → <text><tspan>…  y는 첫 줄 기준선 */
export function textBlock(
  lines: string[],
  opt: { x: number; y: number; size: number; lineHeight?: number; weight?: number; fill?: string; anchor?: 'start' | 'middle' | 'end' },
): string {
  const lh = opt.lineHeight ?? opt.size * 1.35;
  const tspans = lines.map((l, i) => `<tspan x="${opt.x}" dy="${i === 0 ? 0 : lh}">${x(l)}</tspan>`).join('');
  return `<text x="${opt.x}" y="${opt.y}" font-family="${FONT}" font-size="${opt.size}" font-weight="${opt.weight ?? 400}" fill="${opt.fill ?? BRAND.ink}" text-anchor="${opt.anchor ?? 'start'}">${tspans}</text>`;
}

export function svgDoc(w: number, h: number, body: string, bg: string = BRAND.paper): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
}
