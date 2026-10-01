import { fetchWithRetry, type FetchLike, type RetryOptions } from '../../util/http.ts';

/**
 * Google OAuth 2.0 (Refresh Token 방식).
 * 최초 1회 `npm run blogger:auth`로 Refresh Token을 발급받고,
 * 이후에는 이 모듈이 매 실행마다 Access Token을 자동 갱신한다.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const BLOGGER_SCOPE = 'https://www.googleapis.com/auth/blogger';

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

export class OAuthError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

async function postToken(
  fetchFn: FetchLike,
  params: Record<string, string>,
  retry?: RetryOptions,
): Promise<TokenResponse> {
  try {
    const res = await fetchWithRetry(
      fetchFn,
      GOOGLE_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      },
      retry,
    );
    return (await res.json()) as TokenResponse;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (msg.includes('invalid_grant') && params.grant_type === 'authorization_code') {
      throw new OAuthError(
        '인증 코드 교환 실패: 브라우저에서 연 주소가 이번 실행에서 출력된 주소와 다릅니다(복사 오류 또는 이전 실행의 주소). ' +
          '`npm run blogger:auth -- --save`를 다시 실행하고, 새로 나온 주소를 그대로 복사해 여세요.',
        'invalid_grant',
      );
    }
    if (msg.includes('invalid_grant')) {
      throw new OAuthError(
        'Refresh Token이 만료되었거나 취소되었습니다. `npm run blogger:auth`로 재발급하세요. ' +
          '(OAuth 동의 화면이 "테스트" 상태면 7일 후 만료됩니다 → "프로덕션"으로 전환 필요)',
        'invalid_grant',
      );
    }
    throw new OAuthError(`토큰 요청 실패: ${msg}`);
  }
}

/** 실행 중 Access Token을 캐시하고 만료 60초 전에 갱신한다. */
export class BloggerAuth {
  private accessToken?: string;
  private expiresAt = 0;

  constructor(
    private readonly creds: OAuthClientCredentials & { refreshToken: string },
    private readonly fetchFn: FetchLike = fetch,
    private readonly now: () => number = Date.now,
    private readonly retry?: RetryOptions,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAt - 60_000) return this.accessToken;
    const t = await postToken(
      this.fetchFn,
      {
        grant_type: 'refresh_token',
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken,
      },
      this.retry,
    );
    this.accessToken = t.access_token;
    this.expiresAt = this.now() + t.expires_in * 1000;
    return t.access_token;
  }

  invalidate(): void {
    this.accessToken = undefined;
    this.expiresAt = 0;
  }
}

/** 인증 URL 생성 (PKCE S256 + offline access → refresh token 발급) */
export function buildAuthUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: BLOGGER_SCOPE,
    access_type: 'offline',
    prompt: 'consent', // refresh_token을 확실히 받기 위함
    include_granted_scopes: 'true',
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

export async function exchangeCode(
  p: OAuthClientCredentials & { code: string; redirectUri: string; codeVerifier: string },
  fetchFn: FetchLike = fetch,
): Promise<TokenResponse> {
  return postToken(fetchFn, {
    grant_type: 'authorization_code',
    code: p.code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
    code_verifier: p.codeVerifier,
  });
}
