/**
 * /notices/[id] — 공지 상세 (P6-3). 서버 컴포넌트, 동적 세그먼트 + ISR(revalidate 600, dynamicParams true).
 *
 * generateStaticParams 는 쓰지 않는다 — 공지는 늘어난다. 첫 요청에 렌더해 캐시하고 10분마다 재검증한다.
 * getNotice(id): 라우트 파라미터 형식(serial 양의 정수)이 틀리면 DB 에 가지 않고 null, 부재·미공개(active=false 는 RLS 가
 * 가린다)도 null → notFound() → (site)/not-found.tsx(헤더·푸터 상속, <html lang> 은 로케일 레이아웃).
 * 본문은 **plain text 를 문단으로만**(splitParagraphs — \n\n 분리, HTML 해석 0). React 의 raw-HTML 주입 prop 은 쓰지 않는다 — admin 입력이다.
 * generateMetadata 와 페이지가 같은 요청에서 한 번만 조회하도록 React cache 로 감싼다(캐시 계층이 아니라 요청 내 dedupe).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cache } from "react";

import { noticeDate } from "@/components/home/notice-date";
import { menuLabel } from "@/components/pages/menu-label";
import { PageHeader } from "@/components/pages/PageHeader";
import { splitParagraphs } from "@/components/pages/paragraphs";
import { Link } from "@/i18n/navigation";
import { COMPANY } from "@/lib/legal/disclosures";
import { getNotice } from "@/lib/queries";

import h from "@/components/home/home.module.css";
import s from "@/components/home/Sections.module.css";
import p from "@/components/pages/pages.module.css";

/** ISR 주기(초) — 목록과 동일. */
export const revalidate = 600;
/** 빌드 시 알 수 없는 id 도 요청 시 렌더한다(공지는 늘어난다). 없는 id 는 notFound(). */
export const dynamicParams = true;

type Params = Promise<{ locale: string; id: string }>;

/** 같은 요청 안에서 generateMetadata 와 페이지가 조회를 한 번만 하도록 (요청 스코프 dedupe). */
const getNoticeOnce = cache((id: string) => getNotice(id));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, id } = await params;
  const [notice, t, tList] = await Promise.all([
    getNoticeOnce(id),
    getTranslations({ locale, namespace: "pages.notices.detail.meta" }),
    getTranslations({ locale, namespace: "pages.notices.meta" }),
  ]);
  if (!notice) {
    // 404 문서의 제목 — 목록 제목으로. 색인 금지.
    return { title: tList("title", { brand: COMPANY.brandName }), robots: { index: false, follow: false } };
  }
  return {
    title: t("title", { title: notice.title, brand: COMPANY.brandName }),
    description: t("description"),
  };
}

export default async function NoticeDetailPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const notice = await getNoticeOnce(id);
  if (!notice) notFound();

  const [t, tc, tNotice] = await Promise.all([
    getTranslations("pages.notices.detail"),
    getTranslations("pages.common"),
    getTranslations("home.notice"),
  ]);
  const categories = tNotice.raw("category") as Record<string, string | undefined>;
  const date = noticeDate(notice.publishedAt);
  const paragraphs = splitParagraphs(notice.body);

  return (
    <main className={h.main} data-testid="notice-detail-page">
      <PageHeader
        navLabel={tc("breadcrumb")}
        homeLabel={tc("home")}
        crumbs={[{ href: "/notices", label: menuLabel("notices") }]}
        current={notice.title}
        eyebrow={menuLabel("notices")}
        title={notice.title}
      />

      <section className={`${h.section} ${h.toneWhite}`} data-section="notice-detail">
        <div className={h.wrap}>
          <article className={`${p.card} ${p.prose}`} data-testid="notice-article" data-notice-id={notice.id}>
            <div className={p.articleHead}>
              <p className={p.articleMeta}>
                <span className={s.noticeCat}>{categories[notice.category] ?? notice.category}</span>
                <span>
                  {t("publishedAt")} <time dateTime={date}>{date}</time>
                </span>
              </p>
            </div>
            <div data-testid="notice-body">
              {paragraphs.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
            <div className={p.articleFoot}>
              <Link className={h.btnGhost} href="/notices">
                {t("back")}
              </Link>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
