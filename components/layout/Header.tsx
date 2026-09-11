/**
 * 공개 헤더 (P2-3 · ADR-1) — 서버 컴포넌트.
 *
 * 'use client' 는 여기 오지 않는다. 상태가 필요한 조각(MobileMenu)과 경로를 아는 조각(Nav)만
 * 클라이언트다. tests/layout.test.ts 가 파일명으로 그 경계를 단언한다.
 *
 * 담는 것은 셋뿐이다 — 로고 · 메뉴(LEGACY_MENU 10개 전부) · 대표전화.
 *   - 로고는 bestour 만. 관계사(best mobility) 로고는 헤더에 넣지 않는다(스펙 §13.1).
 *   - 목업 상단바의 "대표전화 · 연중무휴", "운행 13년" 같은 부가 문구는 옮기지 않는다.
 *     실증 불가 수치이고 C4 규칙 범위 밖이다(브리프 §1). 번호만 노출한다.
 *   - 메뉴는 한 항목도 지우지 않는다. 아직 없는 페이지는 링크가 아니라 비활성 텍스트로 나간다(Nav).
 */

import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";
import { LEGACY_MENU } from "@/lib/legacy-menu-map";

import MobileMenu from "./MobileMenu";
import Nav from "./Nav";
import styles from "./Header.module.css";

export default async function Header() {
  const t = await getTranslations("layout");

  return (
    <header className={styles.header}>
      <a className={styles.skip} href="#site-content">
        {t("skipToContent")}
      </a>

      <div className={styles.inner}>
        <Link className={styles.brand} href="/">
          <Image
            className={styles.logo}
            src="/brand/logo-bestour.png"
            alt={COMPANY.brandName}
            width={165}
            height={32}
            priority
          />
        </Link>

        <div className={styles.nav} data-nav="primary">
          <Nav
            items={LEGACY_MENU}
            ariaLabel={t("primaryNav")}
            classes={{
              list: styles.navList,
              link: styles.navLink,
              disabled: styles.navDisabled,
              current: styles.navLinkCurrent,
            }}
          />
        </div>

        <a
          className={styles.tel}
          href={`tel:${COMPANY.tel}`}
          aria-label={`${LEGAL_LABELS.contact.tel} ${COMPANY.tel}`}
        >
          {COMPANY.tel}
        </a>

        <MobileMenu
          items={LEGACY_MENU}
          labels={{ open: t("menuOpen"), close: t("menuClose"), nav: t("mobileNav") }}
        />
      </div>
    </header>
  );
}
