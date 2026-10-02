import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BlogVideo } from '../types/content.ts';
import type { VideoScene, VideoSpec } from '../types/media.ts';
import { saveOptimizedJpeg, svgToPng } from './image-processor.ts';
import { BRAND, FONT, clean, svgDoc, textBlock, textWidth, wrap, x } from './svg-kit.ts';

const run = promisify(execFile);

/**
 * 숏폼 영상 (10~30초, 1080×1920, H.264 MP4).
 * 장면 구성: Hook(0~3초) → 핵심 숫자(3~10초) → 설명(10~20초) → 본문 안내(20~30초).
 * 각 장면을 이미지로 그린 뒤 ffmpeg로 이어 붙이고(전환 효과 포함) 무음 영상으로 만든다.
 * 외부 영상·음원을 쓰지 않으므로 라이선스 문제가 없다.
 */

export const V_W = 1080;
export const V_H = 1920;
const FADE = 0.4;
const DEFAULT_SECONDS: Record<VideoScene['kind'], number> = { hook: 3.5, fact: 6, explain: 5.5, cta: 4 };

export function sceneSvg(sc: VideoScene, i: number, total: number, date: string): string {
  const dark = sc.kind === 'hook' || sc.kind === 'cta';
  const fg = dark ? BRAND.white : BRAND.navy;
  const sub = dark ? '#c9dbf2' : BRAND.muted;
  const W = V_W - 160;
  const parts: string[] = [];
  parts.push(`<text x="80" y="150" font-family="${FONT}" font-size="40" font-weight="700" fill="${dark ? '#9cc3ee' : BRAND.blue}">${x(BRAND.name)}</text>`);
  parts.push(`<text x="${V_W - 80}" y="150" font-family="${FONT}" font-size="32" fill="${sub}" text-anchor="end">기준일 ${x(date)}</text>`);

  // 블록 높이를 먼저 계산해 화면 세로 중앙(약간 위)에 배치
  const heading = wrap(sc.heading, W, 76, 4);
  const big = sc.big ? clean(sc.big) : '';
  let bs = 200;
  while (big && textWidth(big, bs) > W && bs > 90) bs -= 10;
  const body = sc.body ? wrap(sc.body, W, 50, 5) : [];
  const hHeading = heading.length * 100;
  const hBig = big ? bs + 70 : 0;
  const hBody = body.length * 72;
  const blockH = hHeading + 60 + hBig + hBody;
  let y = Math.max(320, (V_H - blockH) / 2 - 60) + 76;
  parts.push(textBlock(heading, { x: 80, y, size: 76, weight: 800, fill: fg, lineHeight: 100 }));
  y += hHeading - 100 + 60 + 76;
  if (big) {
    parts.push(`<text x="80" y="${y + bs * 0.75}" font-family="${FONT}" font-size="${bs}" font-weight="900" fill="${dark ? BRAND.accent : BRAND.blue}">${x(big)}</text>`);
    y += bs + 70;
  }
  if (body.length) parts.push(textBlock(body, { x: 80, y, size: 50, fill: sub, lineHeight: 72 }));

  // 진행 표시
  const barW = (V_W - 160) / total;
  for (let k = 0; k < total; k++) {
    parts.push(`<rect x="${80 + k * barW + 6}" y="${V_H - 150}" width="${barW - 12}" height="10" rx="5" fill="${k <= i ? (dark ? BRAND.accent : BRAND.blue) : dark ? '#3b5b85' : BRAND.line}"/>`);
  }
  if (sc.kind === 'cta') {
    parts.push(`<text x="80" y="${V_H - 220}" font-family="${FONT}" font-size="40" fill="#9cc3ee">lifeeconomy-briefing.blogspot.com</text>`);
  }
  return svgDoc(V_W, V_H, parts.join(''), dark ? BRAND.navy : BRAND.paper);
}

export function plannedDuration(spec: VideoSpec): number {
  const secs = spec.scenes.map((s) => s.seconds ?? DEFAULT_SECONDS[s.kind]);
  return secs.reduce((a, b) => a + b, 0) - FADE * (secs.length - 1);
}

export async function hasFfmpeg(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-hide_banner', '-version']);
    return true;
  } catch {
    return false;
  }
}

export async function generateVideo(spec: VideoSpec, o: { date: string; slug: string; outDir: string; crf?: number }): Promise<BlogVideo> {
  if (spec.scenes.length < 2) throw new Error('영상 장면은 2개 이상 필요');
  const dur = plannedDuration(spec);
  if (dur < 10 || dur > 30) throw new Error(`영상 길이 ${dur.toFixed(1)}초: 10~30초 범위를 벗어남`);
  if (!(await hasFfmpeg())) throw new Error('ffmpeg가 설치되어 있지 않음');

  const work = join(o.outDir, '.video-frames');
  await mkdir(work, { recursive: true });
  const frames: string[] = [];
  for (const [i, sc] of spec.scenes.entries()) {
    frames.push(await svgToPng(sceneSvg(sc, i, spec.scenes.length, o.date), join(work, `scene-${i}.png`)));
  }

  const secs = spec.scenes.map((s) => s.seconds ?? DEFAULT_SECONDS[s.kind]);
  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
  frames.forEach((f, i) => args.push('-loop', '1', '-t', String(secs[i]), '-framerate', '30', '-i', f));

  // 장면 사이 페이드 전환 (xfade 연결)
  const filters: string[] = frames.map((_, i) => `[${i}:v]scale=${V_W}:${V_H},format=yuv420p,setsar=1[s${i}]`);
  let prev = 's0';
  let offset = 0;
  for (let i = 1; i < frames.length; i++) {
    offset += secs[i - 1]! - FADE;
    const out = i === frames.length - 1 ? 'vout' : `x${i}`;
    filters.push(`[${prev}][s${i}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(2)}[${out}]`);
    prev = out;
  }
  const outFile = join(o.outDir, `${o.slug}-short.mp4`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', String(o.crf ?? 23),
    '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', '-an',
    outFile,
  );
  await run('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 });

  // 결과 검증 (ffprobe)
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', outFile]);
  const info = JSON.parse(stdout) as { streams: Array<{ codec_name: string; width: number; height: number }>; format: { duration: string } };
  const st = info.streams[0]!;
  const duration = Number(info.format.duration);
  if (st.codec_name !== 'h264' || st.width !== V_W || st.height !== V_H) throw new Error(`영상 형식 불일치: ${st.codec_name} ${st.width}x${st.height}`);
  if (duration < 10 || duration > 30.5) throw new Error(`영상 길이 불일치: ${duration}초`);

  const poster = await saveOptimizedJpeg(await readFile(frames[0]!), join(o.outDir, `${o.slug}-short-poster.jpg`), { maxWidth: 720 });
  await rm(work, { recursive: true, force: true });

  return {
    localPath: outFile,
    posterPath: poster.path,
    durationSec: Math.round(duration * 10) / 10,
    width: st.width,
    height: st.height,
    codec: 'h264',
    origin: 'generated',
    license: '자체 제작 영상 (생활경제 브리핑 저작물, 외부 영상·음원 미사용)',
    licenseVerified: true,
    fileSizeBytes: (await stat(outFile)).size,
    altText: clean(spec.alt),
  };
}
