# ARCHITECTURE

## 1. 결정 사항과 이유

| 결정 | 이유 |
|---|---|
| 발행 플랫폼: Google Blogger (공식 API v3) | 네이버는 2020년 글쓰기 API 종료. Blogger는 공식 OAuth + REST 발행 지원 |
| 브라우저 자동화 발행 사용 안 함 | 캡차·2단계 인증 우회 금지, 안정성 낮음 |
| 실행 위치 2분할 (아래) | Claude 클라우드 작업 공간은 조직 정책으로 `googleapis.com`, `slack.com`, 스톡 이미지 API 접속이 403 차단됨 (2026-10-01 실측) |
| 콘텐츠 ↔ 발행 분리 | `BlogContent` 타입 하나로만 연결. 플랫폼 교체 시 Publisher만 추가 |
| 텍스트 ↔ 미디어 분리 | 미디어 실패가 본문 생성에 영향 주지 않게, 라이선스 매니페스트 별도 관리 |
| 영구 저장: GitHub 저장소(+Drive 백업) | 예약 실행마다 작업 공간이 초기화됨 |

## 2. 전체 흐름

```text
[Claude 예약 작업 07:00 KST]  ← 웹검색/웹페치 가능, Google API 차단
  Research → Fact Check → Topic → Outline → Article → SEO
  → Media(인포그래픽 생성, ffmpeg 영상) → QA → 콘텐츠 패키지
  → GitHub 저장소 content/YYYY/MM/DD/ 에 커밋
                │
                ▼ (push 트리거)
[GitHub Actions]  ← 인터넷 제한 없음, 비밀값은 GitHub Secrets
  패키지 재검증(QA 게이트) → 미디어 공개 URL 확정
  → BloggerPublisher.publish() → verify() → 발행 원장 커밋
  → Slack 알림
```

## 3. 모듈

```text
src/
├── types/content.ts                 BlogContent 등 공용 타입
├── config/env.ts                    환경변수 로딩/검증
├── util/http.ts                     재시도(429/5xx, 최대 3회, 백오프)
├── storage/publish-ledger.ts        중복 발행 방지 원장 + 해시/마커
└── publishing/
    ├── adapters/publisher-interface.ts   BlogPublisher 인터페이스
    ├── publisher.ts                      플랫폼 팩토리
    └── blogger/
        ├── blogger-auth.ts               OAuth (Refresh Token → Access Token)
        ├── blogger-api.ts                Blogger REST 클라이언트
        ├── blogger-publisher.ts          초안/발행/수정/삭제 + 발행 게이트
        └── blogger-verifier.ts           공개 URL 재접속 검증
```

## 4. 중복 발행 방지 (idempotency)

1. 본문 끝에 숨김 주석 `<!-- bap:id=<contentId> hash=<contentHash> -->` 삽입
2. 발행 전 원장(contentId, hash) 확인 → 없으면 Blogger 최근 글 50개에서 마커/동일 제목 검색
3. 글 생성·발행 호출은 자동 재시도하지 않음. 실패 시 "실제로 생성/발행됐는지" 먼저 조회 후 재시도
4. 중복 여부를 확인할 수 없으면(API 장애) 발행하지 않음

## 5. 발행 게이트 (Publisher 내부 최종 안전장치)

팩트체크 PASS, 품질검사 PASS, 출처 1개 이상, 모든 이미지 라이선스 확인·공개 URL·Alt 존재, 영상 라이선스 확인.
하나라도 어긋나면 `publish()`는 Blogger를 호출하지 않는다.

## 6. 알려진 제약

- Blogger API는 이미지·영상 업로드 기능이 없다 → 미디어는 별도 호스팅 후 URL 삽입
- 검색 설명(메타 디스크립션)을 API로 지정할 수 있는지는 실제 연결 후 확인 필요 (추가필요)
- OAuth 동의 화면이 "테스트" 상태면 Refresh Token 7일 만료 → "프로덕션" 전환 필요

## 7. 텍스트 파이프라인 (Phase 2)

```text
TopicCandidate[] ─ topic-scorer(정성 점수, 데이터 없으면 '확인 불가')
        ↓
ArticleDraft(JSON) ← Claude가 리서치·팩트체크 후 작성 (src/types/draft.ts)
        ↓
fact-checker   본문의 금액·비율·날짜 → Claim 대조, 계산식 재계산, 충돌→REVIEW_REQUIRED, 3순위 출처 단독 근거 금지
duplicate      제목·주제 유사도, 14일 내 같은 키워드
html-builder   본문 H2부터(제목 H1은 테마), 출처 각주, 기준일, 고지문
quality        분량·금지표현·정치중립·SEO·모바일·HTML 안전성·미디어
        ↓
decision: PUBLISHABLE | TEXT_READY | REVIEW_REQUIRED | BLOCKED
```

- 본문 H1 미사용: Blogger 테마가 게시물 제목을 H1으로 출력하므로 본문 H1은 중복이 된다. 요청서의 `<h1>`은 게시물 제목으로 충족.
- 글자 수는 공백 제외 기준(최소 1,500자, 권장 2,000~3,000자).

## 8. 미디어 파이프라인 (Phase 3)

```text
draft.media (ImageSpec[], VideoSpec)  ← 문장 속 숫자도 팩트체크 대상
   ├─ infographic.ts   SVG 직접 제작 (cover·stats·table·checklist·timeline·flow, 1200×675 → 1600×900 JPG)
   ├─ image-processor  리사이즈·mozjpeg 최적화(≤300KB)·SEO 파일명
   ├─ pexels-provider  (선택) 공식 API + 라이선스 확인된 것만, 네트워크 열린 환경에서만
   ├─ video-generator  장면 PNG → ffmpeg xfade → 1080×1920 H.264 MP4, ffprobe로 형식·길이 검증
   └─ media-host       LocalPreviewHost(미리보기) | GitHubCdnHost(공개 저장소 + jsDelivr 커밋 고정 URL)
        ↓
media/manifest.json   출처·라이선스·작성일·Alt·크기·용량 기록
```

- 기본은 직접 제작: 외부 소재가 없어 저작권 위험이 없고, 숫자가 검증값과 일치한다.
- 클라우드 작업 공간에서는 스톡 이미지 API가 차단되어 있어(BLOCKED) 인포그래픽만 사용한다.
- 영상은 무음. 음원·외부 영상 미사용.
