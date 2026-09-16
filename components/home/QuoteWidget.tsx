"use client";

/**
 * 견적 신청 위젯 — **접수하지 않는다** (P2-4 §1 · 플랜 P3-4 "접수 경로는 위저드 하나로 통일").
 * (P6-10: 카피의 "1분"은 측정된 적 없는 소요시간 주장이라 뺐다 — 감사 R-5. 이 주석의 이름도 같이 맞춘다.)
 *
 * 출발·도착·출발일·탑승 인원을 받아 /quote 프리필 링크(quoteHref)만 만든다.
 *   - 이름·전화 입력란·모달·서버 액션·fetch 없음 — 동의 UI 없이 개인정보를 받게 되므로 여기서는 금지.
 *   - Link prefetch 는 끈다: href 가 입력마다 바뀌고 /quote 는 P3 에서 생긴다(지금은 404) — 네트워크 요청 0.
 *   - 선택지·라벨·법정 문구(verbatim)는 서버 Hero 가 props 로 넣는다. 이 파일에 한글 리터럴·원장 import 없음.
 * 인천공항이 출발 또는 도착이면 공항 안내 한 줄을 보인다(목업 .quote__air).
 */
import { useId, useState, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";

import h from "./home.module.css";
import s from "./Hero.module.css";
import { quoteHref } from "./quote-href";

export interface QuoteOption {
  value: string;
  label: string;
}
export interface QuoteGroup {
  label: string;
  options: QuoteOption[];
}
export interface QuoteWidgetLabels {
  widget: string;
  title: string;
  sub: string;
  origin: string;
  dest: string;
  date: string;
  pax: string;
  cta: string;
}

const AIRPORT_CODE = "ICN";

export function QuoteWidget({
  labels,
  groups,
  defaults,
  airNote,
  paymentNote,
  bookingNotice,
}: {
  labels: QuoteWidgetLabels;
  groups: QuoteGroup[];
  defaults: { origin: string; dest: string };
  airNote: ReactNode;
  paymentNote: string;
  bookingNotice: string;
}) {
  const id = useId();
  const [origin, setOrigin] = useState(defaults.origin);
  const [dest, setDest] = useState(defaults.dest);
  const [date, setDate] = useState("");
  const [pax, setPax] = useState("");

  const href = quoteHref({ origin, dest, date, pax });
  const isAirport = origin === AIRPORT_CODE || dest === AIRPORT_CODE;

  const renderOptions = () =>
    groups.map((g) => (
      <optgroup key={g.label} label={g.label}>
        {g.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>
    ));

  return (
    <aside className={s.quote} aria-label={labels.widget} data-testid="quote-widget">
      <div className={s.quoteHd}>
        <h2 className={s.quoteTitle}>{labels.title}</h2>
        <p className={s.quoteSub}>{labels.sub}</p>
      </div>

      <div className={s.quoteForm}>
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${id}-origin`}>
            {labels.origin}
          </label>
          <div className={`${s.ctrl} ${s.ctrlSelect}`}>
            <select id={`${id}-origin`} value={origin} onChange={(e) => setOrigin(e.target.value)} data-testid="quote-origin">
              {renderOptions()}
            </select>
          </div>
        </div>

        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${id}-dest`}>
            {labels.dest}
          </label>
          <div className={`${s.ctrl} ${s.ctrlSelect}`}>
            <select id={`${id}-dest`} value={dest} onChange={(e) => setDest(e.target.value)} data-testid="quote-dest">
              {renderOptions()}
            </select>
          </div>
        </div>

        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${id}-date`}>
            {labels.date}
          </label>
          <div className={s.ctrl}>
            <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="quote-date" />
          </div>
        </div>

        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${id}-pax`}>
            {labels.pax}
          </label>
          <div className={s.ctrl}>
            <input
              id={`${id}-pax`}
              type="number"
              inputMode="numeric"
              min={1}
              max={900}
              step={1}
              value={pax}
              onChange={(e) => setPax(e.target.value)}
              data-testid="quote-pax"
            />
          </div>
        </div>
      </div>

      {isAirport ? (
        <p className={s.quoteAir} data-testid="quote-air">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3.5 4.5 6.7v5.4c0 4.3 3 7.5 7.5 8.4 4.5-.9 7.5-4.1 7.5-8.4V6.7z" />
            <path d="m9 12 2.1 2.1L15.4 9.8" />
          </svg>
          <span>{airNote}</span>
        </p>
      ) : null}

      <div className={s.quoteFoot}>
        <Link href={href} prefetch={false} className={`${h.btnGold} ${h.btnBlock} ${h.btnLg}`} data-testid="quote-cta">
          {labels.cta}
        </Link>
        <p className={s.quoteNote}>
          {paymentNote}
          <br />
          {bookingNotice}
        </p>
      </div>
    </aside>
  );
}
