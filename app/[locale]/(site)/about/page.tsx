/**
 * /about — 회사소개 · 인사말 + #location 찾아오시는 길 (P6-3). 서버 컴포넌트, SSG + ISR(revalidate 600).
 *
 * 인사말은 홈 CompanyIntro(home.company lead·body)를 그대로 재사용하고, 옛 사이트 원문(docs/ops/legacy-content-inventory.md §2 H2)
 * 중 안전한 2문장만 `extra` 로 덧붙인다(ko.json pages.about.more). "한해 70만 명 이상 외국인 관광객"(실증 불가 수치)·
 * "큰 사고 하나 없었던"(실증 불가 안전 주장)·"외국인 관광객을 모시고 국토여행"(BM 노출) 문장은 옮기지 않는다 — 브리프 §/about.
 * 서명은 CompanyIntro 가 원장 대표자로 렌더한다.
 *
 * 회사 정보 표는 원장 COMPANY 필드 + 원장 라벨만(리터럴 0) — 법정 페이지의 LegalRecordList 재사용. "{년}년부터" 는
 * 원장 establishedYear(등록증 개업일) 보간(home.trust.since 재사용) — 연차("N년")는 표시하지 않는다.
 * #location: 주소는 원장, 지도 임베드 없음(아래 TEMP 마커). 카카오맵·네이버 지도 **검색 URL** 에 주소를 인코딩한 외부 링크만
 * 건다(API 키 불필요). 대중교통 안내는 확인된 정보가 없어 쓰지 않는다.
 * 요청 시점 API(headers·cookies·searchParams) 사용 0 — 정적 렌더.
 *
 * 로케일 (P2-6): 라벨·대표자·페이지 제목은 ledgerUi(locale) · messages(ko 는 원장·옛 메뉴 텍스트 그대로). 회사 정보 표의
 * **값**(상호·신고번호·주소)과 찾아오시는 길 주소는 원장 한국어 그대로다 — en 에서는 그 위에 컨트롤러 확정 안내를 두고 lang="ko".
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CompanyIntro } from "@/components/home/CompanyIntro";
import { SectionHead } from "@/components/home/SectionHead";
import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { LegalRecordList } from "@/components/legal/LegalTable";
import { PageHeader } from "@/components/pages/PageHeader";
import { consultPhone } from "@/lib/contact-phone";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { COMPANY } from "@/lib/legal/disclosures";
import { pageAlternates } from "@/lib/site-url";

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
    title: t("title", { brand: ledgerUi(locale).brand }),
    description: t("description"),
    // 옛 URL 301 이 `?bo_page=greeting`·`?bo_page=map` 을 데려온다 — 정본은 쿼리 없는 `/about`(en 은 `/en/about`) 하나다.
    alternates: pageAlternates("/about", locale),
  };
}

export default async function AboutPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, tc, tCompany, tTrust, tMenu] = await Promise.all([
    getTranslations("pages.about"),
    getTranslations("pages.common"),
    getTranslations("home.company"),
    getTranslations("home.trust"),
    getTranslations("layout.menu"),
  ]);
  const ui = ledgerUi(locale);
  const footer = ui.labels.footer;
  const contact = ui.labels.contact;
  const valueLang = koLang(locale);

  // 회사 정보 표 — 라벨은 원장 라벨(ledgerUi), 값은 원장 COMPANY. 빈 값 행은 LegalRecordList 가 뺀다.
  // 전화 줄은 예약·상담 전화(P1-7 — en 은 +82 표기). 대표전화 1566 은 푸터 사업자 정보 한 줄에만 남는다.
  const factLabels = {
    legalName: footer.operator,
    representative: footer.representative,
    bizRegNo: footer.bizRegNo,
    mailOrder: footer.mailOrder,
    since: t("facts.since"),
    headOffice: footer.headOffice,
    branch: footer.branch,
    consultTel: contact.consultTel,
    mobile: contact.mobile,
    fax: contact.fax,
    email: contact.email,
  } as const;
  const facts = {
    legalName: COMPANY.legalName,
    representative: ui.representative,
    bizRegNo: COMPANY.bizRegNo,
    mailOrder: [COMPANY.mailOrderNo, COMPANY.mailOrderIssuer].filter((part) => part.trim() !== "").join(" "),
    // 숫자를 문자열로 넘긴다 — ICU 숫자 포맷이 "2,013" 으로 묶는 것을 막는다(TrustBar 와 동일).
    since: tTrust("since", { year: String(COMPANY.establishedYear) }),
    headOffice: COMPANY.address,
    branch: COMPANY.branchAddress,
    consultTel: consultPhone(locale).display,
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
        current={tMenu("about")}
        eyebrow={tCompany("eyebrow")}
        title={tMenu("about")}
      />

      <CompanyIntro extra={t.raw("more") as string[]} />

      <section className={`${h.section} ${h.toneLav}`} aria-labelledby="facts-h" data-section="facts">
        <div className={h.wrap}>
          <SectionHead id="facts-h" eyebrow={footer.operator} title={footer.companyInfo} split={false} />
          <OfficialKoreanNotice notice={ui.officialNotice} />
          <LegalRecordList
            labels={factLabels}
            records={[facts]}
            testId="company-facts"
            valueLangs={{ legalName: valueLang, mailOrder: valueLang, headOffice: valueLang, branch: valueLang }}
          />
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
            title={tMenu("location")}
            desc={t("location.desc")}
          />
          <div className={p.card} data-testid="location-card">
            <OfficialKoreanNotice notice={ui.officialNotice} />
            <p className={p.lead} lang={valueLang}>
              {COMPANY.address}
            </p>
            {COMPANY.branchAddress.trim() !== "" ? (
              <p className={p.muted}>
                {footer.branch} · {valueLang ? <span lang={valueLang}>{COMPANY.branchAddress}</span> : COMPANY.branchAddress}
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
