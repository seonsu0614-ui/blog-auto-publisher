/**
 * 미디어 사양 (원고와 함께 Claude가 작성).
 * 이미지·영상에 들어가는 문장도 본문과 똑같이 팩트체크 대상이다.
 * 숫자가 들어간 문장에는 {C번호}를 붙인다(렌더링 시 제거됨).
 */

interface BaseImageSpec {
  slot: number; // 본문 image 블록의 slot 번호와 일치
  alt: string; // 이미지가 실제로 보여주는 내용
  caption?: string;
}

export type ImageSpec =
  | (BaseImageSpec & { kind: 'cover'; eyebrow?: string; title: string; subtitle?: string })
  | (BaseImageSpec & { kind: 'stats'; title: string; stats: Array<{ label: string; value: string; note?: string }>; footnote?: string })
  | (BaseImageSpec & { kind: 'table'; title: string; headers: string[]; rows: string[][]; footnote?: string })
  | (BaseImageSpec & { kind: 'checklist'; title: string; items: string[]; footnote?: string })
  | (BaseImageSpec & { kind: 'timeline'; title: string; events: Array<{ date: string; label: string }>; footnote?: string })
  | (BaseImageSpec & { kind: 'flow'; title: string; steps: string[]; footnote?: string });

export interface VideoScene {
  kind: 'hook' | 'fact' | 'explain' | 'cta';
  heading: string;
  big?: string; // 크게 보여줄 숫자·핵심어
  body?: string;
  seconds?: number;
}

export interface VideoSpec {
  scenes: VideoScene[];
  alt: string;
}

export interface MediaSpec {
  images: ImageSpec[];
  video?: VideoSpec;
}

/** 미디어 사양 안의 모든 텍스트 (팩트체크·금지표현 검사용) */
export function mediaTexts(m: MediaSpec | undefined): string[] {
  if (!m) return [];
  const out: string[] = [];
  for (const s of m.images) {
    out.push(s.alt, s.caption ?? '');
    switch (s.kind) {
      case 'cover':
        out.push(s.eyebrow ?? '', s.title, s.subtitle ?? '');
        break;
      case 'stats':
        out.push(s.title, ...s.stats.flatMap((x) => [`${x.label} ${x.value}`, x.note ?? '']), s.footnote ?? '');
        break;
      case 'table':
        out.push(s.title, ...s.headers, ...s.rows.map((r) => r.join(' ')), s.footnote ?? '');
        break;
      case 'checklist':
        out.push(s.title, ...s.items, s.footnote ?? '');
        break;
      case 'timeline':
        out.push(s.title, ...s.events.map((e) => `${e.date} ${e.label}`), s.footnote ?? '');
        break;
      case 'flow':
        out.push(s.title, ...s.steps, s.footnote ?? '');
        break;
    }
  }
  for (const sc of m.video?.scenes ?? []) out.push(sc.heading, sc.big ?? '', sc.body ?? '');
  if (m.video) out.push(m.video.alt);
  return out.filter((t) => t.trim());
}
