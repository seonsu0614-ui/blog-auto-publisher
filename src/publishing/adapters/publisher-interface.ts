import type { BlogContent } from '../../types/content.ts';

/**
 * 플랫폼 독립 발행 인터페이스.
 * Blogger 외에 WordPressPublisher, TistoryPublisher 등을 같은 형태로 추가한다.
 */

export interface DraftResult {
  success: boolean;
  postId?: string;
  editUrl?: string;
  /** 같은 콘텐츠가 이미 있어 새로 만들지 않은 경우 true */
  reusedExisting?: boolean;
  error?: string;
}

export interface PublishResult {
  success: boolean;
  postId?: string;
  url?: string;
  publishedAt?: string;
  /** 이미 발행된 동일 콘텐츠를 찾아 중복 발행을 막은 경우 true */
  duplicatePrevented?: boolean;
  error?: string;
}

export interface UpdateResult {
  success: boolean;
  postId: string;
  url?: string;
  updatedAt?: string;
  error?: string;
}

export interface DeleteResult {
  success: boolean;
  postId: string;
  error?: string;
}

export interface VerificationCheck {
  id: string;
  passed: boolean;
  detail?: string;
}

export interface VerificationResult {
  success: boolean;
  url: string;
  httpStatus?: number;
  checks: VerificationCheck[];
  error?: string;
}

export interface VerifyExpectations {
  title?: string;
  /** 발행 페이지에 반드시 있어야 하는 이미지 URL (테마 이미지와 구분하기 위해 개수 대신 URL로 확인) */
  imageUrls?: string[];
  videoUrl?: string;
  sourceUrls?: string[];
  mustContainText?: string[];
  /** 본문에 넣은 중복방지 마커 해시 */
  markerHash?: string;
  /** 플랫폼 API로 발행 상태를 직접 확인할 때 사용 */
  postId?: string;
}

export interface BlogPublisher {
  readonly platform: string;
  createDraft(content: BlogContent): Promise<DraftResult>;
  publish(content: BlogContent): Promise<PublishResult>;
  update(postId: string, content: BlogContent): Promise<UpdateResult>;
  delete(postId: string): Promise<DeleteResult>;
  verify(url: string, expect?: VerifyExpectations): Promise<VerificationResult>;
}
