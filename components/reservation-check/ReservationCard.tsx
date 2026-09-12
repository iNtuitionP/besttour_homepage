/**
 * 예약확인 결과 카드 (P6-3a). CheckForm(클라이언트) 트리에서 렌더된다 — 'use client' 지시어는 CheckForm 에만 둔다.
 *
 * 뷰 모델(lib/reservation-check/view.ts ReservationView)만 받는다 — 원문 name·phone 은 타입에 없다. 금액·가격 0.
 * 상태 배지(new 접수 · confirmed 확정 · cancelled 취소 · done 완료)는 data-status 로 스타일을 가르고 문구는 ko.json 에서 푼다.
 * 법정 문구(원장 VERBATIM.bookingNotice)와 대표번호(COMPANY.tel)는 서버 페이지가 props 로 내린다 — 원장을 클라이언트 번들에 싣지 않는다
 * (P2-3·P3-4 와 같은 규칙). 한글 리터럴 없음 — 문구는 messages/ko.json reservationCheck.card.*.
 */
import { useTranslations } from "next-intl";

import type { ReservationView } from "@/lib/reservation-check/view";

import q from "@/components/quote/quote.module.css";
import s from "./check.module.css";

export interface ReservationCardProps {
  view: ReservationView;
  /** 원장 VERBATIM.bookingNotice — 서버 페이지가 넣는다. */
  bookingNotice: string;
  /** 원장 COMPANY.tel — 전화 폴백. */
  tel: string;
  /** "다른 예약 조회" — 폼으로 돌아간다(CheckForm 이 라운드를 올려 상태를 초기화한다). */
  onAgain: () => void;
}

export function ReservationCard({ view, bookingNotice, tel, onAgain }: ReservationCardProps) {
  const t = useTranslations("reservationCheck");
  const tRoot = useTranslations();
  const titleId = "reservation-check-result-title";

  return (
    <section className={s.result} aria-labelledby={titleId} data-testid="reservation-card" data-status={view.status}>
      <div className={s.resultHead}>
        <h2 className={s.resultTitle} id={titleId}>
          {t("card.title")}
        </h2>
        <span className={s.badge} data-status={view.status} data-testid="reservation-status">
          {tRoot(view.statusKey)}
        </span>
      </div>

      <p className={s.codeLabel}>{t("card.code")}</p>
      <p className={s.code} data-testid="reservation-code">
        {view.publicCode}
      </p>

      <dl className={s.rows}>
        <div>
          <dt>{t("card.name")}</dt>
          <dd data-testid="reservation-name">{view.maskedName}</dd>
        </div>
        <div>
          <dt>{t("card.phone")}</dt>
          <dd data-testid="reservation-phone">{view.maskedPhone}</dd>
        </div>
        <div>
          <dt>{t("card.vehicle")}</dt>
          <dd>{view.vehicleLabel}</dd>
        </div>
        <div>
          <dt>{t("card.route")}</dt>
          <dd>{t("card.routeValue", { origin: view.originLabel, destination: view.destinationLabel })}</dd>
        </div>
        {view.tripTypeKey ? (
          <div>
            <dt>{t("card.tripType")}</dt>
            <dd>{tRoot(view.tripTypeKey)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("card.departAt")}</dt>
          <dd>{view.departAtKst}</dd>
        </div>
        {view.returnAtKst ? (
          <div>
            <dt>{t("card.returnAt")}</dt>
            <dd>{view.returnAtKst}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("card.busCount")}</dt>
          <dd>{t("card.busCountValue", { n: view.busCount })}</dd>
        </div>
        {view.passengers !== null ? (
          <div>
            <dt>{t("card.passengers")}</dt>
            <dd>{t("card.passengersValue", { n: view.passengers })}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("card.createdAt")}</dt>
          <dd>{view.createdAtKst}</dd>
        </div>
      </dl>

      <p className={q.doneNote}>
        <span data-legal="booking-notice">{bookingNotice}</span>
      </p>
      <p className={q.doneSub}>{t("card.help", { tel })}</p>

      <div className={s.actions}>
        <a className={`${q.btn} ${q.btnPrev}`} href={`tel:${tel}`} data-testid="reservation-call">
          {t("card.call")} {tel}
        </a>
        <button type="button" className={`${q.btn} ${q.btnSubmit}`} onClick={onAgain} data-testid="reservation-again">
          {t("card.again")}
        </button>
      </div>
    </section>
  );
}
