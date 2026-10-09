"use client";

/**
 * P2-9 — 대표 노선 인터랙션 층 (클라이언트). 지도 프레임 + 카드 목록을 한 그리드로 묶는다.
 *
 * 사용자 지시(2026-09-27): 카드는 지도 높이만큼만, 나머지는 지도 선에 올리거나 탭하면 뜬다.
 *   1. 카드 수 — 지도 프레임 높이에서 목록 아래 줄(안내·토글·CTA)을 뺀 높이에 **완전히 들어가는** 카드만 보인다
 *      (fitCardCount). ResizeObserver 로 폭이 바뀔 때마다 다시 잰다. SSR·하이드레이션 전에는 DEFAULT_VISIBLE_CARDS(6).
 *      나머지 카드는 DOM 에 남아 visually-hidden 이다(스크린리더는 16장을 모두 읽는다). "노선 전체 보기" 토글로 모두 펼친다.
 *   2. 지도 선 — 16개 노선마다 같은 d 의 투명한 두꺼운 히트 영역(pointer-events: stroke). 마우스 hover·탭 → 말풍선,
 *      바깥 탭·Esc → 닫힘. 활성 노선은 선·양 끝 핀을 강조한다. 카드 hover 도 같은 강조를 켠다(양방향).
 *
 * 경계: 문구·금액·지명·곡선은 서버(KrMap → toRouteTips)가 만든 props 만 쓴다 — 이 파일에 문구 리터럴·가격 포맷 호출 없음.
 * 지도 SVG(MapSvg)·범례·CTA(i18n Link)는 서버가 렌더한 노드를 슬롯으로 받는다.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";

import { explorerReducer, INITIAL_EXPLORER_STATE, showsTip } from "./explorer-state";
import { DEFAULT_VISIBLE_CARDS, fitCardCount } from "./fit";
import { MAP_VIEWBOX } from "./geometry";
import type { RouteTip } from "./route-tips";
import { RouteCards } from "./RouteCards";
import { RouteTooltip } from "./RouteTooltip";
import s from "./KrMap.module.css";

export interface RouteExplorerCopy {
  listLabel: string;
  airport: string;
  empty: string;
  /** 토글 — 펼치기(전체 개수가 들어간 완성 문장). */
  showAll: string;
  /** 토글 — 접기. */
  showLess: string;
  /** 안내 줄 — moreHints[n] = 가려진 카드가 n 개일 때의 문장(서버가 ICU 로 미리 만든다). [0] 은 빈 문자열. */
  moreHints: readonly string[];
}

export interface RouteExplorerProps {
  /** 서버가 렌더한 지도 SVG(MapSvg). */
  map: ReactNode;
  /** 지도 라벨 레이어(보류 중 슬롯 — KrMap props.labels). */
  labels?: ReactNode;
  /** 골드 범례 문구 — null 이면 범례 없음. */
  legend: string | null;
  /** 견적 CTA(서버의 i18n Link). */
  cta: ReactNode;
  tips: readonly RouteTip[];
  copy: RouteExplorerCopy;
  /**
   * true(기본, 홈) — 카드 칸을 지도 높이에 맞춰 접고 안내 줄·토글을 둔다.
   * false(/fares) — 16장 전부 펼침, 안내 줄·토글·측정 없음. 지도 선 말풍선은 그대로.
   */
  collapse?: boolean;
}

/** 활성 핀 강조 링 반지름(SVG 좌표) — 허브 halo(15)보다 조금 크게. */
const ACTIVE_PIN_R = 9;

export function RouteExplorer({ map, labels, legend, cta, tips, copy, collapse = true }: RouteExplorerProps) {
  const listId = useId();
  const [state, dispatch] = useReducer(explorerReducer, INITIAL_EXPLORER_STATE);
  const [fit, setFit] = useState(() => (collapse ? Math.min(DEFAULT_VISIBLE_CARDS, tips.length) : tips.length));

  const frameRef = useRef<HTMLElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const listEl = useRef<HTMLOListElement | null>(null);
  const cardEls = useRef<(HTMLLIElement | null)[]>([]);
  const overlayRef = useRef<SVGSVGElement | null>(null);

  const setListRef = useCallback((el: HTMLOListElement | null) => {
    listEl.current = el;
  }, []);
  const setCardRef = useCallback((i: number, el: HTMLLIElement | null) => {
    cardEls.current[i] = el;
  }, []);

  // ── 1. 카드 수 측정 ─────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const column = columnRef.current;
    const list = listEl.current;
    if (!collapse) {
      setFit(tips.length);
      return;
    }
    if (!frame || !column || !list || tips.length === 0) return;

    const measure = () => {
      const listBox = list.getBoundingClientRect();
      // 목록 아래 줄(안내·토글·CTA)과 그 여백 — 카드 칸 전체가 지도 높이를 넘지 않게 뺀다.
      const below = column.getBoundingClientRect().bottom - listBox.bottom;
      const heights = cardEls.current.slice(0, tips.length).map((el) => (el ? el.getBoundingClientRect().height : 0));
      const gap = Number.parseFloat(getComputedStyle(list).rowGap);
      const budget = frame.getBoundingClientRect().height - below;
      setFit(fitCardCount({ heights, gap, budget }));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    // 다음 프레임에 잰다 — 콜백 안에서 곧바로 레이아웃을 바꾸면 "ResizeObserver loop" 경고가 난다.
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    // 프레임(지도 크기) · 목록(폭 → 카드 줄바꿈) · 칸 전체(안내 줄이 생기고 사라짐)
    ro.observe(frame);
    ro.observe(list);
    ro.observe(column);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [tips.length, collapse]);

  // ── 2. 탭으로 연 말풍선 — 바깥 탭·Esc 로 닫기 ────────────────────────────
  const active = state.active;
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      // 히트 영역 위의 탭은 path 의 onClick 이 처리한다(다른 선이면 바뀌고 같은 선이면 닫힌다).
      if (target && overlayRef.current?.contains(target) && target.closest("[data-hit]")) return;
      if (active.source === "tap") dispatch({ type: "dismiss" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "dismiss" });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [active]);

  const total = tips.length;
  const visible = !collapse || state.expanded ? total : fit;
  const hiddenCount = collapse ? total - Math.min(fit, total) : 0;
  const showToggle = collapse && (hiddenCount > 0 || state.expanded);
  const activeTip = active ? tips.find((t) => t.id === active.id) ?? null : null;

  // 긴 노선을 먼저 그려 짧은 노선의 히트 영역이 위에 온다(서울 허브 근처에서 짧은 선도 잡히게).
  const hitOrder = [...tips].sort((p, q) => span(q) - span(p));

  return (
    <div className={s.grid} data-has-active={activeTip ? "" : undefined}>
      <figure className={s.mapFrame} ref={frameRef}>
        <div className={s.stage} data-testid="krmap-stage">
          {map}
          {labels ? (
            <div className={s.labelLayer} data-layer="labels">
              {labels}
            </div>
          ) : null}
          {total > 0 ? (
            <svg
              ref={overlayRef}
              className={s.overlay}
              viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
              aria-hidden="true"
              focusable="false"
              data-layer="interaction"
            >
              {activeTip ? (
                <g data-layer="active" data-active-route={activeTip.id}>
                  <path className={s.routeActive} d={activeTip.d} />
                  <circle className={s.pinActive} cx={activeTip.a.x} cy={activeTip.a.y} r={ACTIVE_PIN_R} />
                  <circle className={s.pinActive} cx={activeTip.b.x} cy={activeTip.b.y} r={ACTIVE_PIN_R} />
                </g>
              ) : null}
              <g data-layer="hit">
                {hitOrder.map((t) => (
                  <path
                    key={t.id}
                    className={s.hit}
                    d={t.d}
                    data-hit=""
                    data-route={t.id}
                    onPointerEnter={(e) => e.pointerType === "mouse" && dispatch({ type: "lineEnter", id: t.id })}
                    onPointerLeave={(e) => e.pointerType === "mouse" && dispatch({ type: "lineLeave", id: t.id })}
                    onClick={() => dispatch({ type: "lineTap", id: t.id })}
                  />
                ))}
              </g>
            </svg>
          ) : null}
          {activeTip && showsTip(state) ? <RouteTooltip tip={activeTip} airportLabel={copy.airport} /> : null}
        </div>
        {legend ? (
          <figcaption className={s.caption}>
            <i className={s.swatch} aria-hidden="true" />
            {legend}
          </figcaption>
        ) : null}
      </figure>

      <div className={s.cards} ref={columnRef}>
        {total === 0 ? (
          <p className={s.empty} role="status" data-testid="krmap-empty">
            {copy.empty}
          </p>
        ) : (
          <RouteCards
            tips={tips}
            listId={listId}
            listLabel={copy.listLabel}
            airportLabel={copy.airport}
            visible={visible}
            activeId={active?.id ?? null}
            onCardEnter={(id) => dispatch({ type: "cardEnter", id })}
            onCardLeave={(id) => dispatch({ type: "cardLeave", id })}
            cardRef={setCardRef}
            listRef={setListRef}
          />
        )}

        {!state.expanded && hiddenCount > 0 ? (
          // 마우스·터치 안내 — 스크린리더는 가려진 카드까지 목록에서 이미 읽으므로 이 줄은 건너뛴다.
          <p className={s.more} aria-hidden="true" data-testid="krmap-more">
            {copy.moreHints[hiddenCount] ?? ""}
          </p>
        ) : null}

        {showToggle ? (
          <button
            type="button"
            className={s.toggle}
            aria-expanded={state.expanded}
            aria-controls={listId}
            onClick={() => dispatch({ type: "toggle" })}
            data-testid="krmap-toggle"
          >
            {state.expanded ? copy.showLess : copy.showAll}
          </button>
        ) : null}

        {cta}
      </div>
    </div>
  );
}

/** 히트 영역 그리기 순서용 대략 길이(양 끝 거리의 제곱) — 화면 좌표일 뿐이다. */
function span(t: RouteTip): number {
  const dx = t.b.x - t.a.x;
  const dy = t.b.y - t.a.y;
  return dx * dx + dy * dy;
}
