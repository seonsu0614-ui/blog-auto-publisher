---
name: daily-blog
description: 생활경제 브리핑(Blogger) 매일 글 1편을 트렌드 조사→주제 선정→공식자료 리서치→팩트체크→원고(JSON)→검사까지 만드는 절차. 매일 07:00 예약 실행 또는 "오늘 글 만들어줘" 요청 시 사용.
---

# daily-blog — 매일 콘텐츠 생산 절차

블로그: 생활경제 브리핑 (https://lifeeconomy-briefing.blogspot.com/)
분야: 생활경제(최우선) · 경제 · 정책/제도 · 정치(정보 제공만)

이 절차의 결과물은 **검사를 통과한 원고 패키지**다. 발행은 Publisher(코드)가 한다.
절대 순서: Research → Fact Check → Topic 확정 → Outline → Article → SEO → QA. 글을 먼저 쓰고 사실을 맞추지 않는다.

## 0. 시작
1. `date`로 오늘 날짜(Asia/Seoul) 확인. contentId = `YYYYMMDD-001`
2. `data/history.json`(발행 이력)을 읽는다. 없으면 빈 목록.
3. 규칙 파일을 읽는다: `rules/content-rules.md`, `rules/finance-rules.md`, `rules/seo-rules.md`. 정치면 `rules/politics-rules.md` 추가.

## 1. 트렌드 조사 → 주제 후보 10개 (prompts/topic-selection.md)
- WebSearch로 최근 7일 안의 생활경제·정책 변화 조사: 시행일이 다가오는 제도, 신청 기간, 금리·요금 변경, 세금 일정.
- 후보 10개를 `TopicCandidate` 형식으로 만든다. 각 요소는 high/medium/low/unknown.
- **검색량·CPC 실측 데이터가 없으면 unknown.** "검색량 10,000" 같은 숫자를 만들지 않는다.
- 최근 14일 이력과 같은 핵심 키워드는 후보에서 뺀다(새 데이터·관점이 있으면 differentiation에 명시).
- `selectTopic` 규칙: 리스크 high 제외 → 점수 1위. 동점이면 시행일이 가까운 주제.

## 2. 리서치 (prompts/research.md)
- 출처 우선순위: 정부·공공기관·법령 > 금융위·금감원·한은·국세청·국토부·통계청·기재부 > 공식 금융기관 > 신뢰 언론. 블로그·커뮤니티는 1차 출처 금지.
- 핵심 사실은 **독립 출처 2곳 이상**으로 대조. 공식 보도자료·공고문은 WebFetch로 원문 확인.
- 모든 출처는 `DraftSource`로 기록: id, 제목, URL, 기관, tier, 확인일, 자료 기준일.

## 3. 팩트체크 (prompts/fact-check.md)
- 본문에 쓸 숫자·날짜·조건은 전부 `Claim`으로 등록: 값, 기준일, 적용조건, 출처 id, 검증 여부.
- 계산 예시는 `formula`에 계산식을 적는다(코드가 다시 계산).
- 출처끼리 값이 다르면 `conflict: true` + `conflictDetail`. → 자동 발행 금지(REVIEW_REQUIRED).
- 확인 못 한 내용은 쓰지 않는다. 꼭 언급해야 하면 "확정되지 않음/발표 예정"으로 쓰고 숫자는 넣지 않는다.

## 4. 원고 작성 (prompts/article.md, templates/article.md)
- `ArticleDraft` JSON으로 작성 → `data/articles/YYYY/MM/<contentId>/draft.json`
- 공백 제외 2,000~3,000자 목표(최소 1,500자). 문단 2~4줄, 220자 넘는 문단 금지.
- 숫자가 들어간 문장 끝에 `{C번호}`, 출처 각주가 필요한 곳에 `[S번호]`.
- 이미지 자리 `{"type":"image","slot":N}` 5~8개, 영상 자리 `{"type":"video"}` 1개를 미리 배치(Phase 3에서 채움).

## 5. SEO (prompts/seo.md, rules/seo-rules.md)
- 제목 15~60자, 핵심 키워드 포함, 낚시 금지. 메타 설명 50~160자.
- 핵심 키워드 본문 2~12회, H2 3개 이상, FAQ 2~4개, 태그 3~15개.

## 6. 검사
```bash
npm run preview -- data/articles/YYYY/MM/<contentId>/draft.json --stage=text
```
- 결과 `report.md`의 결정:
  - `TEXT_READY` / `PUBLISHABLE` → 다음 단계(미디어/발행)
  - `REVIEW_REQUIRED` → 발행 중단, 사유를 알림에 포함
  - `BLOCKED` → 사유를 고쳐 **최대 3회** 재작성·재검사. 3회 실패 시 중단하고 실패 기록.
- 검사 결과를 고치려고 근거 없는 Claim을 추가하거나 verified를 임의로 true로 바꾸지 않는다.

## 7. 기록
- 결과(결정, 제목, 키워드, 출처 수, 글자 수, 소요 시간, 오류)를 실행 로그에 남긴다.
- 발행 성공 시 `data/history.json`에 {date, title, topic, primaryKeyword, url, tags} 추가.
