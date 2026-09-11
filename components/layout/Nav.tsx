"use client";

/**
 * 헤더·푸터·모바일 패널이 공용으로 쓰는 메뉴 렌더러 (P2-3).
 *
 * 클라이언트인 이유는 하나뿐이다 — 현재 경로 표시(aria-current="page")에 usePathname 이 필요하다.
 * 법정 문구는 여기 오지 않는다(원장 import 0건, tests/layout.test.ts 가 단언한다). 라벨은
 * lib/legacy-menu-map.ts 에서 오고, 클래스와 aria-label 은 서버 부모가 props 로 넣어 준다.
 *
 * 렌더 규칙 — 순서가 곧 정책이다
 *   1. 외부 링크인데 URL(env)이 없다  → 항목 자체를 숨긴다. 죽은 링크를 배포하지 않는다.
 *   2. ready:false                     → <span aria-disabled="true">. 404 로 보내지 않는다.
 *   3. 그 외                           → 링크. 내부는 i18n Link(로케일 프리픽스), 외부는 <a>.
 */

import { Link, usePathname } from "@/i18n/navigation";
import type { MenuItem } from "@/lib/legacy-menu-map";

export type NavClasses = {
  list: string;
  link: string;
  disabled: string;
  current?: string;
};

type NavProps = {
  items: readonly MenuItem[];
  classes: NavClasses;
  ariaLabel: string;
  /** 모바일 패널이 링크 클릭 후 스스로 닫을 때 쓴다 */
  onNavigate?: () => void;
};

export default function Nav({ items, classes, ariaLabel, onNavigate }: NavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label={ariaLabel}>
      <ul className={classes.list}>
        {items.map((item) => {
          if (item.external && item.href === "") return null;

          if (!item.ready) {
            return (
              <li key={item.key}>
                <span className={classes.disabled} aria-disabled="true">
                  {item.labelKo}
                </span>
              </li>
            );
          }

          if (item.external) {
            return (
              <li key={item.key}>
                <a className={classes.link} href={item.href} target="_blank" rel="noreferrer noopener">
                  {item.labelKo}
                </a>
              </li>
            );
          }

          const isCurrent = pathname === item.href.split("#")[0];
          const className = isCurrent && classes.current ? `${classes.link} ${classes.current}` : classes.link;

          return (
            <li key={item.key}>
              <Link
                className={className}
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                onClick={onNavigate}
              >
                {item.labelKo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
