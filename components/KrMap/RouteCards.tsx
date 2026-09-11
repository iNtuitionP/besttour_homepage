/**
 * HTML 레이어 — 대표 노선 카드 리스트(전부 표시). 스크린리더가 읽는 정보 층은 여기다.
 *
 * 서버 컴포넌트. 카드마다 "출발 → 도착", 가격(표시 포맷만), 공항 배지. 목록 아래 견적 CTA(i18n Link → /quote).
 * 카드 hover 로 지도 노선을 강조하는 인터랙션은 이번 범위 밖 — 카드는 정적 <li> 다.
 *
 * 카피는 ko 고정(목업 variant-08 §대표 노선). 영문 카피 수령 전(en.json = {})이라 messages 로 올리지 않았다 —
 * P2-4 가 홈에 넣을 때 COPY 를 messages/*.json 으로 옮기면 된다(한 곳에 모아 둔 이유).
 */
import { Link } from "@/i18n/navigation";
import type { ShowcaseRouteView } from "@/lib/types";
import { formatPriceKrw } from "./format";
import s from "./KrMap.module.css";

const COPY = {
  listLabel: "대표 노선 예시 견적",
  /** CLAUDE.md §3 확정 표기 — 원가 구조를 드러내는 표현은 쓰지 않는다. */
  airport: "공항 픽업·샌딩 (송영 전문)",
  cta: "우리 일정으로 견적 신청하기",
  empty: "지금은 보여 드릴 대표 노선이 없습니다. 견적은 상담으로 안내드립니다.",
} as const;

function touchesAirport(r: ShowcaseRouteView): boolean {
  return r.origin.kind === "airport" || r.destination.kind === "airport";
}

export function RouteCards({ routes }: { routes: readonly ShowcaseRouteView[] }) {
  return (
    <div className={s.cards}>
      {routes.length === 0 ? (
        <p className={s.empty} role="status" data-testid="krmap-empty">
          {COPY.empty}
        </p>
      ) : (
        <ol className={s.cardList} aria-label={COPY.listLabel} data-testid="krmap-cards">
          {routes.map((r, i) => {
            const amount = formatPriceKrw(r.priceFrom);
            return (
              <li
                key={r.id}
                className={r.highlight ? s.cardAccent : s.card}
                data-card={r.id}
                data-highlight={r.highlight || undefined}
              >
                <span className={s.cardIndex} aria-hidden="true">
                  {i + 1}
                </span>
                <span className={s.cardMain}>
                  <b className={s.cardRoute}>
                    {r.origin.nameKo} → {r.destination.nameKo}
                  </b>
                  {touchesAirport(r) ? <em className={s.cardBadge}>{COPY.airport}</em> : null}
                </span>
                {/* 빈 문자열 = 실값 미수령 → 라벨 숨김 폴백 (CLAUDE.md §3) */}
                {amount ? (
                  <span className={s.cardAmount} data-amount="">
                    {amount}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <Link href="/quote" className={s.cta}>
        {COPY.cta} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
