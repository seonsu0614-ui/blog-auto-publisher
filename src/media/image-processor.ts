import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/**
 * 이미지 처리: SVG/원본 → 크기 확인 → 리사이즈 → JPEG 최적화(mozjpeg) → SEO 파일명 저장.
 * 목표 용량 300KB 이하. 넘으면 품질을 단계적으로 낮춘다.
 */

export const MAX_BYTES = 300 * 1024;
export const MAX_WIDTH = 1600;

export function seoFileName(slug: string, index: number, kind: string, ext = 'jpg'): string {
  const base = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${base || 'image'}-${String(index).padStart(2, '0')}-${kind}.${ext}`;
}

export interface ProcessedImage {
  path: string;
  width: number;
  height: number;
  format: 'jpeg';
  fileSizeBytes: number;
  quality: number;
}

export async function saveOptimizedJpeg(input: Buffer, outPath: string, opts: { maxWidth?: number; maxBytes?: number } = {}): Promise<ProcessedImage> {
  const maxWidth = opts.maxWidth ?? MAX_WIDTH;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const meta = await sharp(input, { density: 144 }).metadata();
  let quality = 84;
  let buf: Buffer;
  for (;;) {
    buf = await sharp(input, { density: 144 })
      .resize({ width: Math.min(maxWidth, meta.width ?? maxWidth), withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    if (buf.length <= maxBytes || quality <= 50) break;
    quality -= 8;
  }
  await mkdir(join(outPath, '..'), { recursive: true });
  await writeFile(outPath, buf);
  const m = await sharp(buf).metadata();
  return { path: outPath, width: m.width!, height: m.height!, format: 'jpeg', fileSizeBytes: (await stat(outPath)).size, quality };
}

/** SVG 문자열을 PNG로 (영상 프레임용, 무손실) */
export async function svgToPng(svg: string, outPath: string): Promise<string> {
  await mkdir(join(outPath, '..'), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  return outPath;
}
