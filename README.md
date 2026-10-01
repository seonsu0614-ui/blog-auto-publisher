# blog-auto-publisher

Google Blogger 기반 자동 콘텐츠 생산·발행 시스템.
설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참고.

## 현재 상태

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | Publisher 어댑터, Google OAuth, Blogger API, 중복 방지, 발행 검증 | 코드·단위테스트 완료 / 실제 Blogger 연결 대기 |
| 2 | 리서치·팩트체크·본문·SEO·QA | 예정 |
| 3 | 이미지·라이선스 매니페스트·영상·HTML | 예정 |
| 4 | 자동 발행·검증·로그 | 예정 |
| 5 | 07:00 스케줄·Slack | 예정 |
| 6 | 성과 데이터·주제 최적화 | 예정 |

## 설치

```bash
npm install
cp .env.example .env   # 값 입력
```

## 명령

```bash
npm test                         # 단위 테스트 (가짜 Blogger 서버 사용, 네트워크 불필요)
npm run typecheck
npm run blogger:auth             # 최초 1회 OAuth 인증 (본인 PC에서, 브라우저 필요)
npm run blogger:auth -- --save   # 발급값을 .env에 자동 저장
npm run blogger:check            # 토큰 갱신 + 블로그 조회
npm run blogger:draft-test       # 공개 발행 없이 초안 1개 생성
npm run blogger:draft-test -- --cleanup   # 초안 생성 후 삭제까지
```

## 보안

- 비밀값은 `.env`(로컬) 또는 GitHub Secrets에만 둔다. `.env`는 `.gitignore` 처리됨.
- 인증 스크립트는 비밀번호를 받지 않는다. 로그인은 Google 화면에서 사용자가 직접 한다.
