/**
 * /about — 회사소개 · 인사말 + #location 찾아오시는 길 (P6-3). 서버 컴포넌트, SSG + ISR(revalidate 600).
 * P7-6: 메뉴는 "회사소개" 하나로 이 페이지를 가리킨다(찾아오시는 길 메뉴 항목은 사용자 결정으로 지웠다 — 구역은 그대로).
 * 그래서 페이지 제목은 메뉴 라벨(layout.menu.about), 찾아오시는 길 구역 제목은 이 페이지 카탈로그(pages.about.location.title)다.
 *
 * 인사말은 홈 CompanyIntro(home.company lead·body)를 그대로 재사용하고, 옛 사이트 원문(docs/ops/legacy-content-inventory.md §2 H2)
 * 중 안전한 2문장만 `extra` 로 덧붙인다(ko.json pages.about.more). "한해 70만 명 이상 외국인 관광객"(실증 불가 수치)·
 * "큰 사고 하나 없었던"(실증 불가 안전 주장)·"외국인 관광객을 모시고 국토여행"(BM 노출) 문장은 옮기지 않는다 — 브리프 §/about.
 * 서명은 CompanyIntro 가 원장 대표자로 렌더한다.
 *
 * 회사 정보 표는 원장 COMPANY 필드 + 원장 라벨만(리터럴 0) — 법정 페이지의 LegalRecordList 재사용. 개업 값 "{년}년" 은
 * 원장 establishedYear(등록증 개업일) 보간(pages.about.facts.sinceValue) — 연차("N년")는 표시하지 않는다.
 * 사장님 요청 9(2026-10-10): 표의 값은 "2013년부터" 가 아니라 "2013년". 홈 신뢰 바(home.trust.since "2013년부터")는 그대로다.
 * 사장님 요청 3(2026-10-10): 페이지 머리와 인사말 구역의 작은 글씨 소제목 "회사소개" 를 뺐다(h1·h2 는 남김) —
 * PageHeader 에 eyebrow 를 넘기지 않고 CompanyIntro 에 showEyebrow={false} 를 넘긴다(tests/about-owner-requests.test.ts).
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
import { consultPhone, localPhone } from "@/lib/contact-phone";
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

  const [t, tc, tMenu] = await Promise.all([
    getTranslations("pages.about"),
    getTranslations("pages.common"),
    getTranslations("layout.menu"),
  ]);
  const ui = ledgerUi(locale);
  const footer = ui.labels.footer;
  const contact = ui.labels.contact;
  const valueLang = koLang(locale);

  // 회사 정보 표 — 라벨은 원장 라벨(ledgerUi), 값은 원장 COMPANY. 빈 값 행은 LegalRecordList 가 뺀다.
  // 전화 줄은 예약·상담 전화(P1-7 — en 은 +82 표기) — 사이트의 전화번호는 이것 하나다(P7-5 — 휴대전화 줄은 지웠다).
  // 상호 행 라벨은 '운영사'(원장 footer.operator) 대신 이 페이지 카탈로그의 '상호'(pages.about.facts.legalName) — 사장님 요청 5 · 결정 2(2026-10-10):
  // 화면에서 '운영사'·'관계사' 꼬리표를 걷는다. 값은 법정 상호(합자회사 베스트투어) 그대로다.
  const factLabels = {
    legalName: t("facts.legalName"),
    representative: footer.representative,
    bizRegNo: footer.bizRegNo,
    mailOrder: footer.mailOrder,
    since: t("facts.since"),
    headOffice: footer.headOffice,
    branch: footer.branch,
    consultTel: contact.consultTel,
    fax: contact.fax,
    email: contact.email,
  } as const;
  const facts = {
    legalName: COMPANY.legalName,
    representative: ui.representative,
    bizRegNo: COMPANY.bizRegNo,
    mailOrder: [COMPANY.mailOrderNo, COMPANY.mailOrderIssuer].filter((part) => part.trim() !== "").join(" "),
    // 숫자를 문자열로 넘긴다 — ICU 숫자 포맷이 "2,013" 으로 묶는 것을 막는다(TrustBar 와 동일).
    since: t("facts.sinceValue", { year: String(COMPANY.establishedYear) }),
    headOffice: COMPANY.address,
    branch: COMPANY.branchAddress,
    consultTel: consultPhone(locale).display,
    // 팩스 — en 은 +82 표기(P7-4 · localPhone — 원장 값은 그대로, 표시만)
    fax: localPhone(COMPANY.fax, locale).display,
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
        title={tMenu("about")}
      />

      <CompanyIntro extra={t.raw("more") as string[]} showEyebrow={false} />

      <section className={`${h.section} ${h.toneLav}`} aria-labelledby="facts-h" data-section="facts">
        <div className={h.wrap}>
          {/* 소제목 없음 — 예전 소제목 '운영사' 를 걷었다(사장님 요청 5). 제목(사업자 정보)은 남는다 */}
          <SectionHead id="facts-h" title={footer.companyInfo} split={false} />
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
            title={t("location.title")}
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
