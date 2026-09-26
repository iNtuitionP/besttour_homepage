/**
 * HTML 레이어 — 대표 노선 카드 리스트. 스크린리더가 읽는 정보 층은 여기다.
 *
 * P2-9: 표시 전용 컴포넌트(훅 없음)로 바뀌었다 — RouteExplorer(클라이언트)가 보일 장수·활성 노선·hover 핸들러를 넘긴다.
 *   - 카드 16장은 **언제나 DOM 에 있다.** 지도 높이를 넘는 카드는 `.cardOffscreen`(clip-path — visually-hidden)으로만 가린다.
 *     `hidden`·`display:none` 을 쓰지 않는다: 스크린리더는 16장을 전부 읽는다. 가려진 카드도 자연 높이를 유지해 측정할 수 있다.
 *   - 카드 hover → 지도 선 강조(양방향 연동). 활성 카드는 data-active.
 * 문구·금액·지명은 서버(KrMap → toRouteTips)가 만든 문자열만 받는다 — 이 파일에 문구 리터럴·가격 포맷 호출 없음.
 * 견적 CTA(i18n Link)는 서버 KrMap 이 만들어 RouteExplorer 가 목록 아래에 놓는다.
 */
import type { PointerEvent } from "react";

import type { RouteTip } from "./route-tips";
import s from "./KrMap.module.css";

export interface RouteCardsProps {
  tips: readonly RouteTip[];
  listId: string;
  listLabel: string;
  airportLabel: string;
  /** 보이는 카드 수(앞에서부터). 나머지는 visually-hidden. */
  visible: number;
  activeId: number | null;
  onCardEnter?: (id: number) => void;
  onCardLeave?: (id: number) => void;
  /** 카드 요소 ref — 측정용(가려진 카드 포함 전부). */
  cardRef?: (index: number, el: HTMLLIElement | null) => void;
  listRef?: (el: HTMLOListElement | null) => void;
}

const isMouse = (e: PointerEvent) => e.pointerType === "mouse";

export function RouteCards({
  tips,
  listId,
  listLabel,
  airportLabel,
  visible,
  activeId,
  onCardEnter,
  onCardLeave,
  cardRef,
  listRef,
}: RouteCardsProps) {
  return (
    <ol className={s.cardList} aria-label={listLabel} id={listId} ref={listRef} data-testid="krmap-cards">
      {tips.map((t, i) => {
        const offscreen = i >= visible;
        const classes = [t.highlight ? s.cardAccent : s.card, offscreen ? s.cardOffscreen : ""].filter(Boolean).join(" ");
        return (
          <li
            key={t.id}
            ref={cardRef ? (el) => cardRef(i, el) : undefined}
            className={classes}
            data-card={t.id}
            data-highlight={t.highlight || undefined}
            data-offscreen={offscreen ? "" : undefined}
            data-active={activeId === t.id ? "" : undefined}
            onPointerEnter={onCardEnter ? (e) => isMouse(e) && onCardEnter(t.id) : undefined}
            onPointerLeave={onCardLeave ? (e) => isMouse(e) && onCardLeave(t.id) : undefined}
          >
            <span className={s.cardIndex} aria-hidden="true">
              {i + 1}
            </span>
            <span className={s.cardMain}>
              <b className={s.cardRoute}>
                {t.from} → {t.to}
              </b>
              {t.airport ? <em className={s.cardBadge}>{airportLabel}</em> : null}
            </span>
            {/* 빈 문자열 = 실값 미수령 → 라벨 숨김 폴백 (CLAUDE.md §3) */}
            {t.amount ? (
              <span className={s.cardAmount} data-amount="">
                {t.amount}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
