"use client";

/**
 * 헤더 한 줄 + 모바일 메뉴 패널 (P2-3 · P2-6b) — 헤더에서 상태가 필요한 유일한 조각.
 *
 * 구조 (P2-6b — 목업 variant-08 의 `.hdr__in` / `.drawer` 와 같다):
 *   <div .inner>  ← 헤더 가로 flex 줄: 서버 Header 가 넘긴 children(로고·데스크톱 메뉴·예약·상담 전화·언어 전환) + 햄버거 버튼
 *   <div #panel>  ← 줄의 **형제**. 헤더 전체 폭으로 줄 바로 아래에 펼쳐진다.
 * 예전에는 패널이 줄 **안**(버튼 옆 flex 항목)에 있어 폭 지정 없이 오른쪽 32px 띠로 렌더됐다(90d0fc0 부터 ko·en 공통).
 * tests/header-locale.test.ts §1 이 TypeScript AST 로 "패널의 조상에 줄(.inner)이 없다"를 잠근다.
 *
 * Header 전체를 클라이언트로 만들지 않는다 — 줄의 내용은 서버 컴포넌트가 children 으로 넘긴다(RSC 가 그대로 렌더한다).
 * 라벨은 서버 부모가 props 로 넣어 준다(이 파일에 한글 리터럴 0건).
 *
 * 열려 있는 동안:
 *   - ESC 로 닫힌다 (키보드 사용자가 갇히지 않는다)
 *   - 패널·햄버거 밖을 누르면 닫힌다 (P2-6b 에 추가 — 예전에는 없었다)
 *   - 배경 스크롤을 잠근다 (패널이 길어 뒤 페이지가 따라 움직이면 방향을 잃는다)
 *   - 링크를 누르면 스스로 닫힌다 (Nav 의 onNavigate · 언어 전환 링크의 onNavigate)
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { MenuItem } from "@/lib/legacy-menu-map";

import LocaleSwitch from "./LocaleSwitch";
import Nav from "./Nav";
import styles from "./Header.module.css";

const PANEL_ID = "site-mobile-menu";

type MobileMenuProps = {
  items: readonly MenuItem[];
  /** 메뉴 키 → 현재 로케일의 라벨 — Nav 에 그대로 넘긴다 */
  itemLabels: Readonly<Record<string, string>>;
  labels: { open: string; close: string; nav: string };
  /**
   * 패널 맨 아래 전화 버튼 — 예약·상담 전화(P1-7). 서버 Header 가 lib/contact-phone 으로 만들어 넘긴다
   * (href = tel:+82… · label = "예약·상담 전화" / "Bookings & inquiries" · number = "010-…" / "+82 …"). 목업 variant-08 의 .drawer .btn 자리다.
   * 번호는 줄바꿈하지 않는다(영문 375px 에서 "+82 10-6362-" 로 끊겼다 — 실측) — 라벨과 번호 사이에서만 줄이 바뀐다.
   */
  call: { href: string; label: string; number: string };
  /** 헤더 줄의 나머지 — 로고 · 데스크톱 메뉴 · 예약·상담 전화 · 언어 전환(데스크톱). 서버 Header 가 넘긴다. */
  children: ReactNode;
};

export default function MobileMenu({ items, itemLabels, labels, call, children }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <>
      <div className={styles.inner}>
        {children}
        <button
          ref={buttonRef}
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
      </div>

      <div ref={panelRef} id={PANEL_ID} className={styles.panel} hidden={!open}>
        <p className={styles.panelLocale}>
          <LocaleSwitch className={styles.localeLink} onNavigate={() => setOpen(false)} />
        </p>
        <Nav
          items={items}
          labels={itemLabels}
          ariaLabel={labels.nav}
          classes={{
            list: styles.panelList,
            link: styles.panelLink,
            disabled: styles.panelDisabled,
            current: styles.panelLinkCurrent,
          }}
          onNavigate={() => setOpen(false)}
        />
        <a className={styles.panelCall} href={call.href} data-testid="mobile-menu-call">
          <span>{call.label}</span> <span className={styles.panelCallNumber}>{call.number}</span>
        </a>
      </div>
    </>
  );
}
