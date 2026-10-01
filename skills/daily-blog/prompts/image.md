# 이미지 프롬프트

글마다 5~8개, `media.images`에 ImageSpec으로 작성 (src/types/media.ts).

| kind | 용도 | 필드 |
|---|---|---|
| cover | 표지·썸네일(본문 첫 이미지) | eyebrow, title, subtitle |
| stats | 핵심 숫자 카드 최대 3개 | title, stats[{label, value, note}] |
| table | 비교표 최대 5행 | title, headers, rows |
| checklist | 확인 사항 최대 5개 | title, items |
| timeline | 일정 최대 4개 | title, events[{date, label}] |
| flow | 단계·경로 최대 4단계 | title, steps |

- 모든 숫자에 {C번호}. 표 셀·카드 값도 팩트체크된다.
- 문장은 짧게: 카드 라벨 10자 안팎, 체크리스트 한 줄 30자 안팎. 넘치면 자동 줄바꿈되지만 2줄까지만 보인다.
- footnote에 출처 기관명이나 계산 가정을 적는다.
- Alt: 이미지가 보여주는 내용을 한 문장으로. 키워드 반복 금지.
- 직접 제작이 기본(저작권 문제 없음). 스톡 사진은 PEXELS_API_KEY가 있고 네트워크가 열린 실행 환경에서만, 라이선스 확인된 것만 사용.
