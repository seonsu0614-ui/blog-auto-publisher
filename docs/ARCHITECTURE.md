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
