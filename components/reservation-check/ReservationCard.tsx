/**
 * 예약확인 결과 카드 (P6-3a). CheckForm(클라이언트) 트리에서 렌더된다 — 'use client' 지시어는 CheckForm 에만 둔다.
 *
 * 뷰 모델(lib/reservation-check/view.ts ReservationView)만 받는다 — 원문 name·phone 은 타입에 없다. 금액·가격 0.
 * 상태 배지(new 접수 · confirmed 확정 · cancelled 취소 · done 완료)는 data-status 로 스타일을 가르고 문구는 ko.json 에서 푼다.
 * 법정 문구(원장 VERBATIM.bookingNotice)와 예약·상담 전화(consultPhone — P1-7)는 서버 페이지가 props 로 내린다 — 원장을 클라이언트 번들에
 * 싣지 않는다(P2-3·P3-4 와 같은 규칙). 한글 리터럴 없음 — 문구는 messages/ko.json reservationCheck.card.*.
 * 날짜(P7-4): 뷰의 KST 벽시계 원문(`YYYY-MM-DD HH:mm` · 간편 접수는 `YYYY-MM-DD`)을 공개 화면 공용 틀로 바꿔 보인다
 * (lib/public-date.ts · 카탈로그 common.dates — ko "10월 9일 (금) 07:00" · en "Fri, Oct 9, 07:00"). 읽을 수 없으면 원문 그대로.
 */
import { useLocale, useTranslations } from "next-intl";

import type { ContactPhone } from "@/lib/contact-phone";
import { intlPhone } from "@/lib/phone-format";
import { formatPublicDate, publicDateLabels } from "@/lib/public-date";
import type { ReservationView } from "@/lib/reservation-check/view";

import q from "@/components/quote/quote.module.css";
import s from "./check.module.css";

export interface ReservationCardProps {
  view: ReservationView;
  /** 원장 VERBATIM.bookingNotice — 서버 페이지가 넣는다. */
  bookingNotice: string;
  /** 예약·상담 전화 — 전화 폴백. 표시는 로케일별, 링크는 E.164. */
  tel: ContactPhone;
  /** "다른 예약 조회" — 폼으로 돌아간다(CheckForm 이 라운드를 올려 상태를 초기화한다). */
  onAgain: () => void;
}

export function ReservationCard({ view, bookingNotice, tel, onAgain }: ReservationCardProps) {
  const t = useTranslations("reservationCheck");
  const tRoot = useTranslations();
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const titleId = "reservation-check-result-title";
  const dates = publicDateLabels(tCommon.raw("dates"));
  const now = new Date();
  /** 일정·접수 시각 — 시각이 있으면 붙인다(간편 접수는 날짜만). 읽을 수 없으면 원문 그대로(줄을 비우지 않는다). */
  const when = (value: string) => formatPublicDate(value, dates, { style: "schedule", time: true, now }) ?? value;

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
          {/* 영문 화면은 +82 표기(P7-4 · 가린 그대로 — "010-****-1234" → "+82 10-****-1234") */}
          <dd data-testid="reservation-phone">{locale === "ko" ? view.maskedPhone : intlPhone(view.maskedPhone)}</dd>
        </div>
        {/* 간편 접수(P3-8)는 차종을 받지 않았다 — 줄을 숨긴다(사장님이 전화로 확인). */}
        {view.vehicleLabel !== null ? (
          <div>
            <dt>{t("card.vehicle")}</dt>
            <dd>{view.vehicleLabel}</dd>
          </div>
        ) : null}
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
        {/* 간편 접수는 날짜만 받는다 — 라벨도 "일시" 가 아니라 "일"(값은 view 가 날짜만 만든다). */}
        <div>
          <dt>{view.intake === "quick" ? t("card.departDate") : t("card.departAt")}</dt>
          <dd>{when(view.departAtKst)}</dd>
        </div>
        {view.returnAtKst ? (
          <div>
            <dt>{view.intake === "quick" ? t("card.returnDate") : t("card.returnAt")}</dt>
            <dd>{when(view.returnAtKst)}</dd>
          </div>
        ) : null}
        {view.busCount !== null ? (
          <div>
            <dt>{t("card.busCount")}</dt>
            <dd>{t("card.busCountValue", { n: view.busCount })}</dd>
          </div>
        ) : null}
        {view.passengers !== null ? (
          <div>
            <dt>{t("card.passengers")}</dt>
            <dd>{t("card.passengersValue", { n: view.passengers })}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t("card.createdAt")}</dt>
          <dd>{when(view.createdAtKst)}</dd>
        </div>
      </dl>

      <p className={q.doneNote}>
        <span data-legal="booking-notice">{bookingNotice}</span>
      </p>
      <p className={q.doneSub}>{t("card.help", { tel: tel.display })}</p>

      <div className={s.actions}>
        <a className={`${q.btn} ${q.btnPrev}`} href={tel.href} data-testid="reservation-call">
          {t("card.call")} {tel.display}
        </a>
        <button type="button" className={`${q.btn} ${q.btnSubmit}`} onClick={onAgain} data-testid="reservation-again">
          {t("card.again")}
        </button>
      </div>
    </section>
  );
}
