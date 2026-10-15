/**
 * 관리자 방문자 통계(OF2-C · 0027 admin_site_stats) — 순수 부분: 결과 모양 검사 · 카드 숫자 · 그래프 배치.
 *
 * 클라이언트 컴포넌트(components/admin/SiteStatsChart.tsx)도 import 하므로 서버 전용 모듈(next/headers 등)을 쓰지 않는다.
 * DB 를 부르는 쪽은 서버 전용 ./siteStatsQuery.ts 다.
 *
 * 숫자는 DB 가 준 그대로다 — 이 파일은 더하거나 추정하지 않는다(배치용 나눗셈뿐). 누적은 0027 을 적용한 날부터 센 값이다.
 */

export const SITE_STATS_RPC = "admin_site_stats";
/** 그래프가 보여 주는 기간(일). */
export const SITE_STATS_DAYS = 30;

export interface SiteStatsDay {
  /** KST 날짜 `YYYY-MM-DD`. */
  day: string;
  views: number;
  visitors: number;
}

export interface SiteStats {
  /** DB 가 센 KST 오늘 날짜. */
  today: string;
  /** 오래된 날 → 오늘, 빈 날은 0. */
  days: SiteStatsDay[];
  total_views: number;
  total_visitors: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** DB 결과가 계약과 어긋나면 던진다 — 그래프가 거짓 숫자를 그리지 않게. */
export function assertSiteStatsShape(data: unknown): SiteStats {
  const d = data as Partial<SiteStats> | null;
  if (d === null || typeof d !== "object") throw new Error("siteStats: 결과가 객체가 아니다");
  if (typeof d.today !== "string" || !DATE.test(d.today)) throw new Error("siteStats: today 가 날짜가 아니다");
  if (!isCount(d.total_views) || !isCount(d.total_visitors)) throw new Error("siteStats: 누적 숫자가 올바르지 않다");
  if (!Array.isArray(d.days) || d.days.length < 1 || d.days.length > 90) throw new Error("siteStats: days 가 1~90 개 배열이 아니다");
  for (const row of d.days as unknown[]) {
    const r = row as Partial<SiteStatsDay> | null;
    if (r === null || typeof r !== "object" || typeof r.day !== "string" || !DATE.test(r.day) || !isCount(r.views) || !isCount(r.visitors)) {
      throw new Error("siteStats: days 의 행이 {day, views, visitors} 모양이 아니다");
    }
  }
  return data as SiteStats;
}

export interface SiteStatsSummary {
  views: { today: number; yesterday: number; total: number };
  visitors: { today: number; yesterday: number; total: number };
}

/** 카드 여섯 장의 숫자 — 오늘·어제는 days 의 끝 두 칸, 누적은 DB 의 합. 하루치뿐이면 어제는 0. */
export function summarizeSiteStats(stats: SiteStats): SiteStatsSummary {
  const t = stats.days[stats.days.length - 1];
  const y = stats.days.length >= 2 ? stats.days[stats.days.length - 2] : undefined;
  return {
    views: { today: t.views, yesterday: y?.views ?? 0, total: stats.total_views },
    visitors: { today: t.visitors, yesterday: y?.visitors ?? 0, total: stats.total_visitors },
  };
}

export interface ChartBox {
  width: number;
  height: number;
}
export interface ChartPoint {
  day: string;
  views: number;
  visitors: number;
  x: number;
  viewsY: number;
  visitorsY: number;
}
export interface ChartLayout {
  points: ChartPoint[];
  /** `x,y x,y …` — <polyline points>. */
  views: string;
  visitors: string;
  ticks: { value: number; y: number }[];
  max: number;
  plot: { left: number; right: number; top: number; bottom: number };
}

const PAD = { left: 44, right: 14, top: 14, bottom: 30 };

/** 세로 눈금 — 4칸으로 나누어 떨어지는 가장 작은 {1,2,5}×10^k 걸음. 전부 0 이어도 4(걸음 1)다. */
function niceStep(peak: number): number {
  const need = Math.max(peak, 1) / 4;
  let pow = 1;
  while (pow * 10 <= need) pow *= 10;
  for (const m of [1, 2, 5, 10]) if (pow * m >= need) return pow * m;
  return pow * 10;
}

/**
 * 두 선이 **같은 눈금**을 쓴다(방문자 ≤ 조회수라 한 눈금이면 두 선이 겹쳐도 크기를 비교할 수 있다). 값이 클수록 y 가 작다(위).
 * 점이 하나뿐이면 가운데에 둔다. 전부 0 이어도 나눗셈이 터지지 않는다.
 */
export function chartLayout(days: readonly SiteStatsDay[], box: ChartBox): ChartLayout {
  const left = PAD.left;
  const right = Math.max(left + 1, box.width - PAD.right);
  const top = PAD.top;
  const bottom = Math.max(top + 1, box.height - PAD.bottom);
  const step = niceStep(days.reduce((m, d) => Math.max(m, d.views), 0));
  const max = step * 4;
  const yOf = (v: number): number => bottom - (v / max) * (bottom - top);
  const n = days.length;
  const xOf = (i: number): number => (n <= 1 ? (left + right) / 2 : left + (i * (right - left)) / (n - 1));
  const points = days.map((d, i) => ({ day: d.day, views: d.views, visitors: d.visitors, x: xOf(i), viewsY: yOf(d.views), visitorsY: yOf(d.visitors) }));
  const fmt = (n2: number) => Math.round(n2 * 100) / 100;
  return {
    points,
    views: points.map((p) => `${fmt(p.x)},${fmt(p.viewsY)}`).join(" "),
    visitors: points.map((p) => `${fmt(p.x)},${fmt(p.visitorsY)}`).join(" "),
    ticks: [0, 1, 2, 3, 4].map((k) => ({ value: k * step, y: yOf(k * step) })),
    max,
    plot: { left, right, top, bottom },
  };
}

/** 날짜 축 글자 `M/D`(앞의 0 없이). 문구가 아니라 숫자 표기다. */
export function axisDate(day: string): string {
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
}

/** 가장 가까운 날의 번호 — 포인터의 x(그래프 좌표)에서. 범위 밖은 양 끝으로 붙인다. */
export function nearestIndex(layout: ChartLayout, x: number): number {
  const pts = layout.points;
  if (pts.length <= 1) return 0;
  const span = layout.plot.right - layout.plot.left;
  const i = Math.round(((x - layout.plot.left) / span) * (pts.length - 1));
  return Math.min(pts.length - 1, Math.max(0, i));
}
