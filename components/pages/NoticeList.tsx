/**
 * 공지 목록 (P6-3 /notices) — 홈 NoticeSection 과 같은 행(카테고리 배지 · 제목 · 게시일, Sections.module.css)이지만
 * 제목이 상세(/notices/[id])로 가는 링크다. 서버 컴포넌트, fetch 없음. 문구·카테고리 라벨은 props 로만(한글 리터럴 0).
 * P7-4: 게시일의 보이는 글자는 공개 화면 공용 틀(lib/public-date.ts — ko "2026년 9월 22일" · en "Sep 22, 2026"), `<time dateTime>` 은
 * notice-date.ts 의 YYYY-MM-DD. 영문 화면에서는 사장님이 쓴 제목에 lang="ko"(koLang). 로케일·날짜 틀은 여기서 읽는다 — 페이지의 호출 모양은 그대로다.
 */
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { koLang } from "@/lib/i18n/ledger-ui";
import { formatPublicDate, publicDateLabels } from "@/lib/public-date";
import type { Notice } from "@/lib/types";

import { noticeDate } from "@/components/home/notice-date";
import s from "@/components/home/Sections.module.css";
import p from "./pages.module.css";

export async function NoticeList({
  notices,
  categories,
  label,
}: {
  notices: readonly Notice[];
  /** 카테고리 코드 → 라벨 (ko.json home.notice.category). 없는 코드는 코드 그대로 보여 준다. */
  categories: Readonly<Record<string, string | undefined>>;
  label: string;
}) {
  const [tCommon, locale] = await Promise.all([getTranslations("common"), getLocale()]);
  const dates = publicDateLabels(tCommon.raw("dates"));
  const lang = koLang(locale);
  return (
    <ul className={s.notices} aria-label={label} data-testid="notice-list">
      {notices.map((n) => {
        const date = noticeDate(n.publishedAt);
        return (
          <li key={n.id} className={s.noticeItem}>
            <span className={s.noticeCat}>{categories[n.category] ?? n.category}</span>
            <Link className={`${s.noticeTitle} ${p.noticeLink}`} href={`/notices/${n.id}`} lang={lang}>
              {n.title}
            </Link>
            <time className={s.noticeDate} dateTime={date}>
              {formatPublicDate(date, dates, { style: "posted" }) ?? date}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
