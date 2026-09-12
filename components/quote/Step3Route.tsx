/**
 * 3단계 — 경로 (originCode · destinationCode · waypointCodes[] 최대 5).
 * 선택지 = LOCATION_CODES 를 "도시" 그룹(카탈로그 순, 인천공항 맨 앞) + "그 외 지역(시도)" 그룹으로. 라벨은 locationLabelKo(표시 전용).
 * 경유지는 같은 name 의 select 를 여러 개 두어 서버가 getAll 로 받는다. 인천공항이 끼면(또는 공항픽업이면) 공항 안내 한 줄.
 */
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { locationLabelKo } from "@/lib/codes";

import { F } from "./fields";
import { Badge, ErrorText, StepShell } from "./FieldBits";
import { locationGroups } from "./options";
import s from "./quote.module.css";
import type { StepProps } from "./step-props";
import { MAX_WAYPOINTS } from "./wizard-state";

const AIRPORT_CODE = "ICN";
const AIRPORT_PURPOSE = "airport_pickup";

export function Step3Route({ state, dispatch, active, headingRef, errorFor, idPrefix }: StepProps) {
  const t = useTranslations("quote.steps.route");
  const groups = useMemo(() => locationGroups(), []);

  const originErr = errorFor("originCode");
  const destErr = errorFor("destinationCode");
  const viaErr = errorFor("waypointCodes");
  const routeErrId = `${idPrefix}-err-route`;
  const viaErrId = `${idPrefix}-err-waypointCodes`;
  const routeErr = originErr ?? destErr;

  const full = state.waypointCodes.length >= MAX_WAYPOINTS;
  const isAirport =
    state.purposeCode === AIRPORT_PURPOSE || [state.originCode, state.destinationCode, ...state.waypointCodes].includes(AIRPORT_CODE);

  const options = (placeholder: string) => (
    <>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g.key} label={t(g.key === "cities" ? "groupCities" : "groupRegions")}>
          {g.codes.map((code) => (
            <option key={code} value={code}>
              {locationLabelKo(code)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );

  const addWaypoint = () => {
    const index = state.waypointCodes.length;
    dispatch({ type: "addWaypoint" });
    window.setTimeout(() => document.getElementById(`${idPrefix}-via-${index}`)?.focus(), 0);
  };

  return (
    <StepShell n={3} active={active} headingRef={headingRef} title={t("title")} desc={t("desc")}>
      <div className={s.field}>
        <div className={s.flabel} id={`${idPrefix}-route-label`}>
          {t("label")} <Badge kind="req" />
        </div>
        <div className={s.grid2}>
          <div data-field="originCode">
            <label className={s.sublabel} htmlFor={`${idPrefix}-origin`}>
              {t("origin")}
            </label>
            <select
              id={`${idPrefix}-origin`}
              className={s.control}
              name={F.originCode}
              value={state.originCode}
              onChange={(e) => dispatch({ type: "set", field: "originCode", value: e.target.value })}
              aria-invalid={originErr ? true : undefined}
              aria-describedby={routeErr ? routeErrId : undefined}
              data-testid="quote-origin"
            >
              {options(t("originPlaceholder"))}
            </select>
          </div>
          <div data-field="destinationCode">
            <label className={s.sublabel} htmlFor={`${idPrefix}-dest`}>
              {t("dest")}
            </label>
            <select
              id={`${idPrefix}-dest`}
              className={s.control}
              name={F.destinationCode}
              value={state.destinationCode}
              onChange={(e) => dispatch({ type: "set", field: "destinationCode", value: e.target.value })}
              aria-invalid={destErr ? true : undefined}
              aria-describedby={routeErr ? routeErrId : undefined}
              data-testid="quote-dest"
            >
              {options(t("destPlaceholder"))}
            </select>
          </div>
        </div>
        <ErrorText id={routeErrId} message={routeErr} />
        {isAirport ? (
          <p className={s.airNote} data-testid="quote-air">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.5 4.5 6.7v5.4c0 4.3 3 7.5 7.5 8.4 4.5-.9 7.5-4.1 7.5-8.4V6.7z" />
              <path d="m9 12 2.1 2.1L15.4 9.8" />
            </svg>
            <span>{t("airNote")}</span>
          </p>
        ) : null}
      </div>

      <div className={s.field} data-field="waypointCodes">
        <div className={s.flabel} id={`${idPrefix}-via-label`}>
          {t("waypoints")} <Badge kind="opt" />
        </div>
        <p className={s.fhint}>{t("waypointsHint", { max: String(MAX_WAYPOINTS) })}</p>
        {state.waypointCodes.length === 0 ? (
          <p className={s.viaEmpty}>{t("waypointEmpty")}</p>
        ) : (
          <ul className={s.viaList} aria-labelledby={`${idPrefix}-via-label`} data-testid="quote-waypoints">
            {state.waypointCodes.map((code, i) => {
              const n = String(i + 1);
              return (
                <li key={i} className={s.viaRow}>
                  <span className={s.viaIdx} aria-hidden="true">
                    {n}
                  </span>
                  <label className={s.srOnly} htmlFor={`${idPrefix}-via-${i}`}>
                    {t("waypointLabel", { n })}
                  </label>
                  <select
                    id={`${idPrefix}-via-${i}`}
                    className={s.control}
                    name={F.waypointCodes}
                    value={code}
                    onChange={(e) => dispatch({ type: "setWaypoint", index: i, value: e.target.value })}
                    aria-invalid={viaErr && code === "" ? true : undefined}
                    aria-describedby={viaErr ? viaErrId : undefined}
                  >
                    {options(t("waypointPlaceholder", { n }))}
                  </select>
                  <button
                    type="button"
                    className={s.viaDel}
                    aria-label={t("waypointRemove", { n })}
                    onClick={() => dispatch({ type: "removeWaypoint", index: i })}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className={s.btnAdd} disabled={full} onClick={addWaypoint} data-testid="quote-waypoint-add">
          {full ? t("waypointMax", { max: String(MAX_WAYPOINTS) }) : t("waypointAdd")}
        </button>
        <ErrorText id={viaErrId} message={viaErr} />
      </div>
    </StepShell>
  );
}
