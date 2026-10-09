/**
 * 섹션 3 — 신뢰 지표 (.trust, 목업 variant-08). 서버 컴포넌트. **지어낸 숫자 0.**
 *
 * 목업의 "13년 운행 · 4,800건 견적"·"2013년부터 이어온 단체 운송 실적" 은 실증 불가라 뺐다(CLAUDE.md §3).
 * 남긴 4칸은 전부 근거가 있는 것만:
 *   1. 정식 등록 알선업체 — 통신판매업신고 번호(원장 COMPANY.mailOrderNo)
 *   2. 공항 픽업·샌딩 (송영 전문) — 확정 표기(soul §10.2)
 *   3. {establishedYear}년부터 — 원장 COMPANY.establishedYear(등록증 개업일 2013). 연차("N년")는 표시하지 않는다.
 *   4. 24시간 접수 · 상담은 확인 후 회신 — 플랜 §7 C4 폴백 규칙(사장님 답변 범위 안에서 좁힌 표현)
 * 라벨·상호·대표자는 원장에서만 온다(라벨·대표자는 ledgerUi(locale) — ko 는 LEGAL_LABELS·COMPANY 그대로).
 *
 * 로케일 (P2-6): 신고번호·법인 상호는 원장 한국어 **식별자**라 번역하지 않는다. 산문이 아니므로 안내 문구 없이
 * en 에서만 그 값에 lang="ko" 를 단다(tests/i18n-en.test.ts §7 notice:false). ko 마크업은 이전과 같은 한 줄 문자열이다.
 */
import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";

import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { COMPANY } from "@/lib/legal/disclosures";

import h from "./home.module.css";
import s from "./Sections.module.css";

const ICONS = {
  shield: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 4.8 6.2v5.5c0 4.4 3 7.7 7.2 8.8 4.2-1.1 7.2-4.4 7.2-8.8V6.2z" />
      <path d="m9 12 2.2 2.2L15.4 10" />
    </svg>
  ),
  plane: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12.5 21 5l-4.4 8.2L21 19l-8.6-3.1-3.3 3.6-.4-4.6z" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.4 2" />
    </svg>
  ),
} as const;

export async function TrustBar() {
  const [t, locale] = await Promise.all([getTranslations("home.trust"), getLocale()]);
  const ui = ledgerUi(locale);
  const footer = ui.labels.footer;
  const valueLang = koLang(locale);
  /** 한국어 원장 값 — en 에서만 lang="ko" 로 감싼다(ko 는 감싸지 않는다 — 마크업 불변). */
  const ko = (value: string): ReactNode => (valueLang ? <span lang={valueLang}>{value}</span> : value);

  const items: { icon: ReactNode; title: string; sub: ReactNode }[] = [
    {
      icon: ICONS.shield,
      title: t("registered"),
      sub: valueLang ? (
        <>
          {footer.mailOrder} {ko(COMPANY.mailOrderNo)}
        </>
      ) : (
        `${footer.mailOrder} ${COMPANY.mailOrderNo}`
      ),
    },
    { icon: ICONS.plane, title: t("airport"), sub: t("airportSub") },
    {
      icon: ICONS.calendar,
      // 숫자를 문자열로 넘긴다 — ICU 숫자 포맷이 "2,013" 으로 묶는 것을 막는다.
      title: t("since", { year: String(COMPANY.establishedYear) }),
      sub: valueLang ? (
        <>
          {ko(COMPANY.legalName)} · {footer.representative} {ui.representative}
        </>
      ) : (
        `${COMPANY.legalName} · ${footer.representative} ${ui.representative}`
      ),
    },
    { icon: ICONS.clock, title: t("intake"), sub: t("intakeSub") },
  ].filter((item) => item.title.trim() !== "");

  return (
    <section className={s.trust} aria-label={t("label")} data-section="trust">
      <div className={h.wrap}>
        <ul className={s.trustGrid} data-testid="trust-items">
          {items.map((item) => (
            <li key={item.title} className={s.trustItem}>
              <span className={s.trustIco}>{item.icon}</span>
              <span>
                <b className={s.trustB}>{item.title}</b>
                {typeof item.sub !== "string" || item.sub.trim() !== "" ? <span className={s.trustS}>{item.sub}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
