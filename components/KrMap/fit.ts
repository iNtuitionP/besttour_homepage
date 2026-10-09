/**
 * P2-9 — 대표 노선 카드 수 측정 · 지도 말풍선 배치 (순수 함수, DOM 없음).
 *
 * RouteExplorer(클라이언트)가 ResizeObserver 로 잰 숫자를 여기에 넣는다. 테스트는 tests/krmap-interactive.test.ts §1·§2.
 * 이 파일은 픽셀 높이만 다룬다 — 노선 금액과 무관하다.
 */

/**
 * JS 전(SSR·하이드레이션 전) 기본 카드 수.
 * 근거: 1280px 에서 지도 프레임(≈ 550px)에서 안내·토글·CTA 를 뺀 높이에 카드(≈ 58px + 간격 10px)가 6장 안팎 들어간다(보고서 §2).
 * 측정 뒤 폭에 따라 늘거나 준다.
 */
export const DEFAULT_VISIBLE_CARDS = 6;

export interface FitInput {
  /** 카드 높이(px), 목록 순서대로. */
  heights: readonly number[];
  /** 카드 사이 간격(px) — 목록의 row-gap. */
  gap: number;
  /** 카드가 쓸 수 있는 높이(px) — 지도 프레임 높이에서 목록 아래 줄(안내·토글·CTA)을 뺀 값. */
  budget: number;
  /** 카드가 있을 때 최소로 보일 장수(기본 1). 기준 높이가 첫 카드보다 작아도 빈 목록은 만들지 않는다. */
  min?: number;
}

const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** 앞에서부터 누적해 기준 높이를 넘지 않는 카드 수. 잘린 카드는 세지 않는다(건너뛰기 없음 — 순서 유지). */
export function fitCardCount({ heights, gap, budget, min = 1 }: FitInput): number {
  const g = safe(gap);
  const limit = safe(budget);
  let used = 0;
  let count = 0;
  for (const h of heights) {
    const next = used + (count > 0 ? g : 0) + safe(h);
    if (next > limit) break;
    used = next;
    count++;
  }
  return Math.min(heights.length, Math.max(count, min));
}

export type TipAlign = "start" | "center" | "end";
export type TipSide = "above" | "below";

/**
 * 말풍선 배치 — 기준점(스테이지 백분율)이 가장자리에 가까우면 안쪽으로 펼친다.
 * 좌 30% 미만: 오른쪽으로(start) · 우 70% 초과: 왼쪽으로(end) · 위 30% 미만: 아래로(below).
 */
export function tipPlacement({ xPct, yPct }: { xPct: number; yPct: number }): { align: TipAlign; side: TipSide } {
  const align: TipAlign = xPct < 30 ? "start" : xPct > 70 ? "end" : "center";
  const side: TipSide = yPct < 30 ? "below" : "above";
  return { align, side };
}
