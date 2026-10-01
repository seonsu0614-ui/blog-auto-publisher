import type { CheckStatus } from '../types/content.ts';
import type { ArticleDraft, Block, Claim } from '../types/draft.ts';

/**
 * 팩트체크 엔진 (결정적 검사).
 * 실제 사실 확인(웹 리서치, 출처 대조)은 Claude가 수행해 Claim에 기록하고,
 * 이 모듈은 "기록된 근거가 규칙을 만족하는지"를 기계적으로 검사한다.
 *  - 본문의 금액·비율·날짜는 모두 검증된 주장(Claim)과 연결되어야 한다
 *  - 계산 주장은 직접 다시 계산해 값이 맞는지 확인한다
 *  - 출처 충돌이 하나라도 있으면 REVIEW_REQUIRED (자동 발행 금지)
 */

export interface FactIssue {
  level: 'FAIL' | 'REVIEW';
  code: string;
  message: string;
}

export interface FactCheckReport {
  status: CheckStatus;
  issues: FactIssue[];
  checkedNumbers: number;
}

// ── 안전한 사칙연산 계산기 (eval 사용 안 함) ──
export function evaluateFormula(expr: string): number {
  const src = expr.replace(/,/g, '').replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  if (!/^[\d.+\-*/()]+$/.test(src)) throw new Error(`허용되지 않은 문자가 포함된 계산식: ${expr}`);
  let i = 0;
  const peek = () => src[i];
  const num = (): number => {
    if (peek() === '(') {
      i++;
      const v = add();
      if (src[i++] !== ')') throw new Error('괄호 불일치');
      return v;
    }
    if (peek() === '-') {
      i++;
      return -num();
    }
    const m = src.slice(i).match(/^\d+(\.\d+)?/);
    if (!m) throw new Error(`숫자 위치 오류: ${expr}`);
    i += m[0].length;
    return Number(m[0]);
  };
  const mul = (): number => {
    let v = num();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = num();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = mul();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = add();
  if (i !== src.length) throw new Error(`계산식 해석 실패: ${expr}`);
  return v;
}

/** "4,000,000원", "400만 원", "1.5억 원", "3.25%" → 숫자 */
export function parseKoreanNumber(value: string): number | undefined {
  const s = value.replace(/,/g, '').replace(/\s+/g, '');
  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)(조|억|만|천)?/g;
  let m: RegExpExecArray | null;
  // "1억 2,000만 원"처럼 단위가 섞인 경우 합산
  while ((m = re.exec(s))) {
    matched = true;
    const n = Number(m[1]);
    const unit = { 조: 1e12, 억: 1e8, 만: 1e4, 천: 1e3 }[m[2] ?? ''] ?? 1;
    total += n * unit;
    if (!m[2]) break; // 단위 없는 숫자에서 종료
  }
  return matched ? total : undefined;
}

const NUMBER_PATTERNS: RegExp[] = [
  /\d[\d,]*(?:\.\d+)?\s*(?:%p|%|퍼센트|bp)/g, // 비율
  /\d[\d,]*(?:\.\d+)?\s*(?:조|억|만|천)?\s*(?:조\s*)?(?:억\s*)?(?:만\s*)?원/g, // 금액
  /\d{1,2}\s*월\s*\d{1,2}\s*일/g, // 날짜
  /\d[\d,]*(?:\.\d+)?\s*배/g, // 배수
];

/** 숫자 비교용 정규화: 공백·쉼표 제거 */
const norm = (s: string) => s.replace(/[\s,]/g, '');

function blockTexts(b: Block): string[] {
  switch (b.type) {
    case 'p':
    case 'callout':
      return [b.text];
    case 'ul':
    case 'ol':
      return b.items;
    case 'table':
      return [b.caption ?? '', ...b.headers, ...b.rows.flat(), b.note ?? ''];
    default:
      return [];
  }
}

/** 원고의 모든 문장 단위 텍스트 (표 셀 포함) */
export function draftSentences(d: ArticleDraft): string[] {
  return [
    d.title,
    d.metaDescription,
    ...d.hook,
    ...d.summary,
    ...d.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap(blockTexts)]),
    ...d.faq.flatMap((f) => [f.question, f.answer]),
    ...d.closing,
  ].filter(Boolean);
}

export function extractNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const re of NUMBER_PATTERNS) for (const m of text.matchAll(re)) found.add(m[0].trim());
  return [...found];
}

function claimCovers(c: Claim, token: string): boolean {
  if (!c.verified) return false;
  const t = norm(token);
  if (c.value && norm(c.value).includes(t)) return true;
  if (c.claim && norm(c.claim).includes(t)) return true;
  // 같은 금액의 다른 표기 (예: 4,000,000원 ↔ 400만 원)
  const tv = parseKoreanNumber(token);
  const cv = c.value ? parseKoreanNumber(c.value) : undefined;
  return tv !== undefined && cv !== undefined && /원/.test(token) && Math.abs(tv - cv) < 1;
}

export function runFactCheck(d: ArticleDraft): FactCheckReport {
  const issues: FactIssue[] = [];
  const sourceIds = new Set(d.sources.map((s) => s.id));
  const claimById = new Map(d.claims.map((c) => [c.id, c]));

  for (const c of d.claims) {
    if (c.conflict) {
      issues.push({ level: 'REVIEW', code: 'CONFLICT', message: `${c.id} 출처 간 충돌: ${c.conflictDetail ?? c.claim}` });
    }
    if (!c.verified) {
      issues.push({ level: 'FAIL', code: 'UNVERIFIED', message: `${c.id} 검증되지 않은 주장: ${c.claim}` });
    }
    if (c.sourceIds.length === 0) {
      issues.push({ level: 'FAIL', code: 'NO_SOURCE', message: `${c.id} 출처 없음` });
    }
    for (const sid of c.sourceIds) {
      if (!sourceIds.has(sid)) issues.push({ level: 'FAIL', code: 'BAD_SOURCE_REF', message: `${c.id}가 존재하지 않는 출처 ${sid}를 가리킴` });
    }
    const tiers = c.sourceIds.map((sid) => d.sources.find((s) => s.id === sid)?.tier).filter((t): t is 1 | 2 | 3 => t !== undefined);
    if (tiers.length && tiers.every((t) => t === 3)) {
      issues.push({ level: 'FAIL', code: 'WEAK_SOURCE_ONLY', message: `${c.id} 블로그·커뮤니티 등 3순위 출처만으로 뒷받침됨` });
    }
    if (c.value && /\d/.test(c.value) && !c.referenceDate) {
      issues.push({ level: 'FAIL', code: 'NO_REFERENCE_DATE', message: `${c.id} 숫자 주장에 기준일 없음 (${c.value})` });
    }
    if (c.formula) {
      try {
        const calc = evaluateFormula(c.formula);
        const stated = c.value ? parseKoreanNumber(c.value) : undefined;
        if (stated === undefined) {
          issues.push({ level: 'FAIL', code: 'FORMULA_NO_VALUE', message: `${c.id} 계산식은 있으나 결과값(value)이 없음` });
        } else if (Math.abs(calc - stated) > Math.max(1, Math.abs(calc) * 0.005)) {
          issues.push({ level: 'FAIL', code: 'FORMULA_MISMATCH', message: `${c.id} 계산 불일치: ${c.formula} = ${calc.toLocaleString('ko-KR')} ≠ ${c.value}` });
        }
      } catch (e) {
        issues.push({ level: 'FAIL', code: 'FORMULA_ERROR', message: `${c.id} ${(e as Error).message}` });
      }
    }
  }

  // 본문 숫자 → 근거 연결 확인
  let checked = 0;
  for (const sentence of draftSentences(d)) {
    const refs = [...sentence.matchAll(/\{(C\d+)\}/g)].map((m) => m[1]!);
    for (const r of refs) {
      if (!claimById.has(r)) issues.push({ level: 'FAIL', code: 'BAD_CLAIM_REF', message: `존재하지 않는 근거 ${r}: "${sentence.slice(0, 40)}…"` });
    }
    for (const token of extractNumbers(sentence.replace(/\{C\d+\}|\[S\d+\]/g, ''))) {
      checked++;
      const markedOk = refs.some((r) => claimById.get(r)?.verified);
      const anyOk = d.claims.some((c) => claimCovers(c, token));
      if (!markedOk && !anyOk) {
        issues.push({ level: 'FAIL', code: 'UNSUPPORTED_NUMBER', message: `근거 없는 숫자 "${token}": "${sentence.slice(0, 50)}…"` });
      }
    }
  }

  // 모든 카테고리: 공식기관(1순위) 출처가 최소 1개 필요
  if (!d.sources.some((s) => s.tier === 1)) {
    issues.push({ level: 'REVIEW', code: 'NO_OFFICIAL_SOURCE', message: '공식기관(1순위) 출처가 없음' });
  }
  if (d.sources.length === 0) issues.push({ level: 'FAIL', code: 'NO_SOURCES', message: '출처 목록이 비어 있음' });

  const status: CheckStatus = issues.some((i) => i.level === 'FAIL')
    ? 'FAIL'
    : issues.some((i) => i.level === 'REVIEW')
      ? 'REVIEW_REQUIRED'
      : 'PASS';
  return { status, issues, checkedNumbers: checked };
}
