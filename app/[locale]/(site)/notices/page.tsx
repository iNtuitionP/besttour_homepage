/**
 * /notices — 공지사항 목록 (P6-3). 서버 컴포넌트, SSG + ISR(revalidate 600 — admin 이 공지를 바꾸면 10분 안에 반영).
 *
 * getNotices(50): 활성 공지를 게시일 내림차순으로. 행은 홈 NoticeSection 과 같은 모양(카테고리 배지 = home.notice.category 재사용 ·
 * 제목 · 게시일 KST)이지만 제목이 상세(/notices/[id])로 가는 링크다(NoticeList). 0건이면 빈 상태 문구(pages.notices.empty) —
 * 원격 notices 가 지금 0행이라 이 상태가 정답이다. 개인정보 0 · anon + RLS 읽기 전용 · 요청 시점 API 0.
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { NoticeList } from "@/components/pages/NoticeList";
import { PageHeader } from "@/components/pages/PageHeader";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { getNotices } from "@/lib/queries";
import { pageAlternates } from "@/lib/site-url";

import h from "@/components/home/home.module.css";
import p from "@/components/pages/pages.module.css";

/** ISR 주기(초) — 홈과 동일. */
export const revalidate = 600;

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.notices.meta" });
  return {
    title: t("title", { brand: ledgerUi(locale).brand }),
    description: t("description"),
    // 옛 게시판(`?bo_table=notice`)의 301 목적지 — 정본은 쿼리 없는 `/notices`(en `/en/notices`).
    alternates: pageAlternates("/notices", locale),
  };
}

export default async function NoticesPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // 목록 상한 50 — 공지는 늘어나므로 홈(5)보다 넉넉히. 그 이상은 페이지네이션이 생길 때(P4) 나눈다.
  const [notices, t, tc, tNotice, tMenu] = await Promise.all([
    getNotices(50),
    getTranslations("pages.notices"),
    getTranslations("pages.common"),
    getTranslations("home.notice"),
    getTranslations("layout.menu"),
  ]);
  const categories = tNotice.raw("category") as Record<string, string | undefined>;

  return (
    <main className={h.main} data-testid="notices-page">
      <PageHeader
        navLabel={tc("breadcrumb")}
        homeLabel={tc("home")}
        current={tMenu("notices")}
        eyebrow={tNotice("csTitle")}
        title={tMenu("notices")}
      />

      <section className={`${h.section} ${h.toneLav}`} data-section="notices">
        <div className={h.wrap}>
          {notices.length === 0 ? (
            <p className={p.empty} role="status" data-testid="notices-empty">
              {t("empty")}
            </p>
          ) : (
            <NoticeList notices={notices} categories={categories} label={t("listLabel")} />
          )}
        </div>
      </section>
    </main>
  );
}
