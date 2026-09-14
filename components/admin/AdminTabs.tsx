"use client";
/**
 * 관리자 탭 네비게이션 (P5-3). 클라이언트인 이유는 하나뿐이다 — 현재 경로를 알아야 `aria-current="page"` 를 붙일 수 있다.
 * 개인정보는 props 에 없다(라벨·경로뿐): 서버 컴포넌트 props 는 dev 에서 HTML 로 직렬화된다(P3-5 리뷰 N-2).
 *
 * 아직 만들지 않은 탭은 링크가 아니라 `aria-disabled` 인 span 이다 — 링크하면 404 이고, 지우면 자리가 사라진다
 * (components/admin/tabs.ts 헤더). 스크린리더에는 `준비 중`이 함께 읽힌다.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AdminTabKey } from "./tabs";

import s from "./admin.module.css";

export interface AdminTabItem {
  key: AdminTabKey;
  href: string;
  ready: boolean;
  label: string;
}

export function AdminTabs({
  items,
  navLabel,
  comingSoonLabel,
}: {
  items: readonly AdminTabItem[];
  navLabel: string;
  comingSoonLabel: string;
}) {
  const pathname = usePathname();

  return (
    <nav className={s.tabs} aria-label={navLabel} data-testid="admin-tabs">
      <ul className={s.tabList}>
        {items.map((item) => {
          const current = item.ready && (pathname === item.href || pathname.startsWith(`${item.href}/`));
          return (
            <li key={item.key}>
              {item.ready ? (
                <Link
                  className={s.tab}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  data-current={current ? "true" : undefined}
                >
                  {item.label}
                </Link>
              ) : (
                <span className={s.tab} aria-disabled="true" data-ready="false">
                  {item.label}
                  <span className={s.tabNote}>{comingSoonLabel}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
