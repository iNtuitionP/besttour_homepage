/**
 * HTML 레이어 — 대표 노선 카드 리스트(전부 표시). 스크린리더가 읽는 정보 층은 여기다.
 *
 * 서버 컴포넌트. 카드마다 "출발 → 도착", 가격(표시 포맷만), 공항 배지. 목록 아래 견적 CTA(i18n Link → /quote).
 * 카드 hover 로 지도 노선을 강조하는 인터랙션은 이번 범위 밖 — 카드는 정적 <li> 다.
 *
 * 카피는 부모 KrMap 이 messages home.krmap 에서 풀어 `copy` 로 넣는다(P2-6 — 이 파일에 한글 리터럴 없음).
 * 지명은 DB 행의 로케일 필드(ko: name_ko · en: name_en — 둘 다 places 시드), 금액은 표시 포맷만(ko "40만원" · en "KRW 400,000").
 * CLAUDE.md §3 확정 표기(copy.airport)는 원가 구조를 드러내는 표현을 쓰지 않는다.
 */
import { Link } from "@/i18n/navigation";
import type { ShowcaseRouteView } from "@/lib/types";
import { formatPriceKrw, formatPriceKrwEn } from "./format";
import s from "./KrMap.module.css";

export interface RouteCardsCopy {
  listLabel: string;
  airport: string;
  cta: string;
  empty: string;
}

function touchesAirport(r: ShowcaseRouteView): boolean {
  return r.origin.kind === "airport" || r.destination.kind === "airport";
}

export function RouteCards({
  routes,
  locale,
  copy,
}: {
  routes: readonly ShowcaseRouteView[];
  locale: string;
  copy: RouteCardsCopy;
}) {
  const en = locale === "en";
  return (
    <div className={s.cards}>
      {routes.length === 0 ? (
        <p className={s.empty} role="status" data-testid="krmap-empty">
          {copy.empty}
        </p>
      ) : (
        <ol className={s.cardList} aria-label={copy.listLabel} data-testid="krmap-cards">
          {routes.map((r, i) => {
            const amount = en ? formatPriceKrwEn(r.priceFrom) : formatPriceKrw(r.priceFrom);
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
                    {en ? r.origin.nameEn : r.origin.nameKo} → {en ? r.destination.nameEn : r.destination.nameKo}
                  </b>
                  {touchesAirport(r) ? <em className={s.cardBadge}>{copy.airport}</em> : null}
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
        {copy.cta} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
