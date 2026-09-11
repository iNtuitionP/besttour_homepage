"use client";

/**
 * 모바일 메뉴 토글 (P2-3) — 헤더에서 상태가 필요한 유일한 조각.
 *
 * Header 전체를 클라이언트로 만들지 않기 위해 버튼과 패널만 여기로 뗐다.
 * 라벨은 서버 부모가 props 로 넣어 준다(이 파일에 한글 리터럴 0건).
 *
 * 열려 있는 동안:
 *   - ESC 로 닫힌다 (키보드 사용자가 갇히지 않는다)
 *   - 배경 스크롤을 잠근다 (패널이 길어 뒤 페이지가 따라 움직이면 방향을 잃는다)
 *   - 링크를 누르면 스스로 닫힌다 (Nav 의 onNavigate)
 */

import { useEffect, useState } from "react";

import type { MenuItem } from "@/lib/legacy-menu-map";

import Nav from "./Nav";
import styles from "./Header.module.css";

const PANEL_ID = "site-mobile-menu";

type MobileMenuProps = {
  items: readonly MenuItem[];
  labels: { open: string; close: string; nav: string };
};

export default function MobileMenu({ items, labels }: MobileMenuProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={styles.burger}
        aria-label={open ? labels.close : labels.open}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className={styles.burgerIcon} viewBox="0 0 24 24" aria-hidden="true">
          {open ? <path d="M6 6 18 18M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      <div id={PANEL_ID} className={styles.panel} hidden={!open}>
        <Nav
          items={items}
          ariaLabel={labels.nav}
          classes={{
            list: styles.panelList,
            link: styles.panelLink,
            disabled: styles.panelDisabled,
            current: styles.panelLinkCurrent,
          }}
          onNavigate={() => setOpen(false)}
        />
      </div>
    </>
  );
}
