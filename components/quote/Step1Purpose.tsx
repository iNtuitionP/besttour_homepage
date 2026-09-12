/**
 * 1단계 — 여행 구분 (purposeCode). PURPOSES 칩 = 라디오 그룹(네이티브 의미론, 라벨이 곧 칩). 공항픽업은 목업처럼 "주력" 배지.
 */
import { useTranslations } from "next-intl";

import { PURPOSES } from "@/lib/codes";

import { F } from "./fields";
import { Badge, ErrorText, StepShell } from "./FieldBits";
import s from "./quote.module.css";
import type { StepProps } from "./step-props";

const FEATURED_PURPOSE = "airport_pickup";

export function Step1Purpose({ state, dispatch, active, headingRef, errorFor, idPrefix }: StepProps) {
  const t = useTranslations("quote.steps.purpose");
  const err = errorFor("purposeCode");
  const errId = `${idPrefix}-err-purposeCode`;

  return (
    <StepShell n={1} active={active} headingRef={headingRef} title={t("title")} desc={t("desc")}>
      <div className={s.field} data-field="purposeCode">
        <fieldset className={s.fieldset} aria-describedby={err ? errId : undefined}>
          <legend className={s.flabel}>
            {t("label")} <Badge kind="req" />
          </legend>
          <div className={s.chips}>
            {PURPOSES.map((code) => {
              const checked = state.purposeCode === code;
              const featured = code === FEATURED_PURPOSE;
              return (
                <label key={code} className={featured ? `${s.chip} ${s.chipFeature}` : s.chip} data-checked={checked}>
                  <input
                    type="radio"
                    className={s.chipInput}
                    name={F.purposeCode}
                    value={code}
                    checked={checked}
                    onChange={() => dispatch({ type: "set", field: "purposeCode", value: code })}
                  />
                  {t(`options.${code}`)}
                  {featured ? <span className={s.chipBadge}>{t("feature")}</span> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
        <ErrorText id={errId} message={err} />
      </div>
    </StepShell>
  );
}
