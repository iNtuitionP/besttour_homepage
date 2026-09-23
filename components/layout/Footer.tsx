/**
 * 공개 푸터 (P2-3 · ADR-1 · ADR-5) — 서버 컴포넌트.
 *
 * 전화 (P1-7): 로고 아래 큰 전화 링크는 예약·상담 전화(lib/contact-phone — ko 010-…, en +82 …). 대표전화 1566(COMPANY.tel)은
 * 사업자 정보 블록(data-testid="footer-company-info")의 "대표전화" 한 줄로만 남는다 — tests/contact-phone.test.ts 가 렌더에서 확인한다.
 *
 * 이 파일에는 한글 법정 리터럴이 한 글자도 없다. 상호·대표·등록번호·주소·계좌·보호책임자·
 * 관계사 문구·배지 라벨까지 전부 원장 lib/legal/disclosures.ts 에서 온다. 문구를 고쳐야 하면
 * 원장을 고친다 — 여기서 고치면 게이트(check-legal-disclosures)와 테스트가 막는다.
 *
 * 구조는 스펙 §13.1(목업 variant-08 §FOOTER)을 그대로 옮겼다:
 *   운영사 배지 + 사업자 정보 → 주소·연락처·계좌 → 개인정보 보호책임자
 *   → (점선) 관계사 배지 + 관계사 정보 → 처리 주체 고지 → 법정 링크 → 메뉴
 *
 * 빈 값 규칙(P1-6 과 동일): 원장 필드가 "" 인 줄은 렌더하지 않는다. 미확인 값을 지어내지 않기로
 * 했으므로 빈 값이 실제로 들어올 수 있고, 그때 빈 칸이 화면에 남으면 안 된다.
 *
 * 로케일 (P2-6): 라벨·배지·링크 제목·대표자·verbatim 은 ledgerUi(locale) · localizeVerbatim(ko 는 원장 그대로).
 * 사업자 정보의 **값**(상호·주소·계좌·보호책임자·관계사 고지)은 원장 한국어 그대로다 — 영문판은 컨트롤러가 따로 확정한다.
 * en 에서는 그 블록 위에 컨트롤러 확정 안내를 두고, 한국어 값에 lang="ko" 를 단다(ko 화면은 둘 다 내지 않는다).
 */

import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";

import { OfficialKoreanNotice } from "@/components/legal/OfficialKoreanNotice";
import { Link } from "@/i18n/navigation";
import { consultPhone } from "@/lib/contact-phone";
import { koLang, ledgerUi, localizeVerbatim } from "@/lib/i18n/ledger-ui";
import { COMPANY, LEGAL_LINKS, PAYMENT, RELATED_COMPANY, VERBATIM } from "@/lib/legal/disclosures";
import { LEGACY_MENU, MENU_BY_GROUP } from "@/lib/legacy-menu-map";

import Nav from "./Nav";
import styles from "./Footer.module.css";

/** `ko: true` — 값이 원장 한국어다(en 에서 lang="ko" 를 단다). */
type Fact = { label?: string; value: string; strong?: boolean; href?: string; ko?: boolean };

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
            <a className={styles.factLink} href={fact.href}>
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
  // 로고 아래 큰 전화 링크는 예약·상담 전화(P1-7). 대표전화 1566 은 아래 사업자 정보 블록의 한 줄로만 남는다.
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
  ];

  const contact: Fact[] = [
    { label: labels.headOffice, value: COMPANY.address, ko: true },
    { label: labels.branch, value: COMPANY.branchAddress, ko: true },
    { label: contactLabels.tel, value: COMPANY.tel },
    { label: contactLabels.mobile, value: COMPANY.mobile },
    { label: contactLabels.fax, value: COMPANY.fax },
    { label: contactLabels.email, value: COMPANY.email, href: `mailto:${COMPANY.email}` },
    // 입금 계좌 — 관계사 명의(P1-7 · A-5). 원장 문안이 "입금 계좌 :" 라벨과 예금주(관계사)를 스스로 담으므로 라벨을 따로 붙이지 않는다.
    { value: PAYMENT.accountLine, ko: true },
  ];

  const officer: Fact[] = [
    { label: labels.privacyOfficer, value: COMPANY.privacyOfficer.name, strong: true, ko: true },
    { label: ui.labels.officer.phone, value: COMPANY.privacyOfficer.phone },
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
              src="/brand/logo-bestour.png"
              alt={ui.brand}
              width={165}
              height={32}
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
          <p className={styles.badgeRow}>
            <span className={styles.badge}>{labels.operator}</span>
          </p>
          <FactList facts={operator} className={styles.row} valueLang={valueLang} />
          <FactList facts={contact} className={styles.row} valueLang={valueLang} />
          <FactList facts={officer} className={styles.row} valueLang={valueLang} />

          <div className={styles.related}>
            <p className={styles.badgeRow}>
              <span className={styles.badgeRelated}>{ui.relatedRole}</span>
            </p>
            <FactList facts={related} className={styles.row} valueLang={valueLang} />
          </div>

          <p className={styles.note} lang={valueLang}>
            {RELATED_COMPANY.note}
          </p>
          <p className={styles.note}>{localizeVerbatim(locale, VERBATIM.bookingNotice)}</p>
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
            <li>
              <a
                className={styles.legalLink}
                href={LEGAL_LINKS.ftcBizInfo}
                target="_blank"
                rel="noreferrer noopener"
              >
                {labels.ftcBizInfo}
              </a>
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
