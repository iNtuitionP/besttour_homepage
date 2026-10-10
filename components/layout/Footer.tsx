/**
 * 공개 푸터 (P2-3 · ADR-1 · ADR-5) — 서버 컴포넌트.
 *
 * 전화 (P1-7 · P7-5): 사이트의 전화번호는 예약·상담 전화 하나다(lib/contact-phone — ko 010-…, en +82 …). 로고 아래 큰 전화 링크와
 * 사업자 정보 블록(data-testid="footer-company-info")의 전화 줄(전자상거래법 §10① — 줄은 남긴다)이 같은 번호다.
 * 옛 대표전화·휴대전화 줄은 P7-5 에서 지웠다 — tests/contact-phone.test.ts 가 렌더에서 확인한다.
 *
 * 이 파일에는 한글 법정 리터럴이 한 글자도 없다. 상호·대표·등록번호·주소·계좌·보호책임자·
 * 계약·대금 주체 고지까지 전부 원장 lib/legal/disclosures.ts 에서 온다. 문구를 고쳐야 하면
 * 원장을 고친다 — 여기서 고치면 게이트(check-legal-disclosures)와 테스트가 막는다.
 *
 * 구조 — 스펙 §13.1(목업 variant-08 §FOOTER)에서 사장님 요청 5 · 결정 2(2026-10-10 · T2-1)로 바꿨다(스펙 §13.13):
 *   합자회사 베스트투어 사업자 정보(통신판매업 신고번호 바로 뒤에 '사업자정보 확인' 링크) → 주소·연락처·계좌 → 개인정보 보호책임자
 *   → (주)베스트모빌리티 정보 → 계약·대금 주체 고지(RELATED_COMPANY.note) → 법정 링크 → 메뉴
 *   - '운영사'·'관계사' 배지와 그 사이 점선을 걷었다. 두 회사를 가르는 것은 순서(베스트투어 먼저)와 맨 아래 고지 문장이다 —
 *     고지는 계약·개인정보 처리 주체(합자회사 베스트투어)와 대금 수령 주체((주)베스트모빌리티)를 이름으로 밝힌다(전자상거래법 §13①1호).
 *   - '사업자정보 확인'(공정위 조회 — wrkr_no 는 베스트투어 등록번호)을 법정 링크 줄에서 베스트투어 줄로 옮겼다. 배지가 없어진 뒤
 *     링크가 바로 앞의 베스트모빌리티 줄의 것으로 읽히지 않게 한다(계획 결정 2 ②의 오독 위험).
 *   - 로고(사장님 요청 2): 간판 브랜드 best mobility 가로형(public/brand/logo-bestmobility.png · alt = ledgerUi(locale).brand).
 *   - 접수 안내 verbatim(VERBATIM.bookingNotice)은 푸터에 두지 않는다(사장님 요청 7 · 결정 3-2, 2026-10-10 · T2-2) — 그 문장은
 *     견적 모달 제출 위 · 완료 화면 · 예약 확인 카드(접수 상태)에만 있다. 모든 쪽에 깔리는 푸터에서는 확정된 예약을 보는 손님에게도 읽힌다.
 *
 * 메뉴 열 (P7-6 사용자 결정): 회사 열 = 회사소개 하나(MENU_BY_GROUP.company) · 고객센터 열 = 공지사항 · 이용안내 · 갤러리
 * (+ env 가 있을 때 네이버 블로그 — MENU_BY_GROUP.support). 이용안내는 위 메뉴에서 빠지고 여기에만 남는다(거래조건 고지 접근성).
 *
 * 빈 값 규칙(P1-6 과 동일): 원장 필드가 "" 인 줄은 렌더하지 않는다. 미확인 값을 지어내지 않기로
 * 했으므로 빈 값이 실제로 들어올 수 있고, 그때 빈 칸이 화면에 남으면 안 된다.
 *
 * 로케일 (P2-6): 라벨·링크 제목·대표자는 ledgerUi(locale)(ko 는 원장 그대로).
 * 사업자 정보의 **값**(상호·주소·계좌·보호책임자·관계사 고지)은 원장 한국어 그대로다 — 영문판은 컨트롤러가 따로 확정한다.
 * en 에서는 그 블록 위에 컨트롤러 확정 안내를 두고, 한국어 값에 lang="ko" 를 단다(ko 화면은 둘 다 내지 않는다).
 * 전화번호 (P7-4): 팩스·보호책임자 연락처는 en 에서 +82 표기(localPhone — 원장 값은 그대로, 표시만). 전화 줄은 consultPhone(locale).
 */

import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";

import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { Link } from "@/i18n/navigation";
import { consultPhone, localPhone } from "@/lib/contact-phone";
import { koLang, ledgerUi } from "@/lib/i18n/ledger-ui";
import { COMPANY, LEGAL_LINKS, PAYMENT, RELATED_COMPANY } from "@/lib/legal/disclosures";
import { LEGACY_MENU, MENU_BY_GROUP } from "@/lib/legacy-menu-map";

import Nav from "./Nav";
import styles from "./Footer.module.css";

/** `ko: true` — 값이 원장 한국어다(en 에서 lang="ko" 를 단다). `external: true` — 사이트 밖 링크(새 창). */
type Fact = { label?: string; value: string; strong?: boolean; href?: string; external?: boolean; ko?: boolean };

/** 빈 값 줄은 지운다 — 원장에 "" 로 남겨 둔 미확인 필드가 화면에 빈 칸으로 새지 않도록 */
function present(facts: readonly Fact[]): Fact[] {
  return facts.filter((fact) => fact.value.trim() !== "");
}

function FactList({ facts, className, valueLang }: { facts: readonly Fact[]; className: string; valueLang?: string }) {
  return (
    <p className={className}>
      {present(facts).map((fact) => (
        <span className={styles.fact} key={`${fact.label ?? ""}-${fact.value}`}>
          {fact.label ? <span className={styles.factLabel}>{fact.label}</span> : null}
          {fact.href ? (
            <a
              className={styles.factLink}
              href={fact.href}
              {...(fact.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
            >
              {fact.value}
            </a>
          ) : (
            <span className={fact.strong ? styles.factStrong : undefined} lang={fact.ko ? valueLang : undefined}>
              {fact.value}
            </span>
          )}
        </span>
      ))}
    </p>
  );
}

export default async function Footer() {
  const [t, locale] = await Promise.all([getTranslations("layout"), getLocale()]);
  const ui = ledgerUi(locale);
  const labels = ui.labels.footer;
  const contactLabels = ui.labels.contact;
  const valueLang = koLang(locale);
  const menuLabels = Object.fromEntries(LEGACY_MENU.map((m) => [m.key, t(`menu.${m.key}`)]));
  const year = new Date().getFullYear();
  // 로고 아래 큰 전화 링크와 사업자 정보의 전화 줄은 같은 예약·상담 전화다(P1-7 · P7-5).
  const phone = consultPhone(locale);

  const operator: Fact[] = [
    { value: COMPANY.legalName, strong: true, ko: true },
    { label: labels.representative, value: ui.representative, ko: true },
    { label: labels.bizRegNo, value: COMPANY.bizRegNo },
    {
      label: labels.mailOrder,
      value: [COMPANY.mailOrderNo, COMPANY.mailOrderIssuer].filter((part) => part.trim() !== "").join(" "),
      ko: true,
    },
    // 통신판매업 신고번호 바로 뒤 — 이 링크가 조회하는 사업자(wrkr_no)는 합자회사 베스트투어다(결정 2 · T2-1). 새 창.
    { value: labels.ftcBizInfo, href: LEGAL_LINKS.ftcBizInfo, external: true },
  ];

  const contact: Fact[] = [
    { label: labels.headOffice, value: COMPANY.address, ko: true },
    { label: labels.branch, value: COMPANY.branchAddress, ko: true },
    { label: contactLabels.tel, value: phone.display },
    { label: contactLabels.fax, value: localPhone(COMPANY.fax, locale).display },
    { label: contactLabels.email, value: COMPANY.email, href: `mailto:${COMPANY.email}` },
    // 입금 계좌 — (주)베스트모빌리티 명의(P1-7 · A-5). 원장 문안이 "입금 계좌 :" 라벨과 예금주 실명을 스스로 담으므로 라벨을 따로 붙이지 않는다
    // ('· 관계사' 꼬리표는 결정 2 로 원장에서 뺐다).
    { value: PAYMENT.accountLine, ko: true },
  ];

  const officer: Fact[] = [
    { label: labels.privacyOfficer, value: COMPANY.privacyOfficer.name, strong: true, ko: true },
    { label: ui.labels.officer.phone, value: localPhone(COMPANY.privacyOfficer.phone, locale).display },
  ];

  const related: Fact[] = [
    { value: RELATED_COMPANY.legalName, strong: true, ko: true },
    { label: labels.representative, value: RELATED_COMPANY.representative, ko: true },
    { label: labels.bizRegNo, value: RELATED_COMPANY.bizRegNo },
    { value: RELATED_COMPANY.address, ko: true },
  ];

  const hosting = present([{ label: labels.hosting, value: COMPANY.hostingProvider }]);

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brandCol}>
            <Image
              className={styles.logo}
              src="/brand/logo-bestmobility.png"
              alt={ui.brand}
              width={215}
              height={27}
            />
            <a className={styles.tel} href={phone.href} aria-label={`${contactLabels.consultTel} ${phone.display}`}>
              {phone.display}
            </a>
          </div>

          <div className={styles.menuCol}>
            <h2 className={styles.colTitle}>{t("menuHeading")}</h2>
            <Nav
              items={MENU_BY_GROUP.company}
              labels={menuLabels}
              ariaLabel={t("menuHeading")}
              classes={{ list: styles.menuList, link: styles.menuLink, disabled: styles.menuDisabled }}
            />
          </div>

          <div className={styles.menuCol}>
            <h2 className={styles.colTitle}>{t("supportHeading")}</h2>
            <Nav
              items={MENU_BY_GROUP.support}
              labels={menuLabels}
              ariaLabel={t("supportHeading")}
              classes={{ list: styles.menuList, link: styles.menuLink, disabled: styles.menuDisabled }}
            />
          </div>
        </div>

        <section className={styles.legal} aria-label={labels.companyInfo} data-testid="footer-company-info">
          <OfficialKoreanNotice notice={ui.officialNotice} />
          <FactList facts={operator} className={styles.row} valueLang={valueLang} />
          <FactList facts={contact} className={styles.row} valueLang={valueLang} />
          <FactList facts={officer} className={styles.row} valueLang={valueLang} />
          {/* 두 번째 회사 줄 — 배지·점선 없이 위 줄과 조금 띄운다(사장님 요청 5) */}
          <FactList facts={related} className={`${styles.row} ${styles.rowNextCompany}`} valueLang={valueLang} />

          <p className={styles.note} lang={valueLang}>
            {RELATED_COMPANY.note}
          </p>
        </section>

        <nav className={styles.legalNav} aria-label={ui.labels.legalNav}>
          <ul className={styles.legalLinks}>
            <li>
              <Link className={styles.legalLink} href={LEGAL_LINKS.privacy}>
                {ui.pages.privacy}
              </Link>
            </li>
            <li>
              <Link className={styles.legalLink} href={LEGAL_LINKS.terms}>
                {ui.pages.terms}
              </Link>
            </li>
            <li>
              <Link className={styles.legalLink} href={LEGAL_LINKS.guide}>
                {ui.pages.guide}
              </Link>
            </li>
          </ul>
        </nav>

        <p className={styles.meta}>
          {hosting.map((fact) => (
            <span className={styles.fact} key={fact.value}>
              <span className={styles.factLabel}>{fact.label}</span>
              <span>{fact.value}</span>
            </span>
          ))}
          {/* ko 마크업은 이전과 같게(감싸는 span 없이) — en 에서만 한국어 상호에 lang="ko" 를 단다 */}
          <span className={styles.fact}>
            © {year} {valueLang ? <span lang={valueLang}>{COMPANY.legalName}</span> : COMPANY.legalName}
          </span>
        </p>
      </div>
    </footer>
  );
}
