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
 *
 * 로케일 (P2-6): 메뉴 라벨은 messages layout.menu(ko 는 LEGACY_MENU.labelKo 와 같은 글자 — tests/i18n-en.test.ts §5),
 * 로고 alt·대표전화 라벨은 ledgerUi(locale)(ko 는 원장 그대로, en 은 원장 영문 상호·en.json legal).
 */

import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { COMPANY } from "@/lib/legal/disclosures";
import { LEGACY_MENU } from "@/lib/legacy-menu-map";

import MobileMenu from "./MobileMenu";
import Nav from "./Nav";
import styles from "./Header.module.css";

export default async function Header() {
  const [t, locale] = await Promise.all([getTranslations("layout"), getLocale()]);
  const ui = ledgerUi(locale);
  const menuLabels = Object.fromEntries(LEGACY_MENU.map((m) => [m.key, t(`menu.${m.key}`)]));

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
            alt={ui.brand}
            width={165}
            height={32}
            priority
          />
        </Link>

        <div className={styles.nav} data-nav="primary">
          <Nav
            items={LEGACY_MENU}
            labels={menuLabels}
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
          aria-label={`${ui.labels.contact.tel} ${COMPANY.tel}`}
        >
          {COMPANY.tel}
        </a>

        <MobileMenu
          items={LEGACY_MENU}
          itemLabels={menuLabels}
          labels={{ open: t("menuOpen"), close: t("menuClose"), nav: t("mobileNav") }}
        />
      </div>
    </header>
  );
}
