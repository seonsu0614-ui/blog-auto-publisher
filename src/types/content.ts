/**
 * 콘텐츠 데이터 구조.
 * 콘텐츠는 문자열 하나가 아니라 구조화된 객체로 다룬다.
 * 생성(텍스트/미디어)과 발행(Publisher)이 이 타입 하나로만 연결된다.
 */

export type ContentCategory = '생활경제' | '경제' | '정책제도' | '정치';

export interface FAQItem {
  question: string;
  answer: string;
}

export interface Source {
  title: string;
  url: string;
  publisher: string; // 예: 한국은행, 국세청, 연합뉴스
  tier: 1 | 2 | 3; // 1=공식기관, 2=신뢰 언론, 3=보조자료
  accessedAt: string; // ISO 날짜
  referenceDate?: string; // 자료 기준일
}

export interface BlogImage {
  localPath: string;
  publicUrl?: string; // 발행 시 사용할 호스팅 URL (Blogger API는 이미지 업로드를 지원하지 않음)
  sourceUrl?: string;
  author?: string;
  license?: string;
  licenseVerified: boolean;
  commercialUse: boolean;
  origin: 'stock' | 'creative-commons' | 'generated';
  downloadedAt: string;
  altText: string;
  caption?: string;
  width?: number;
  height?: number;
  format?: string;
  fileSizeBytes?: number;
}

export interface BlogVideo {
  localPath: string;
  publicUrl?: string;
  posterUrl?: string;
  durationSec: number;
  width: number;
  height: number;
  codec: string;
  origin: 'generated' | 'stock';
  license: string;
  licenseVerified: boolean;
}

export type CheckStatus = 'PASS' | 'FAIL' | 'REVIEW_REQUIRED' | 'NOT_RUN';

export interface ClaimCheck {
  claim: string;
  value?: string;
  referenceDate?: string;
  condition?: string;
  sourceUrls: string[];
  verified: boolean;
  conflict: boolean;
  notes?: string;
}

export interface FactCheckResult {
  status: CheckStatus;
  checkedAt?: string;
  claims: ClaimCheck[];
}

export interface QualityCheckItem {
  id: string;
  label: string;
  critical: boolean;
  passed: boolean;
  detail?: string;
}

export interface QualityCheckResult {
  status: CheckStatus;
  checkedAt?: string;
  items: QualityCheckItem[];
}

export interface BlogContent {
  contentId: string; // 예: 20261002-001
  topic: string;
  category: ContentCategory;

  title: string;
  seoTitle: string;
  h1: string;
  slug?: string;

  metaDescription: string;

  primaryKeyword: string;
  secondaryKeywords: string[];
  relatedKeywords: string[];

  summary: string;
  html: string; // 본문 HTML (이미지/영상 태그 포함, H1은 Blogger 테마가 제목으로 렌더링하므로 본문에는 H2부터 권장)

  faq: FAQItem[];
  sources: Source[];
  images: BlogImage[];
  video?: BlogVideo;
  tags: string[];

  publishedAt?: string;

  factCheck: FactCheckResult;
  qualityCheck: QualityCheckResult;
}
