/**
 * 5단계 — 조건 (contactMethod · paymentMethod · parkingIncluded · vatIncluded · message). 전부 선택.
 * 목업의 "이메일" 견적 확인 옵션은 렌더하지 않는다(options.ts HIDDEN_CONTACT_METHODS — 메일 발송 경로 없음, P4-5 후 복구).
 */
import { useTranslations } from "next-intl";

import { F } from "./fields";
import { Badge, ErrorText, StepShell } from "./FieldBits";
import { CONTACT_METHODS, PAYMENT_METHODS } from "./options";
import s from "./quote.module.css";
import type { StepProps } from "./step-props";
import { MESSAGE_MAX_LENGTH } from "./wizard-state";

export function Step5Options({ state, dispatch, active, headingRef, errorFor, idPrefix }: StepProps) {
  const t = useTranslations("quote.steps.options");
  const msgErr = errorFor("message");
  const msgErrId = `${idPrefix}-err-message`;

  return (
    <StepShell n={5} active={active} headingRef={headingRef} title={t("title")} desc={t("desc")}>
      <div className={s.field} data-field="contactMethod">
        <fieldset className={s.fieldset}>
          <legend className={s.flabel}>
            {t("contactMethod")} <Badge kind="opt" />
          </legend>
          <div className={s.chips} data-testid="quote-contact-methods">
            {CONTACT_METHODS.map((m) => {
              const checked = state.contactMethod === m;
              return (
                <label key={m} className={s.chip} data-checked={checked}>
                  <input
                    type="radio"
                    className={s.chipInput}
                    name={F.contactMethod}
                    value={m}
                    checked={checked}
                    onChange={() => dispatch({ type: "set", field: "contactMethod", value: m })}
                  />
                  {t(`contact.${m}`)}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className={s.field} data-field="paymentMethod">
        <fieldset className={s.fieldset}>
          <legend className={s.flabel}>
            {t("paymentMethod")} <Badge kind="opt" />
          </legend>
          <div className={s.chips}>
            {PAYMENT_METHODS.map((m) => {
              const checked = state.paymentMethod === m;
              return (
                <label key={m} className={s.chip} data-checked={checked}>
                  <input
                    type="radio"
                    className={s.chipInput}
                    name={F.paymentMethod}
                    value={m}
                    checked={checked}
                    onChange={() => dispatch({ type: "set", field: "paymentMethod", value: m })}
                  />
                  {t(`payment.${m}`)}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className={s.field}>
        <fieldset className={s.fieldset}>
          <legend className={s.flabel}>
            {t("conditions")} <Badge kind="opt" />
          </legend>
          <label className={s.optrow} data-checked={state.parkingIncluded} data-field="parkingIncluded">
            <input
              type="checkbox"
              name={F.parkingIncluded}
              checked={state.parkingIncluded}
              onChange={(e) => dispatch({ type: "toggle", field: "parkingIncluded", value: e.target.checked })}
            />
            <span>
              <span className={s.optT}>{t("parking")}</span>
              <span className={s.optD}>{t("parkingDesc")}</span>
            </span>
          </label>
          <label className={s.optrow} data-checked={state.vatIncluded} data-field="vatIncluded">
            <input
              type="checkbox"
              name={F.vatIncluded}
              checked={state.vatIncluded}
              onChange={(e) => dispatch({ type: "toggle", field: "vatIncluded", value: e.target.checked })}
            />
            <span>
              <span className={s.optT}>{t("vat")}</span>
              <span className={s.optD}>{t("vatDesc")}</span>
            </span>
          </label>
        </fieldset>
      </div>

      <div className={s.field} data-field="message">
        <label className={s.flabel} htmlFor={`${idPrefix}-message`}>
          {t("message")} <Badge kind="opt" />
        </label>
        <textarea
          id={`${idPrefix}-message`}
          className={s.control}
          name={F.message}
          value={state.message}
          onChange={(e) => dispatch({ type: "set", field: "message", value: e.target.value })}
          placeholder={t("messagePlaceholder")}
          maxLength={MESSAGE_MAX_LENGTH}
          rows={4}
          aria-invalid={msgErr ? true : undefined}
          aria-describedby={msgErr ? msgErrId : undefined}
        />
        <ErrorText id={msgErrId} message={msgErr} />
      </div>
    </StepShell>
  );
}
