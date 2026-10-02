/**
 * 블로그 브랜드 이미지 생성 (로고·프로필, 헤더 배경, 파비콘, 기본 공유 이미지)
 *   node --experimental-strip-types scripts/brand-assets.ts [출력폴더]
 * 모두 직접 그린 벡터 → 라이선스 문제 없음.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const C = { navy: '#1e3a5f', deep: '#152c49', blue: '#2b6cb0', sky: '#e8f0fa', accent: '#e07a2e', white: '#ffffff', line: '#9fb6d3' };
const FONT = "'Noto Sans CJK KR','Noto Sans KR',sans-serif";
const out = process.argv[2] ?? 'brand';

/** 심볼: 오르는 막대 3개 + 주황 추세선 (viewBox 0 0 100 100) */
function mark(bg = true): string {
  return `
  ${bg ? `<rect width="100" height="100" rx="22" fill="${C.navy}"/>` : ''}
  <rect x="22" y="56" width="13" height="22" rx="3" fill="${C.line}"/>
  <rect x="43.5" y="44" width="13" height="34" rx="3" fill="${C.sky}"/>
  <rect x="65" y="32" width="13" height="46" rx="3" fill="${C.white}"/>
  <polyline points="20,48 40,36 54,40 80,18" fill="none" stroke="${C.accent}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="80" cy="18" r="6" fill="${C.accent}"/>`;
}

const logoSvg = (s: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">${mark()}</svg>`;

/** 프로필: 원형 크롭에 맞춰 여백 확보 */
const profileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${C.navy}"/>
  <g transform="translate(18 18) scale(0.64)">${mark(false)}</g>
</svg>`;

/** 헤더 배경: 가운데는 제목이 올라가므로 비워 두고, 양옆에 옅은 격자·추세선 */
function headerSvg(w: number, h: number): string {
  const grid: string[] = [];
  for (let x = 0; x <= w; x += 80) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${C.white}" stroke-opacity="0.045"/>`);
  for (let y = 0; y <= h; y += 80) grid.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${C.white}" stroke-opacity="0.045"/>`);
  const bars = [0, 1, 2, 3, 4, 5].map((i) => {
    const bh = 90 + i * 38, x = w - 640 + i * 92;
    return `<rect x="${x}" y="${h - bh}" width="52" height="${bh}" rx="6" fill="${C.white}" fill-opacity="${0.04 + i * 0.012}"/>`;
  });
  const leftBars = [0, 1, 2, 3].map((i) => {
    const bh = 60 + ((i * 53) % 110), x = 120 + i * 92;
    return `<rect x="${x}" y="${h - bh}" width="52" height="${bh}" rx="6" fill="${C.white}" fill-opacity="0.04"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.deep}"/><stop offset="1" stop-color="${C.navy}"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  ${grid.join('')}
  ${leftBars.join('')}
  ${bars.join('')}
  <polyline points="${w - 700},${h - 150} ${w - 520},${h - 230} ${w - 380},${h - 205} ${w - 200},${h - 330} ${w - 60},${h - 400}" fill="none" stroke="${C.accent}" stroke-opacity="0.55" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${w - 60}" cy="${h - 400}" r="10" fill="${C.accent}" fill-opacity="0.7"/>
</svg>`;
}

/** 기본 공유 이미지(대표 이미지가 없을 때) 1200x630 */
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${C.navy}"/>
  <g transform="translate(110 228) scale(1.5)">${mark(false)}</g>
  <text x="300" y="300" font-family="${FONT}" font-size="76" font-weight="700" fill="${C.white}">생활경제 브리핑</text>
  <text x="302" y="370" font-family="${FONT}" font-size="32" fill="${C.sky}">금리·물가·지원금·제도를 출처와 함께 쉽게</text>
  <rect x="96" y="470" width="1008" height="2" fill="${C.white}" fill-opacity="0.15"/>
  <text x="96" y="530" font-family="${FONT}" font-size="26" fill="${C.line}">lifeeconomy-briefing.blogspot.com</text>
</svg>`;

/** 상단 로고 배너(제목 대신 쓸 때) 1200x200, 투명 배경 */
const wordmarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="200" viewBox="0 0 1200 200">
  <g transform="translate(300 36) scale(1.28)">${mark(false)}</g>
  <text x="450" y="118" font-family="${FONT}" font-size="72" font-weight="700" fill="${C.white}">생활경제 브리핑</text>
  <text x="453" y="166" font-family="${FONT}" font-size="26" fill="${C.sky}">금리·물가·지원금·제도를 출처와 함께 쉽게</text>
</svg>`;

await mkdir(out, { recursive: true });
const png = (svg: string, file: string) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(join(out, file));
await png(logoSvg(512), 'logo-512.png');
await png(profileSvg, 'profile-512.png');
await png(logoSvg(144), 'favicon-144.png');
await png(wordmarkSvg, 'header-wordmark-1200x200.png');
await sharp(Buffer.from(headerSvg(2400, 800))).jpeg({ quality: 88, mozjpeg: true }).toFile(join(out, 'header-bg-2400x800.jpg'));
await sharp(Buffer.from(ogSvg)).jpeg({ quality: 90, mozjpeg: true }).toFile(join(out, 'share-1200x630.jpg'));
console.log('done →', out);
