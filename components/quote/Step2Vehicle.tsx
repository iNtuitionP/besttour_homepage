/**
 * 2단계 — 차량 (vehicleSlug). getVehicles() 5종 카드 = 라디오 그룹. **가격 없음.** 정원은 DB capacity, 한 줄 설명은 ko.json lines[slug].
 */
import Image from "next/image";
import { useTranslations } from "next-intl";

import { F } from "./fields";
import { Badge, ErrorText, StepShell } from "./FieldBits";
import { VEHICLE_IMAGES } from "./options";
import s from "./quote.module.css";
import type { StepProps, WizardVehicle } from "./step-props";

export function Step2Vehicle({
  state,
  dispatch,
  active,
  headingRef,
  errorFor,
  idPrefix,
  vehicles,
}: StepProps & { vehicles: readonly WizardVehicle[] }) {
  const t = useTranslations("quote.steps.vehicle");
  const lines = t.raw("lines") as Record<string, string | undefined>;
  const err = errorFor("vehicleSlug");
  const errId = `${idPrefix}-err-vehicleSlug`;

  return (
    <StepShell n={2} active={active} headingRef={headingRef} title={t("title")} desc={t("desc")}>
      <div className={s.field} data-field="vehicleSlug">
        <fieldset className={s.fieldset} aria-describedby={err ? errId : undefined}>
          <legend className={s.flabel}>
            {t("label")} <Badge kind="req" />
          </legend>
          {vehicles.length === 0 ? (
            <p className={s.notice} role="status">
              {t("empty")}
            </p>
          ) : (
            <div className={s.vehGrid} data-testid="quote-vehicles">
              {vehicles.map((v) => {
                const checked = state.vehicleSlug === v.slug;
                const image = VEHICLE_IMAGES[v.slug];
                const line = lines[v.slug];
                return (
                  <label key={v.slug} className={s.veh} data-checked={checked} data-vehicle={v.slug}>
                    <input
                      type="radio"
                      className={s.chipInput}
                      name={F.vehicleSlug}
                      value={v.slug}
                      checked={checked}
                      onChange={() => dispatch({ type: "set", field: "vehicleSlug", value: v.slug })}
                    />
                    <span className={s.vehPh}>
                      {image ? (
                        <Image className={s.vehImg} src={image} alt="" fill sizes="(min-width: 960px) 33vw, (min-width: 560px) 50vw, 100vw" />
                      ) : null}
                      <span className={s.vehCheck} aria-hidden="true">
                        ✓
                      </span>
                    </span>
                    <span className={s.vehBody}>
                      <span className={s.vehName}>{v.nameKo}</span>
                      <span className={s.vehMeta}>{t("capacity", { n: String(v.capacity) })}</span>
                      {line ? <span className={s.vehNote}>{line}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
        <ErrorText id={errId} message={err} />
      </div>
      <p className={s.notice}>{t("notice")}</p>
    </StepShell>
  );
}
