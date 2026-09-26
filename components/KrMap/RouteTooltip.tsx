/**
 * P2-9 — 지도 선 말풍선 (표시 전용 · 훅 없음). RouteExplorer 가 활성 노선에 대해 스테이지 안에 absolute 로 띄운다.
 *
 * 장식 층의 보조다(aria-hidden) — 같은 정보는 카드 목록(가려진 카드 포함)이 스크린리더에 전달한다.
 * 금액은 서버가 카드와 같은 포맷 함수로 만든 문자열 — 빈 문자열이면 줄을 그리지 않는다(CLAUDE.md §3 라벨 숨김 폴백).
 * 문구 리터럴 없음: 공항 배지 문구도 props(home.krmap.airport).
 */
import type { CSSProperties } from "react";

import type { RouteTip } from "./route-tips";
import s from "./KrMap.module.css";

export function RouteTooltip({ tip, airportLabel }: { tip: RouteTip; airportLabel: string }) {
  const style: CSSProperties = { left: tip.anchor.left, top: tip.anchor.top };
  return (
    <div
      className={s.tip}
      style={style}
      data-align={tip.place.align}
      data-side={tip.place.side}
      data-tip-route={tip.id}
      data-testid="krmap-tip"
      aria-hidden="true"
    >
      <b className={s.tipRoute}>
        {tip.from} → {tip.to}
      </b>
      {tip.amount ? (
        <span className={s.tipAmount} data-tip-amount="">
          {tip.amount}
        </span>
      ) : null}
      {tip.airport ? <em className={s.cardBadge}>{airportLabel}</em> : null}
    </div>
  );
}
