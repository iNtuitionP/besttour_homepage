/**
 * 위저드 공용 조각 — 필수/선택 배지 · 오류 문구 · 단계 셸 (P3-4). 클라이언트 트리(QuoteWizard)에서만 쓰인다.
 * 한글 리터럴 없음 — 문구는 messages/ko.json quote.*.
 */
import { useTranslations } from "next-intl";
import type { ReactNode, RefObject } from "react";

import s from "./quote.module.css";
import { STEP_COUNT, type Step } from "./wizard-state";

export function Badge({ kind }: { kind: "req" | "opt" }) {
  const t = useTranslations("quote");
  return <span className={kind === "req" ? s.req : s.opt}>{t(kind === "req" ? "required" : "optional")}</span>;
}

/** 필드 아래 오류 한 줄. message 가 없으면 아무것도 그리지 않는다(빈 요소를 남기지 않는다). */
export function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className={s.err} id={id} data-testid={`quote-error-${id}`}>
      {message}
    </p>
  );
}

/**
 * 단계 섹션. hidden 속성으로 숨긴다 — display:none 이라 접근성 트리에서 빠지지만 안의 input 값은 폼 제출에 그대로 실린다.
 * 제목은 tabIndex=-1 로 프로그램 포커스를 받는다(단계 전환 시 QuoteWizard 가 focus()).
 */
export function StepShell({
  n,
  active,
  headingRef,
  title,
  desc,
  children,
}: {
  n: Step;
  active: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  const t = useTranslations("quote");
  const titleId = `quote-step-${n}-title`;
  return (
    <section hidden={!active} aria-labelledby={titleId} data-step={n} data-testid={`quote-step-${n}`}>
      <div className={s.stepHead}>
        <p className={s.kicker}>{t("kicker", { n: String(n), total: String(STEP_COUNT) })}</p>
        <h2 className={s.stepTitle} id={titleId} tabIndex={-1} ref={active ? headingRef : null}>
          {title}
        </h2>
        <p className={s.stepDesc}>{desc}</p>
      </div>
      {children}
    </section>
  );
}
