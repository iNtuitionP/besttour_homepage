"use client";

/**
 * 관리자 방문자 통계 — 최근 30일 선 그래프 (OF2-C). 조회수·방문자 두 선, 인라인 SVG(새 패키지 없음), 날짜 축, 값 읽기.
 *
 * · 두 선은 **같은 눈금**을 쓴다(lib/admin/siteStats.ts chartLayout). 색은 역할 토큰(CSS 모듈)이고, 색만으로 가르지 않는다 —
 *   조회수 = 원 점 · 방문자 = 네모 점, 범례도 같은 모양이다.
 * · 값 읽기: 마우스를 올리거나(onPointerEnter/Move) 화면을 누르거나(onPointerDown — 손가락으로 훑어도 따라간다) 키보드(←→ Home End)로 날짜를 고르면
 *   그 날짜의 "날짜 · 조회수 · 방문자" 말풍선이 뜬다. 날짜마다 <title> 도 있어 기본 툴팁·보조기기도 같은 문장을 읽는다.
 * · 폭은 상자 실측(ResizeObserver)이다 — viewBox 를 줄여 그리면 375px 에서 글자가 절반으로 줄어 읽을 수 없다. 서버 렌더는 640 으로 그린다.
 * · 모든 문구는 props(labels — messages/ko.json admin.stats.siteStats)로 받는다. 이 파일에는 한글 리터럴이 없다.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import a from "@/components/admin/admin.module.css";
import { axisDate, chartLayout, nearestIndex, type SiteStatsDay } from "@/lib/admin/siteStats";

export interface SiteStatsChartLabels {
  chartLabel: string;
  views: string;
  visitors: string;
  /** 날짜 틀 — `{m}`·`{d}`. */
  date: string;
  /** 말풍선 틀 — `{date}`·`{views}`·`{visitors}`. */
  tip: string;
}

const HEIGHT = 220;
const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 280;

const fill = (tpl: string, vars: Record<string, string | number>): string => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
const num = (n: number): string => n.toLocaleString("ko-KR");

export function SiteStatsChart({ days, labels }: { days: readonly SiteStatsDay[]; labels: SiteStatsChartLabels }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(MIN_WIDTH, Math.round(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = chartLayout(days, { width, height: HEIGHT });
  const { plot, points } = layout;
  const last = points.length - 1;
  const dateText = (day: string): string => fill(labels.date, { m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) });
  const tipText = (i: number): string => fill(labels.tip, { date: dateText(points[i].day), views: num(points[i].views), visitors: num(points[i].visitors) });

  // 날짜 축 — 처음·끝과 그 사이를 고르게(끝 글자와 44px 안으로 붙는 칸은 건너뛴다 — 375px 에서 "10/10 10/15" 가 맞닿았다)
  const stride = Math.max(1, Math.ceil(last / 5));
  const axisIdx = [...points.keys()].filter((i) => i === last || (i % stride === 0 && points[last].x - points[i].x >= 44));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    setActive(nearestIndex(layout, ((e.clientX - r.left) / r.width) * width));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const cur = active ?? last;
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (e.key === "Escape") setActive(null);
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  };

  const tipLeft = active === null ? 0 : Math.min(Math.max(points[active].x, 92), Math.max(92, width - 92));

  return (
    <div ref={wrapRef} className={a.siteChart} data-testid="site-stats-chart">
      <svg
        className={a.siteChartSvg}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={labels.chartLabel}
        tabIndex={0}
        onPointerEnter={pick}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        onFocus={() => setActive((cur) => cur ?? last)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        {layout.ticks.map((t) => (
          <g key={t.value}>
            <line className={a.siteGrid} x1={plot.left} x2={plot.right} y1={t.y} y2={t.y} />
            <text className={a.siteAxisText} x={plot.left - 8} y={t.y + 4} textAnchor="end">
              {num(t.value)}
            </text>
          </g>
        ))}
        {axisIdx.map((i) => (
          <text key={points[i].day} className={a.siteAxisText} x={points[i].x} y={HEIGHT - 8} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}>
            {axisDate(points[i].day)}
          </text>
        ))}
        {active !== null ? <line className={a.siteGuide} x1={points[active].x} x2={points[active].x} y1={plot.top} y2={plot.bottom} /> : null}
        <polyline className={a.siteLineViews} points={layout.views} fill="none" />
        <polyline className={a.siteLineVisitors} points={layout.visitors} fill="none" />
        {points.map((p, i) => (
          <g key={p.day} data-day={p.day} data-active={i === active ? "true" : undefined}>
            <title>{tipText(i)}</title>
            <rect className={a.siteDotVisitors} x={p.x - (i === active ? 4.5 : 2.5)} y={p.visitorsY - (i === active ? 4.5 : 2.5)} width={i === active ? 9 : 5} height={i === active ? 9 : 5} />
            <circle className={a.siteDotViews} cx={p.x} cy={p.viewsY} r={i === active ? 5 : 3} />
          </g>
        ))}
      </svg>
      {active !== null ? (
        <div className={a.siteTip} style={{ left: tipLeft }} role="status" data-testid="site-stats-tip">
          {tipText(active)}
        </div>
      ) : null}
      <ul className={a.legend}>
        <li className={a.legendItem}>
          <span className={a.siteSwatchViews} aria-hidden="true" />
          {labels.views}
        </li>
        <li className={a.legendItem}>
          <span className={a.siteSwatchVisitors} aria-hidden="true" />
          {labels.visitors}
        </li>
      </ul>
    </div>
  );
}
