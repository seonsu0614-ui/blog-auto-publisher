import { join } from 'node:path';
import type { BlogImage } from '../types/content.ts';
import type { ImageSpec } from '../types/media.ts';
import { saveOptimizedJpeg, seoFileName } from './image-processor.ts';
import { renderInfographicSvg } from './infographic.ts';
import { clean } from './svg-kit.ts';

/**
 * 이미지 확보 엔진.
 * 1순위 직접 제작 인포그래픽(저작권 문제 없음) → 필요 시 ImageProvider(스톡 API)로 보강.
 * 모든 결과는 BlogImage(라이선스 매니페스트 필드 포함)로 반환된다.
 */

export const GENERATED_LICENSE = '자체 제작 인포그래픽 (생활경제 브리핑 저작물, 외부 소재 미사용)';

/** 스톡 이미지 공급자 인터페이스 (Pexels·Unsplash·Pixabay 등). 키가 있고 네트워크가 열린 환경에서만 사용 */
export interface ImageSearchResult {
  provider: string;
  id: string;
  pageUrl: string;
  downloadUrl: string;
  author: string;
  authorUrl?: string;
  width: number;
  height: number;
  description?: string;
}

export interface LicenseResult {
  verified: boolean;
  license: string;
  commercialUse: boolean;
  attributionRequired: boolean;
  notes?: string;
}

export interface ImageProvider {
  readonly name: string;
  search(query: string, opts?: { perPage?: number; orientation?: 'landscape' | 'portrait' }): Promise<ImageSearchResult[]>;
  download(image: ImageSearchResult): Promise<Buffer>;
  verifyLicense(image: ImageSearchResult): Promise<LicenseResult>;
}

export async function generateInfographics(specs: ImageSpec[], o: { date: string; slug: string; outDir: string }): Promise<BlogImage[]> {
  const out: BlogImage[] = [];
  for (const spec of [...specs].sort((a, b) => a.slot - b.slot)) {
    const svg = renderInfographicSvg(spec, o.date);
    const file = join(o.outDir, seoFileName(o.slug, spec.slot, spec.kind));
    const p = await saveOptimizedJpeg(Buffer.from(svg), file);
    out.push({
      slot: spec.slot,
      localPath: p.path,
      origin: 'generated',
      license: GENERATED_LICENSE,
      licenseVerified: true,
      commercialUse: true,
      downloadedAt: new Date().toISOString(),
      altText: clean(spec.alt),
      caption: spec.caption ? clean(spec.caption) : undefined,
      width: p.width,
      height: p.height,
      format: p.format,
      fileSizeBytes: p.fileSizeBytes,
    });
  }
  return out;
}

/** 스톡 이미지 1장 확보: 라이선스가 확인된 것만 저장한다 */
export async function fetchStockImage(
  provider: ImageProvider,
  query: string,
  o: { slug: string; slot: number; outDir: string; alt: string },
): Promise<BlogImage | undefined> {
  const results = await provider.search(query, { perPage: 10, orientation: 'landscape' });
  for (const r of results) {
    const lic = await provider.verifyLicense(r);
    if (!lic.verified || !lic.commercialUse) continue;
    const buf = await provider.download(r);
    const p = await saveOptimizedJpeg(buf, join(o.outDir, seoFileName(o.slug, o.slot, 'photo')));
    return {
      slot: o.slot,
      localPath: p.path,
      sourceUrl: r.pageUrl,
      author: r.author,
      license: lic.license,
      licenseVerified: true,
      commercialUse: true,
      origin: 'stock',
      downloadedAt: new Date().toISOString(),
      altText: o.alt,
      caption: `사진: ${r.author} / ${r.provider}`,
      width: p.width,
      height: p.height,
      format: p.format,
      fileSizeBytes: p.fileSizeBytes,
    };
  }
  return undefined; // 라이선스 확인된 이미지가 없으면 사용하지 않는다
}
