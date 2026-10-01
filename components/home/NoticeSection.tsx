/**
 * 섹션 9 — 공지 + 고객센터 (#notice, 목업 variant-08 §07). 서버 컴포넌트.
 * 원격 notices 가 비어 있으면 **섹션 자체를 숨긴다**(빈 목록 금지 — 고객센터 카드도 함께; 연락처는 푸터에 있다).
 * 항목 제목은 상세(/notices/[id])로 가는 링크이고, 목록 아래에 "공지 전체 보기"(/notices — 메뉴가 ready 일 때만) 링크를 둔다
 * (P7-4 · 브리프 §13 — 갤러리 섹션의 "갤러리 전체 보기" 와 같은 모양).
 * 날짜(P7-4 · 브리프 §4): 보이는 글자는 공개 화면 공용 틀의 게시일(lib/public-date.ts — ko "2026년 9월 22일" · en "Sep 22, 2026"),
 * `<time dateTime>` 은 notice-date.ts 의 KST 달력 날짜(YYYY-MM-DD) — /notices 와 같은 함수다.
 * 영문 화면(P7-4 · 브리프 §7): 공지 제목은 사장님이 쓴 한국어라 lang="ko"(koLang — ko 화면은 속성을 내지 않는다).
 * 고객센터 카드의 라벨·연락처는 원장에서만 온다 — 라벨은 ledgerUi(locale)(ko 는 LEGAL_LABELS.contact 그대로 — P2-6), 값은 COMPANY.
 * 첫 줄은 예약·상담 전화(P1-7 — lib/contact-phone, en 은 +82 표기). 대표전화 1566 은 이 카드에 두지 않는다(푸터 사업자 정보 한 줄만).
 * 사장님 휴대전화·팩스도 en 은 +82 표기, 링크는 E.164(P7-4 — localPhone · 원장 값은 그대로).
 */
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { consultPhone, localPhone } from "@/lib/contact-phone";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { LEGACY_MENU } from "@/lib/legacy-menu-map";
import { COMPANY } from "@/lib/legal/disclosures";
import { formatPublicDate, publicDateLabels } from "@/lib/public-date";
import type { Notice } from "@/lib/types";

import h from "./home.module.css";
import s from "./Sections.module.css";
import { noticeDate } from "./notice-date";
import { RICH } from "./rich";
import { SectionHead } from "./SectionHead";

export async function NoticeSection({ notices }: { notices: readonly Notice[] }) {
  if (notices.length === 0) return null;
  const [t, tCommon, locale] = await Promise.all([getTranslations("home.notice"), getTranslations("common"), getLocale()]);
  const categories = t.raw("category") as Record<string, string | undefined>;
  const contact = ledgerUi(locale).labels.contact;
  const phone = consultPhone(locale);
  const mobile = localPhone(COMPANY.mobile, locale);
  const fax = localPhone(COMPANY.fax, locale);
  const dates = publicDateLabels(tCommon.raw("dates"));
  const lang = koLang(locale);
  const noticesMenu = LEGACY_MENU.find((m) => m.key === "notices");

  return (
    <section id="notice" className={`${h.section} ${h.toneWhite}`} aria-labelledby="notice-h" data-section="notice">
      <div className={`${h.wrap} ${s.noticeGrid}`}>
        <div>
          <SectionHead id="notice-h" eyebrow={t("eyebrow")} title={t.rich("title", RICH)} split={false} />
          <ul className={s.notices} data-testid="notice-list">
            {notices.map((n) => {
              const date = noticeDate(n.publishedAt);
              return (
                <li key={n.id} className={s.noticeItem}>
                  <span className={s.noticeCat}>{categories[n.category] ?? n.category}</span>
                  <Link className={`${s.noticeTitle} ${s.noticeLink}`} href={`/notices/${n.id}`} lang={lang}>
                    {n.title}
                  </Link>
                  <time className={s.noticeDate} dateTime={date}>
                    {formatPublicDate(date, dates, { style: "posted" }) ?? date}
                  </time>
                </li>
              );
            })}
          </ul>
          {noticesMenu?.ready ? (
            <p className={s.noticeMore}>
              <Link href={noticesMenu.href} className={h.btnGhost}>
                {t("more")}
              </Link>
            </p>
          ) : null}
        </div>

        <aside className={s.cscard} aria-label={t("csTitle")}>
          <h3 className={s.csTitle}>{t("csTitle")}</h3>
          <dl className={s.csList}>
            <div>
              <dt>{contact.consultTel}</dt>
              <dd>
                <a href={phone.href}>{phone.display}</a>
              </dd>
            </div>
            <div>
              <dt>{contact.mobile}</dt>
              <dd>
                <a href={mobile.href}>{mobile.display}</a>
              </dd>
            </div>
            <div>
              <dt>{contact.fax}</dt>
              <dd>{fax.display}</dd>
            </div>
            <div>
              <dt>{contact.email}</dt>
              <dd>
                <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
