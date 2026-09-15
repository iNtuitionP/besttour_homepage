/**
 * /about — 회사소개 · 인사말 + #location 찾아오시는 길 (P6-3). 서버 컴포넌트, SSG + ISR(revalidate 600).
 *
 * 인사말은 홈 CompanyIntro(home.company lead·body)를 그대로 재사용하고, 옛 사이트 원문(docs/ops/legacy-content-inventory.md §2 H2)
 * 중 안전한 2문장만 `extra` 로 덧붙인다(ko.json pages.about.more). "한해 70만 명 이상 외국인 관광객"(실증 불가 수치)·
 * "큰 사고 하나 없었던"(실증 불가 안전 주장)·"외국인 관광객을 모시고 국토여행"(BM 노출) 문장은 옮기지 않는다 — 브리프 §/about.
 * 서명은 CompanyIntro 가 원장 COMPANY.representative 로 렌더한다.
 *
 * 회사 정보 표는 원장 COMPANY 필드 + LEGAL_LABELS 라벨만(리터럴 0) — 법정 페이지의 LegalRecordList 재사용. "{년}년부터" 는
 * 원장 establishedYear(등록증 개업일) 보간(home.trust.since 재사용) — 연차("N년")는 표시하지 않는다.
 * #location: 주소는 원장, 지도 임베드 없음(아래 TEMP 마커). 카카오맵·네이버 지도 **검색 URL** 에 주소를 인코딩한 외부 링크만
 * 건다(API 키 불필요). 대중교통 안내는 확인된 정보가 없어 쓰지 않는다.
 * 요청 시점 API(headers·cookies·searchParams) 사용 0 — 정적 렌더.
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CompanyIntro } from "@/components/home/CompanyIntro";
import { SectionHead } from "@/components/home/SectionHead";
import { LegalRecordList } from "@/components/legal/LegalTable";
import { menuLabel } from "@/components/pages/menu-label";
import { PageHeader } from "@/components/pages/PageHeader";
import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";
import { canonicalUrl } from "@/lib/site-url";

import h from "@/components/home/home.module.css";
import p from "@/components/pages/pages.module.css";

/** ISR 주기(초) — 홈과 동일. */
export const revalidate = 600;

// [TEMP] ABOUT.mapEmbed: 카카오/네이버 지도 임베드는 API 키·약관 미확인으로 보류 — 검색 URL 외부 링크만 건다. 컨트롤러가 P7 에서 결정.
const KAKAO_MAP_SEARCH = "https://map.kakao.com/link/search/";
const NAVER_MAP_SEARCH = "https://map.naver.com/p/search/";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.about.meta" });
  return {
    title: t("title", { brand: COMPANY.brandName }),
    description: t("description"),
    // 옛 URL 301 이 `?bo_page=greeting`·`?bo_page=map` 을 데려온다 — 정본은 쿼리 없는 `/about` 하나다.
    alternates: { canonical: canonicalUrl("/about") },
  };
}

export default async function AboutPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, tc, tCompany, tTrust] = await Promise.all([
    getTranslations("pages.about"),
    getTranslations("pages.common"),
    getTranslations("home.company"),
    getTranslations("home.trust"),
  ]);
  const footer = LEGAL_LABELS.footer;
  const contact = LEGAL_LABELS.contact;

  // 회사 정보 표 — 라벨은 원장 LEGAL_LABELS, 값은 원장 COMPANY. 빈 값 행은 LegalRecordList 가 뺀다.
  const factLabels = {
    legalName: footer.operator,
    representative: footer.representative,
    bizRegNo: footer.bizRegNo,
    mailOrder: footer.mailOrder,
    since: t("facts.since"),
    headOffice: footer.headOffice,
    branch: footer.branch,
    tel: contact.tel,
    mobile: contact.mobile,
    fax: contact.fax,
    email: contact.email,
  } as const;
  const facts = {
    legalName: COMPANY.legalName,
    representative: COMPANY.representative,
    bizRegNo: COMPANY.bizRegNo,
    mailOrder: [COMPANY.mailOrderNo, COMPANY.mailOrderIssuer].filter((part) => part.trim() !== "").join(" "),
    // 숫자를 문자열로 넘긴다 — ICU 숫자 포맷이 "2,013" 으로 묶는 것을 막는다(TrustBar 와 동일).
    since: tTrust("since", { year: String(COMPANY.establishedYear) }),
    headOffice: COMPANY.address,
    branch: COMPANY.branchAddress,
    tel: COMPANY.tel,
    mobile: COMPANY.mobile,
    fax: COMPANY.fax,
    email: COMPANY.email,
  };

  const query = encodeURIComponent(COMPANY.address);
  const mapLinks = [
    { key: "kakao", href: `${KAKAO_MAP_SEARCH}${query}`, label: t("location.kakao") },
    { key: "naver", href: `${NAVER_MAP_SEARCH}${query}`, label: t("location.naver") },
  ];

  return (
    <main className={h.main} data-testid="about-page">
      <PageHeader
        navLabel={tc("breadcrumb")}
        homeLabel={tc("home")}
        current={menuLabel("about")}
        eyebrow={tCompany("eyebrow")}
        title={menuLabel("about")}
      />

      <CompanyIntro extra={t.raw("more") as string[]} />

      <section className={`${h.section} ${h.toneLav}`} aria-labelledby="facts-h" data-section="facts">
        <div className={h.wrap}>
          <SectionHead id="facts-h" eyebrow={footer.operator} title={footer.companyInfo} split={false} />
          <LegalRecordList labels={factLabels} records={[facts]} testId="company-facts" />
        </div>
      </section>

      <section
        id="location"
        className={`${h.section} ${h.toneWhite} ${p.anchor}`}
        aria-labelledby="location-h"
        data-section="location"
      >
        <div className={h.wrap}>
          <SectionHead
            id="location-h"
            eyebrow={footer.headOffice}
            title={menuLabel("location")}
            desc={t("location.desc")}
          />
          <div className={p.card} data-testid="location-card">
            <p className={p.lead}>{COMPANY.address}</p>
            {COMPANY.branchAddress.trim() !== "" ? (
              <p className={p.muted}>
                {footer.branch} · {COMPANY.branchAddress}
              </p>
            ) : null}
            <p className={p.actions}>
              {mapLinks.map((m) => (
                <a key={m.key} className={h.btnGhost} href={m.href} target="_blank" rel="noreferrer noopener">
                  {m.label} <span aria-hidden="true">↗</span>
                </a>
              ))}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
