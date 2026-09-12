/**
 * 섹션 9 — 공지 + 고객센터 (#notice, 목업 variant-08 §07). 서버 컴포넌트.
 * 원격 notices 가 비어 있으면 **섹션 자체를 숨긴다**(빈 목록 금지 — 고객센터 카드도 함께; 연락처는 푸터에 있다).
 * 날짜는 KST 달력 날짜(toKstDateString). 공지 상세(/notices)는 P4 — 지금은 링크 없는 목록이다.
 * 고객센터 카드의 라벨·연락처는 원장(LEGAL_LABELS.contact · COMPANY)에서만 온다.
 */
import { getTranslations } from "next-intl/server";

import { toKstDateString } from "@/lib/kst";
import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";
import type { Notice } from "@/lib/types";

import h from "./home.module.css";
import s from "./Sections.module.css";
import { RICH } from "./rich";
import { SectionHead } from "./SectionHead";

/** date 컬럼 "YYYY-MM-DD" 든 timestamptz 든 KST 달력 날짜로 — 파싱 불가 값은 그대로 보여 준다(페이지를 죽이지 않는다). */
function noticeDate(value: string): string {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? value : toKstDateString(instant);
}

export async function NoticeSection({ notices }: { notices: readonly Notice[] }) {
  if (notices.length === 0) return null;
  const t = await getTranslations("home.notice");
  const categories = t.raw("category") as Record<string, string | undefined>;
  const contact = LEGAL_LABELS.contact;

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
                  <span className={s.noticeTitle}>{n.title}</span>
                  <time className={s.noticeDate} dateTime={date}>
                    {date}
                  </time>
                </li>
              );
            })}
          </ul>
        </div>

        <aside className={s.cscard} aria-label={t("csTitle")}>
          <h3 className={s.csTitle}>{t("csTitle")}</h3>
          <dl className={s.csList}>
            <div>
              <dt>{contact.tel}</dt>
              <dd>
                <a href={`tel:${COMPANY.tel}`}>{COMPANY.tel}</a>
              </dd>
            </div>
            <div>
              <dt>{contact.mobile}</dt>
              <dd>
                <a href={`tel:${COMPANY.mobile}`}>{COMPANY.mobile}</a>
              </dd>
            </div>
            <div>
              <dt>{contact.fax}</dt>
              <dd>{COMPANY.fax}</dd>
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
