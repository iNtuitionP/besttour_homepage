/**
 * 4단계 — 일정 (tripType · departAtLocal · returnAtLocal · busCount · passengers).
 * 날짜·시각은 목업처럼 date/time 입력을 따로 받고 QuoteWizard 가 `YYYY-MM-DDTHH:mm` hidden 으로 합친다(변환 없음, KST 벽시계).
 * 귀가 입력란: round 필수 · oneway_oneway 선택 · oneway 숨김(안내 한 줄). 대수·인원은 −/+ 스테퍼 + 숫자 입력(inputMode numeric).
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { F } from "./fields";
import { Badge, ErrorText, StepShell } from "./FieldBits";
import s from "./quote.module.css";
import type { StepProps, WizardVehicle } from "./step-props";
import { BUS_COUNT_RANGE, PASSENGERS_RANGE, returnMode, TRIP_TYPES, type TripType } from "./wizard-state";

function Stepper({
  id,
  name,
  value,
  min,
  max,
  unit,
  minusLabel,
  plusLabel,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  name: string;
  value: string;
  min: number;
  max: number;
  unit: string;
  minusLabel: string;
  plusLabel: string;
  onChange: (v: string) => void;
  invalid: boolean;
  describedBy?: string;
}) {
  const n = /^\d+$/.test(value) ? Number(value) : NaN;
  const bump = (d: number) => {
    const base = Number.isInteger(n) ? n : min - (d > 0 ? 1 : 0);
    onChange(String(Math.min(max, Math.max(min, base + d))));
  };
  return (
    <div className={s.stepper}>
      <button type="button" className={s.stepperBtn} aria-label={minusLabel} onClick={() => bump(-1)} disabled={Number.isInteger(n) && n <= min}>
        −
      </button>
      <input
        id={id}
        className={s.stepperInput}
        type="number"
        inputMode="numeric"
        name={name}
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
      />
      <span className={s.stepperUnit} aria-hidden="true">
        {unit}
      </span>
      <button type="button" className={s.stepperBtn} aria-label={plusLabel} onClick={() => bump(1)} disabled={Number.isInteger(n) && n >= max}>
        +
      </button>
    </div>
  );
}

export function Step4Schedule({
  state,
  dispatch,
  active,
  headingRef,
  errorFor,
  idPrefix,
  vehicles,
  minDate,
}: StepProps & { vehicles: readonly WizardVehicle[]; minDate: string }) {
  const t = useTranslations("quote.steps.schedule");
  const mode = returnMode(state.tripType);

  const tripErr = errorFor("tripType");
  const depErr = errorFor("departAtLocal");
  const retErr = errorFor("returnAtLocal");
  const busErr = errorFor("busCount");
  const paxErr = errorFor("passengers");
  const id = (k: string) => `${idPrefix}-${k}`;

  const vehicle = vehicles.find((v) => v.slug === state.vehicleSlug);
  const buses = /^\d+$/.test(state.busCount) && Number(state.busCount) >= 1 ? Number(state.busCount) : 1;
  const pax = /^\d+$/.test(state.passengers) ? Number(state.passengers) : NaN;
  let capNote: ReactNode = null;
  if (!vehicle) {
    capNote = <p className={s.capNote}>{t("capEmpty")}</p>;
  } else {
    const total = vehicle.capacity * buses;
    const vars = { vehicle: vehicle.nameKo, buses: String(buses), total: String(total), pax: String(Number.isNaN(pax) ? 0 : pax) };
    if (!Number.isNaN(pax) && pax > total) {
      capNote = (
        <p className={`${s.capNote} ${s.capWarn}`} role="status">
          {t("capWarn", vars)}
        </p>
      );
    } else {
      capNote = <p className={s.capNote}>{Number.isNaN(pax) ? t("capBase", vars) : t("capNote", vars)}</p>;
    }
  }

  return (
    <StepShell n={4} active={active} headingRef={headingRef} title={t("title")} desc={t("desc")}>
      <div className={s.field} data-field="tripType">
        <fieldset className={s.fieldset} aria-describedby={tripErr ? id("err-tripType") : undefined}>
          <legend className={s.flabel}>
            {t("tripType")} <Badge kind="req" />
          </legend>
          <div className={s.seg}>
            {TRIP_TYPES.map((tt: TripType) => {
              const checked = state.tripType === tt;
              return (
                <label key={tt} className={s.segItem} data-checked={checked} data-trip={tt}>
                  <input
                    type="radio"
                    className={s.chipInput}
                    name={F.tripType}
                    value={tt}
                    checked={checked}
                    onChange={() => dispatch({ type: "setTripType", value: tt })}
                  />
                  <span>{t(`trip.${tt}`)}</span>
                  <span className={s.segSub}>{t(`trip.${tt}Sub`)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <ErrorText id={id("err-tripType")} message={tripErr} />
      </div>

      <div className={s.field} data-field="departAtLocal">
        <div className={s.flabel}>
          {t("depart")} <Badge kind="req" />
        </div>
        <div className={s.grid2}>
          <div>
            <label className={s.sublabel} htmlFor={id("departDate")}>
              {t("departDate")}
            </label>
            <input
              id={id("departDate")}
              className={s.control}
              type="date"
              min={minDate || undefined}
              value={state.departDate}
              onChange={(e) => dispatch({ type: "set", field: "departDate", value: e.target.value })}
              aria-invalid={depErr ? true : undefined}
              aria-describedby={depErr ? id("err-departAtLocal") : undefined}
              data-testid="quote-depart-date"
            />
          </div>
          <div>
            <label className={s.sublabel} htmlFor={id("departTime")}>
              {t("departTime")}
            </label>
            <input
              id={id("departTime")}
              className={s.control}
              type="time"
              step={600}
              value={state.departTime}
              onChange={(e) => dispatch({ type: "set", field: "departTime", value: e.target.value })}
              aria-invalid={depErr ? true : undefined}
              aria-describedby={depErr ? id("err-departAtLocal") : undefined}
              data-testid="quote-depart-time"
            />
          </div>
        </div>
        <ErrorText id={id("err-departAtLocal")} message={depErr} />
      </div>

      {mode === "hidden" ? (
        state.tripType === "oneway" ? (
          <p className={s.notice} data-testid="quote-oneway-note">
            {t("onewayNote")}
          </p>
        ) : null
      ) : (
        <div className={s.field} data-field="returnAtLocal" data-testid="quote-return">
          <div className={s.flabel}>
            {t("return")} <Badge kind={mode === "required" ? "req" : "opt"} />
          </div>
          <p className={s.fhint}>{mode === "required" ? t("returnHint") : t("returnOptionalHint")}</p>
          <div className={s.grid2}>
            <div>
              <label className={s.sublabel} htmlFor={id("returnDate")}>
                {t("returnDate")}
              </label>
              <input
                id={id("returnDate")}
                className={s.control}
                type="date"
                min={state.departDate || minDate || undefined}
                value={state.returnDate}
                onChange={(e) => dispatch({ type: "set", field: "returnDate", value: e.target.value })}
                aria-invalid={retErr ? true : undefined}
                aria-describedby={retErr ? id("err-returnAtLocal") : undefined}
                data-testid="quote-return-date"
              />
            </div>
            <div>
              <label className={s.sublabel} htmlFor={id("returnTime")}>
                {t("returnTime")}
              </label>
              <input
                id={id("returnTime")}
                className={s.control}
                type="time"
                step={600}
                value={state.returnTime}
                onChange={(e) => dispatch({ type: "set", field: "returnTime", value: e.target.value })}
                aria-invalid={retErr ? true : undefined}
                aria-describedby={retErr ? id("err-returnAtLocal") : undefined}
                data-testid="quote-return-time"
              />
            </div>
          </div>
          <ErrorText id={id("err-returnAtLocal")} message={retErr} />
        </div>
      )}

      <div className={s.grid2}>
        <div className={s.field} data-field="busCount">
          <label className={s.flabel} htmlFor={id("busCount")}>
            {t("busCount")} <Badge kind="req" />
          </label>
          <Stepper
            id={id("busCount")}
            name={F.busCount}
            value={state.busCount}
            min={BUS_COUNT_RANGE.min}
            max={BUS_COUNT_RANGE.max}
            unit={t("unitBus")}
            minusLabel={t("busMinus")}
            plusLabel={t("busPlus")}
            onChange={(v) => dispatch({ type: "set", field: "busCount", value: v })}
            invalid={Boolean(busErr)}
            describedBy={busErr ? id("err-busCount") : undefined}
          />
          <ErrorText id={id("err-busCount")} message={busErr} />
        </div>
        <div className={s.field} data-field="passengers">
          <label className={s.flabel} htmlFor={id("passengers")}>
            {t("passengers")} <Badge kind="req" />
          </label>
          <Stepper
            id={id("passengers")}
            name={F.passengers}
            value={state.passengers}
            min={PASSENGERS_RANGE.min}
            max={PASSENGERS_RANGE.max}
            unit={t("unitPax")}
            minusLabel={t("paxMinus")}
            plusLabel={t("paxPlus")}
            onChange={(v) => dispatch({ type: "set", field: "passengers", value: v })}
            invalid={Boolean(paxErr)}
            describedBy={paxErr ? id("err-passengers") : undefined}
          />
          <ErrorText id={id("err-passengers")} message={paxErr} />
        </div>
      </div>
      <div data-testid="quote-cap-note">{capNote}</div>
    </StepShell>
  );
}
