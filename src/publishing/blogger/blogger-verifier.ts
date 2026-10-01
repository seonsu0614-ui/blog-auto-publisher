import { fetchWithRetry, HttpError, type FetchLike, type RetryOptions } from '../../util/http.ts';
import type { VerificationCheck, VerificationResult, VerifyExpectations } from '../adapters/publisher-interface.ts';

/**
 * 발행 결과 검증. API 성공 응답만 믿지 않고 실제 공개 URL에 다시 접속해 확인한다.
 * 블로그가 비공개이거나 반영이 지연되면 실패할 수 있으므로 호출 측에서 재시도한다.
 */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export async function verifyPublishedPage(
  url: string,
  expect: VerifyExpectations = {},
  fetchFn: FetchLike = fetch,
  retry: RetryOptions = {},
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  let html: string;
  let httpStatus: number | undefined;
  try {
    const res = await fetchWithRetry(fetchFn, url, { redirect: 'follow' }, retry);
    httpStatus = res.status;
    html = decodeEntities(await res.text());
  } catch (e) {
    httpStatus = e instanceof HttpError ? e.status : undefined;
    return { success: false, url, httpStatus, checks: [{ id: 'http', passed: false, detail: String((e as Error).message) }] };
  }
  checks.push({ id: 'http', passed: true, detail: `HTTP ${httpStatus}` });

  if (expect.title) {
    checks.push({ id: 'title', passed: html.includes(expect.title), detail: expect.title });
  }
  if (expect.markerHash) {
    // 마커는 HTML 주석이라 Blogger가 제거할 수도 있으므로 필수 실패로 보지 않는다 (참고용)
    checks.push({ id: 'marker(info)', passed: true, detail: html.includes(expect.markerHash) ? '마커 확인' : '마커 미노출(정상일 수 있음)' });
  }
  for (const [i, img] of (expect.imageUrls ?? []).entries()) {
    checks.push({ id: `image_${i + 1}`, passed: html.includes(img), detail: img });
  }
  if (expect.videoUrl) {
    checks.push({ id: 'video', passed: html.includes(expect.videoUrl), detail: expect.videoUrl });
  }
  for (const [i, src] of (expect.sourceUrls ?? []).entries()) {
    checks.push({ id: `source_link_${i + 1}`, passed: html.includes(src), detail: src });
  }
  for (const t of expect.mustContainText ?? []) {
    checks.push({ id: 'text', passed: html.includes(t), detail: t });
  }

  const success = checks.every((c) => c.passed);
  return { success, url, httpStatus, checks, error: success ? undefined : '검증 실패 항목: ' + checks.filter((c) => !c.passed).map((c) => c.id).join(', ') };
}
