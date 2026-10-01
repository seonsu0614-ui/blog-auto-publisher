import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkDuplicate, similarity } from '../src/content/duplicate-checker.ts';
import { buildHtml, visibleText } from '../src/content/html-builder.ts';
import { runTextPipeline } from '../src/content/pipeline.ts';
import { runQualityCheck } from '../src/content/quality-checker.ts';
import { evaluateFormula, extractNumbers, parseKoreanNumber, runFactCheck } from '../src/research/fact-checker.ts';
import { scoreTopic, selectTopic } from '../src/topic/topic-scorer.ts';
import type { ArticleDraft, TopicCandidate } from '../src/types/draft.ts';

const para = (n: number) =>
  `${n}번째 사례에서 대출 이자는 원금과 금리, 기간을 곱해 계산하며 상환 방식에 따라 실제 부담이 달라질 수 있습니다. 문단 ${n}에서는 확인 순서를 정리합니다.`;

function draft(over: Partial<ArticleDraft> = {}): ArticleDraft {
  return {
    contentId: '20261002-001',
    date: '2026-10-02',
    topic: '대출 이자 계산법',
    category: '생활경제',
    searchIntent: '대출 이자 계산 방법을 알고 싶음',
    title: '대출 이자 계산법, 원금 1억이면 1년 이자는 얼마일까',
    seoTitle: '대출 이자 계산법 정리',
    metaDescription: '대출 이자 계산법을 원금·연이율·기간 공식으로 정리했습니다. 원금 1억 원, 연 4% 기준 예시와 확인할 조건을 함께 담았습니다.',
    primaryKeyword: '대출 이자 계산',
    secondaryKeywords: ['이자 계산 공식'],
    relatedKeywords: [],
    hook: ['같은 대출이라도 이자 부담은 계산 방식에 따라 달라집니다.', '먼저 공식을 알면 비교가 쉬워집니다.'],
    summary: ['대출 이자 계산의 기본은 원금 × 연이율 × 기간입니다.', '원금 1억 원, 연 4%면 1년 이자는 400만 원입니다.{C1}'],
    sections: [
      { heading: '대출 이자 계산 공식', level: 2, blocks: Array.from({ length: 8 }, (_, i) => ({ type: 'p' as const, text: para(i) })) },
      {
        heading: '숫자로 보면',
        level: 2,
        blocks: [
          { type: 'table', headers: ['원금', '연이율', '1년 이자'], rows: [['1억 원', '4%', '4,000,000원{C1}']] },
          ...Array.from({ length: 8 }, (_, i) => ({ type: 'p' as const, text: para(i + 10) })),
        ],
      },
      { heading: '대출 이자 계산 시 주의할 점', level: 2, blocks: Array.from({ length: 8 }, (_, i) => ({ type: 'p' as const, text: para(i + 20) })) },
    ],
    faq: [
      { question: '대출 이자 계산은 매달 같나요?', answer: '상환 방식에 따라 달라집니다.[S1]' },
      { question: '금리는 어디서 확인하나요?', answer: '금융회사 공시와 비교 공시에서 확인할 수 있습니다.[S2]' },
    ],
    closing: ['공식을 먼저 확인하세요.', '조건은 기관 공지로 다시 확인하세요.'],
    sources: [
      { id: 'S1', title: '금리 공시', url: 'https://www.fss.or.kr/a?x=1&y=2', publisher: '금융감독원', tier: 1, accessedAt: '2026-10-02', referenceDate: '2026-10-01' },
      { id: 'S2', title: '대출 기사', url: 'https://news.example.com/b', publisher: '연합뉴스', tier: 2, accessedAt: '2026-10-02' },
    ],
    claims: [
      { id: 'C1', claim: '원금 1억 원, 연 4%, 1년 단리 이자', value: '4,000,000원', formula: '100,000,000 * 0.04 * 1', referenceDate: '2026-10-02', sourceIds: ['S1'], verified: true, conflict: false },
      { id: 'C2', claim: '예시 금리 4%와 원금 1억 원은 계산 예시용 가정값', value: '1억 원 4%', referenceDate: '2026-10-02', sourceIds: ['S1'], verified: true, conflict: false },
    ],
    tags: ['대출', '이자', '금리'],
    ...over,
  };
}

describe('계산·숫자 파서', () => {
  it('계산식을 안전하게 계산한다', () => {
    assert.equal(evaluateFormula('100,000,000 × 0.04 × 1'), 4_000_000);
    assert.equal(evaluateFormula('(1+2)*3-4/2'), 7);
    assert.throws(() => evaluateFormula('process.exit()'));
  });
  it('한국어 금액 표기를 숫자로 바꾼다', () => {
    assert.equal(parseKoreanNumber('400만 원'), 4_000_000);
    assert.equal(parseKoreanNumber('1억 2,000만 원'), 120_000_000);
    assert.equal(parseKoreanNumber('3.25%'), 3.25);
  });
  it('금액·비율·날짜를 본문에서 찾아낸다', () => {
    assert.deepEqual(extractNumbers('기준금리 2.50%, 지원금 30만 원, 10월 15일부터'), ['2.50%', '30만 원', '10월 15일']);
  });
});

describe('팩트체크', () => {
  it('근거가 모두 연결되면 PASS', () => {
    const r = runFactCheck(draft());
    assert.equal(r.status, 'PASS', JSON.stringify(r.issues));
  });
  it('계산이 틀리면 FAIL', () => {
    const d = draft();
    d.claims[0]!.value = '5,000,000원';
    d.summary[1] = '원금 1억 원, 연 4%면 1년 이자는 500만 원입니다.{C1}';
    d.sections[1]!.blocks[0] = { type: 'table', headers: ['a'], rows: [['5,000,000원{C1}']] };
    const r = runFactCheck(d);
    assert.equal(r.status, 'FAIL');
    assert.ok(r.issues.some((i) => i.code === 'FORMULA_MISMATCH'));
  });
  it('근거 없는 숫자가 있으면 FAIL', () => {
    const r = runFactCheck(draft({ closing: ['지원금은 최대 300만 원입니다.'] }));
    assert.ok(r.issues.some((i) => i.code === 'UNSUPPORTED_NUMBER'));
    assert.equal(r.status, 'FAIL');
  });
  it('출처 충돌은 REVIEW_REQUIRED', () => {
    const d = draft();
    d.claims[1] = { ...d.claims[1]!, conflict: true, conflictDetail: 'A기관 4%, B기관 4.2%' };
    assert.equal(runFactCheck(d).status, 'REVIEW_REQUIRED');
  });
  it('숫자 주장에 기준일이 없으면 FAIL', () => {
    const d = draft();
    delete d.claims[1]!.referenceDate;
    assert.ok(runFactCheck(d).issues.some((i) => i.code === 'NO_REFERENCE_DATE'));
  });
  it('공식기관 출처가 없으면 REVIEW_REQUIRED', () => {
    const d = draft();
    d.sources[0]!.tier = 2;
    assert.equal(runFactCheck(d).status, 'REVIEW_REQUIRED');
  });
  it('3순위(블로그) 출처만으로 뒷받침된 주장은 FAIL', () => {
    const d = draft();
    d.sources.push({ id: 'S3', title: '개인 블로그', url: 'https://blog.example.com', publisher: 'blog', tier: 3, accessedAt: '2026-10-02' });
    d.claims[1]!.sourceIds = ['S3'];
    assert.ok(runFactCheck(d).issues.some((i) => i.code === 'WEAK_SOURCE_ONLY'));
  });
});

describe('HTML 변환', () => {
  it('본문에 H1이 없고 출처 각주·기준일·고지문이 들어간다', () => {
    const html = buildHtml(draft());
    assert.ok(!/<h1/.test(html));
    assert.match(html, /<sup><a href="#src-1">\[1\]<\/a><\/sup>/);
    assert.match(html, /id="src-1"/);
    assert.match(html, /기준일 2026-10-01/);
    assert.match(html, /금융·세무·법률 자문이 아닙니다/);
    assert.ok(!html.includes('{C1}'));
  });
  it('HTML 특수문자를 이스케이프한다', () => {
    const html = buildHtml(draft({ hook: ['<script>alert(1)</script> 테스트 문장입니다.', '두 번째 문장입니다.'] }));
    assert.ok(!html.includes('<script>'));
  });
});

describe('품질검사', () => {
  it('정상 원고는 텍스트 단계 통과 (미디어는 PENDING)', () => {
    const r = runTextPipeline(draft(), { stage: 'text' });
    assert.equal(r.decision, 'TEXT_READY', JSON.stringify(r.reasons));
    assert.ok(r.quality.stats.charsNoSpace >= 1500);
  });
  it('금지 표현이 있으면 FAIL', () => {
    const r = runTextPipeline(draft({ hook: ['이걸 모르면 큰일납니다!!!', '무조건 확인하세요.'] }), { stage: 'text' });
    assert.equal(r.decision, 'BLOCKED');
    assert.ok(r.quality.items.find((i) => i.id === 'banned' && !i.passed));
  });
  it('분량이 부족하면 FAIL', () => {
    const d = draft();
    d.sections = d.sections.map((s) => ({ ...s, blocks: s.blocks.slice(0, 1) }));
    const r = runTextPipeline(d, { stage: 'text' });
    assert.ok(r.quality.items.find((i) => i.id === 'length' && !i.passed));
  });
  it('정치 글의 지지 유도 표현을 막는다', () => {
    const d = draft({ category: '정치', closing: ['이 후보를 지지해 주세요.', '정리합니다.'] });
    const html = buildHtml(d);
    const q = runQualityCheck({ draft: d, html, factStatus: 'PASS', duplicate: { isDuplicate: false }, stage: 'text' });
    assert.ok(q.items.find((i) => i.id === 'politics' && !i.passed));
  });
  it('full 단계에서는 이미지 5개 미만이면 FAIL', () => {
    const r = runTextPipeline(draft(), { stage: 'full' });
    assert.equal(r.decision, 'BLOCKED');
    assert.ok(r.quality.items.find((i) => i.id === 'images' && !i.passed));
  });
  it('visibleText는 태그와 주석을 제거한다', () => {
    assert.equal(visibleText('<p>가<!-- x -->나</p><b>다</b>'), '가 나 다');
  });
});

describe('중복 검사', () => {
  const hist = [{ date: '2026-09-28', title: '대출 이자 계산법, 원금 1억이면 1년 이자는 얼마?', topic: '대출 이자 계산법', primaryKeyword: '대출 이자 계산', url: 'https://x/1' }];
  it('제목만 바꾼 글은 중복', () => {
    const r = checkDuplicate(draft(), hist);
    assert.ok(r.isDuplicate);
  });
  it('관련 없는 글은 중복 아님', () => {
    const r = checkDuplicate(draft(), [{ date: '2026-09-01', title: '전기요금 누진제 구간 정리', topic: '전기요금', primaryKeyword: '전기요금 누진제', url: 'https://x/2' }]);
    assert.equal(r.isDuplicate, false);
  });
  it('유사도 계산', () => {
    assert.ok(similarity('전세대출 금리 비교', '전세대출 금리 비교 방법') > 0.6);
  });
});

describe('주제 점수', () => {
  const base: TopicCandidate = {
    topic: 't',
    category: '생활경제',
    primaryKeyword: 'k',
    angle: 'a',
    whyNow: 'w',
    factors: { searchDemand: 'unknown', adValue: 'high', freshness: 'high', depth: 'medium', differentiation: 'medium', intentClarity: 'high', competition: 'medium', factCheckDifficulty: 'low', contentRisk: 'low' },
  };
  it('데이터 없는 요소는 확인 불가로 표시하고 점수에 넣지 않는다', () => {
    const s = scoreTopic(base);
    assert.deepEqual(s.unknownFactors, ['검색 수요']);
    assert.equal(s.score, 3 + 3 + 2 + 2 + 3 - 2 - 1 - 1);
  });
  it('리스크 높은 주제와 최근 키워드는 제외', () => {
    const risky = { ...base, primaryKeyword: 'r', factors: { ...base.factors, contentRisk: 'high' as const, adValue: 'high' as const } };
    const recent = { ...base, primaryKeyword: 'recent' };
    const { selected } = selectTopic([risky, recent, base], ['recent']);
    assert.equal(selected?.candidate.primaryKeyword, 'k');
  });
});
