import { fetchWithRetry, type FetchLike } from '../util/http.ts';
import type { ImageProvider, ImageSearchResult, LicenseResult } from './image-engine.ts';

/**
 * Pexels 공식 API 어댑터 (https://www.pexels.com/api/documentation/).
 * Pexels License: 상업적 이용 무료, 출처 표기 권장(필수 아님). 단, 사진 속 인물·브랜드·상표는 별도 권리가 있을 수 있다.
 * 현재 Claude 클라우드 작업 공간에서는 api.pexels.com 접속이 차단되어 있어(2026-10-01 실측),
 * PEXELS_API_KEY가 있고 네트워크가 열린 실행 환경(본인 PC, GitHub Actions)에서만 동작한다.
 */
export class PexelsProvider implements ImageProvider {
  readonly name = 'Pexels';
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async search(query: string, opts: { perPage?: number; orientation?: 'landscape' | 'portrait' } = {}): Promise<ImageSearchResult[]> {
    const u = new URL('https://api.pexels.com/v1/search');
    u.searchParams.set('query', query);
    u.searchParams.set('per_page', String(opts.perPage ?? 10));
    if (opts.orientation) u.searchParams.set('orientation', opts.orientation);
    const res = await fetchWithRetry(this.fetchFn, u.toString(), { headers: { authorization: this.apiKey } });
    const data = (await res.json()) as {
      photos: Array<{ id: number; url: string; width: number; height: number; photographer: string; photographer_url: string; alt?: string; src: { large2x: string } }>;
    };
    return data.photos.map((p) => ({
      provider: 'Pexels',
      id: String(p.id),
      pageUrl: p.url,
      downloadUrl: p.src.large2x,
      author: p.photographer,
      authorUrl: p.photographer_url,
      width: p.width,
      height: p.height,
      description: p.alt,
    }));
  }

  async download(image: ImageSearchResult): Promise<Buffer> {
    const res = await fetchWithRetry(this.fetchFn, image.downloadUrl);
    return Buffer.from(await res.arrayBuffer());
  }

  async verifyLicense(image: ImageSearchResult): Promise<LicenseResult> {
    // 공식 API로 받은 Pexels 호스팅 이미지인지 확인 (다른 출처 URL이 섞이지 않았는지)
    const official = /^https:\/\/www\.pexels\.com\/photo\//.test(image.pageUrl) && /^https:\/\/images\.pexels\.com\//.test(image.downloadUrl);
    return {
      verified: official && !!image.author,
      license: 'Pexels License (https://www.pexels.com/license/)',
      commercialUse: true,
      attributionRequired: false,
      notes: official ? '공식 API 결과' : '공식 Pexels URL이 아님 → 사용 안 함',
    };
  }
}
