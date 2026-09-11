/**
 * 공개 푸터 (P2-3 · ADR-1 · ADR-5) — 서버 컴포넌트.
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
 */

import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import {
  COMPANY,
  LEGAL_LABELS,
  LEGAL_LINKS,
  LEGAL_PAGES,
  RELATED_COMPANY,
  VERBATIM,
} from "@/lib/legal/disclosures";
import { MENU_BY_GROUP } from "@/lib/legacy-menu-map";

import Nav from "./Nav";
import styles from "./Footer.module.css";

type Fact = { label?: string; value: string; strong?: boolean; href?: string };

/** 빈 값 줄은 지운다 — 원장에 "" 로 남겨 둔 미확인 필드가 화면에 빈 칸으로 새지 않도록 */
function present(facts: readonly Fact[]): Fact[] {
  return facts.filter((fact) => fact.value.trim() !== "");
}

function FactList({ facts, className }: { facts: readonly Fact[]; className: string }) {
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
            <span className={fact.strong ? styles.factStrong : undefined}>{fact.value}</span>
          )}
        </span>
      ))}
    </p>
  );
}

export default async function Footer() {
  const t = await getTranslations("layout");
  const labels = LEGAL_LABELS.footer;
  const year = new Date().getFullYear();

  const operator: Fact[] = [
    { value: COMPANY.legalName, strong: true },
    { label: labels.representative, value: COMPANY.representative },
    { label: labels.bizRegNo, value: COMPANY.bizRegNo },
    {
      label: labels.mailOrder,
      value: [COMPANY.mailOrderNo, COMPANY.mailOrderIssuer].filter((part) => part.trim() !== "").join(" "),
    },
  ];

  const contact: Fact[] = [
    { label: labels.headOffice, value: COMPANY.address },
    { label: labels.branch, value: COMPANY.branchAddress },
    { label: LEGAL_LABELS.contact.tel, value: COMPANY.tel },
    { label: LEGAL_LABELS.contact.mobile, value: COMPANY.mobile },
    { label: LEGAL_LABELS.contact.fax, value: COMPANY.fax },
    { label: LEGAL_LABELS.contact.email, value: COMPANY.email, href: `mailto:${COMPANY.email}` },
    { label: labels.bankAccount, value: COMPANY.bankAccount },
  ];

  const officer: Fact[] = [
    { label: labels.privacyOfficer, value: COMPANY.privacyOfficer.name, strong: true },
    { label: LEGAL_LABELS.officer.phone, value: COMPANY.privacyOfficer.phone },
  ];

  const related: Fact[] = [
    { value: RELATED_COMPANY.legalName, strong: true },
    { label: labels.representative, value: RELATED_COMPANY.representative },
    { label: labels.bizRegNo, value: RELATED_COMPANY.bizRegNo },
    { value: RELATED_COMPANY.address },
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
              alt={COMPANY.brandName}
              width={165}
              height={32}
            />
            <a
              className={styles.tel}
              href={`tel:${COMPANY.tel}`}
              aria-label={`${LEGAL_LABELS.contact.tel} ${COMPANY.tel}`}
            >
              {COMPANY.tel}
            </a>
          </div>

          <div className={styles.menuCol}>
            <h2 className={styles.colTitle}>{t("menuHeading")}</h2>
            <Nav
              items={MENU_BY_GROUP.company}
              ariaLabel={t("menuHeading")}
              classes={{ list: styles.menuList, link: styles.menuLink, disabled: styles.menuDisabled }}
            />
          </div>

          <div className={styles.menuCol}>
            <h2 className={styles.colTitle}>{t("supportHeading")}</h2>
            <Nav
              items={MENU_BY_GROUP.support}
              ariaLabel={t("supportHeading")}
              classes={{ list: styles.menuList, link: styles.menuLink, disabled: styles.menuDisabled }}
            />
          </div>
        </div>

        <section className={styles.legal} aria-label={labels.companyInfo}>
          <p className={styles.badgeRow}>
            <span className={styles.badge}>{labels.operator}</span>
          </p>
          <FactList facts={operator} className={styles.row} />
          <FactList facts={contact} className={styles.row} />
          <FactList facts={officer} className={styles.row} />

          <div className={styles.related}>
            <p className={styles.badgeRow}>
              <span className={styles.badgeRelated}>{RELATED_COMPANY.role}</span>
            </p>
            <FactList facts={related} className={styles.row} />
          </div>

          <p className={styles.note}>{RELATED_COMPANY.note}</p>
          <p className={styles.note}>{VERBATIM.bookingNotice}</p>
        </section>

        <nav className={styles.legalNav} aria-label={LEGAL_LABELS.legalNav}>
          <ul className={styles.legalLinks}>
            <li>
              <Link className={styles.legalLink} href={LEGAL_LINKS.privacy}>
                {LEGAL_PAGES.privacy.title}
              </Link>
            </li>
            <li>
              <Link className={styles.legalLink} href={LEGAL_LINKS.terms}>
                {LEGAL_PAGES.terms.title}
              </Link>
            </li>
            <li>
              <Link className={styles.legalLink} href={LEGAL_LINKS.guide}>
                {LEGAL_PAGES.guide.title}
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
          <span className={styles.fact}>© {year} {COMPANY.legalName}</span>
        </p>
      </div>
    </footer>
  );
}
