/**
 * 6단계 — 연락처 · 동의 · 제출 준비 (name · phone/phoneIntl · email · privacyConsent · marketingConsent).
 * 연락처는 국내(phone) XOR 해외(phoneIntl): 종류 토글 뒤 활성 칸 하나만 보인다. 보이는 칸은 이름 없이 UI 만 맡고,
 * 실제 제출 값은 QuoteWizard 가 toFormValues 로 만든 hidden phone/phoneIntl 이 낸다(XOR 을 순수 함수가 보장한다).
 * 동의 블록 → 청약철회 고지(서버 컴포넌트 노드) → 보안 확인(Turnstile 또는 "접수 준비 중") 순서. 제출 버튼은 바로 아래 navbar 에 있다.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ConsentBlock, type ConsentText } from "./ConsentBlock";
import { F } from "./fields";
import { Badge, ErrorText, StepShell } from "./FieldBits";
import { formatKrPhone } from "./options";
import s from "./quote.module.css";
import type { StepProps } from "./step-props";
import { NAME_MAX_LENGTH, type PhoneKind } from "./wizard-state";

const PHONE_KINDS: readonly PhoneKind[] = ["kr", "intl"];

export function Step6Contact({
  state,
  dispatch,
  active,
  headingRef,
  errorFor,
  idPrefix,
  consent,
  withdrawalNotice,
  security,
}: StepProps & { consent: ConsentText; withdrawalNotice: ReactNode; security: ReactNode }) {
  const t = useTranslations("quote.steps.contact");
  const id = (k: string) => `${idPrefix}-${k}`;
  const nameErr = errorFor("name");
  const phoneErr = state.phoneKind === "intl" ? errorFor("phoneIntl") : errorFor("phone");
  const phoneField = state.phoneKind === "intl" ? "phoneIntl" : "phone";
  const emailErr = errorFor("email");
  const consentErr = errorFor("privacyConsent");

  return (
    <StepShell n={6} active={active} headingRef={headingRef} title={t("title")} desc={t("desc")}>
      <div className={s.field} data-field="name">
        <label className={s.flabel} htmlFor={id("name")}>
          {t("nameLabel")} <Badge kind="req" />
        </label>
        <input
          id={id("name")}
          className={s.control}
          type="text"
          name={F.name}
          value={state.name}
          onChange={(e) => dispatch({ type: "set", field: "name", value: e.target.value })}
          placeholder={t("namePlaceholder")}
          autoComplete="name"
          maxLength={NAME_MAX_LENGTH}
          aria-invalid={nameErr ? true : undefined}
          aria-describedby={nameErr ? id("err-name") : undefined}
          data-testid="quote-name"
        />
        <ErrorText id={id("err-name")} message={nameErr} />
      </div>

      <div className={s.field} data-field={phoneField}>
        <div className={s.flabel}>
          {t("phoneLabel")} <Badge kind="req" />
        </div>
        <div className={s.chips} role="group" aria-label={t("phoneKind")}>
          {PHONE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={s.chip}
              data-checked={state.phoneKind === kind}
              aria-pressed={state.phoneKind === kind}
              onClick={() => dispatch({ type: "setPhoneKind", value: kind })}
              data-testid={`quote-phone-kind-${kind}`}
            >
              {kind === "kr" ? t("phoneKr") : t("phoneIntlKind")}
            </button>
          ))}
        </div>
        {state.phoneKind === "intl" ? (
          <>
            <label className={s.sublabel} htmlFor={id("phoneIntl")}>
              {t("phoneIntlLabel")}
            </label>
            <p className={s.fhint} id={id("hint-phoneIntl")}>
              {t("phoneIntlHint")}
            </p>
            <input
              id={id("phoneIntl")}
              className={s.control}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={state.phoneIntl}
              onChange={(e) => dispatch({ type: "set", field: "phoneIntl", value: e.target.value.replace(/[^\d+]/g, "") })}
              aria-invalid={phoneErr ? true : undefined}
              aria-describedby={phoneErr ? `${id("hint-phoneIntl")} ${id("err-phone")}` : id("hint-phoneIntl")}
              data-testid="quote-phone-intl"
            />
          </>
        ) : (
          <>
            <label className={s.sublabel} htmlFor={id("phone")}>
              {t("phoneLabel")}
            </label>
            <p className={s.fhint} id={id("hint-phone")}>
              {t("phoneHint")}
            </p>
            <input
              id={id("phone")}
              className={s.control}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={13}
              value={state.phone}
              onChange={(e) => dispatch({ type: "set", field: "phone", value: formatKrPhone(e.target.value) })}
              aria-invalid={phoneErr ? true : undefined}
              aria-describedby={phoneErr ? `${id("hint-phone")} ${id("err-phone")}` : id("hint-phone")}
              data-testid="quote-phone"
            />
          </>
        )}
        <ErrorText id={id("err-phone")} message={phoneErr} />
      </div>

      <div className={s.field} data-field="email">
        <label className={s.flabel} htmlFor={id("email")}>
          {t("email")} <Badge kind="opt" />
        </label>
        <input
          id={id("email")}
          className={s.control}
          type="email"
          name={F.email}
          value={state.email}
          onChange={(e) => dispatch({ type: "set", field: "email", value: e.target.value })}
          placeholder={t("emailPlaceholder")}
          autoComplete="email"
          aria-invalid={emailErr ? true : undefined}
          aria-describedby={emailErr ? id("err-email") : undefined}
          data-testid="quote-email"
        />
        <ErrorText id={id("err-email")} message={emailErr} />
      </div>

      <ConsentBlock
        text={consent}
        privacyConsent={state.privacyConsent}
        marketingConsent={state.marketingConsent}
        onPrivacyChange={(v) => dispatch({ type: "toggle", field: "privacyConsent", value: v })}
        onMarketingChange={(v) => dispatch({ type: "toggle", field: "marketingConsent", value: v })}
        error={consentErr}
        idPrefix={idPrefix}
      />

      {withdrawalNotice}

      <div data-testid="quote-security" aria-label={t("security")}>
        {security}
      </div>
    </StepShell>
  );
}
