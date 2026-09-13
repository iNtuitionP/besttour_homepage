/**
 * 서브페이지 머리 — 브레드크럼(홈 → [중간] → 현재) + eyebrow + h1 [+ 설명] (P6-3).
 * 스타일은 홈 섹션 헤드(home.module.css .eyebrow/.title/.desc)를 그대로 쓰고, 브레드크럼만 pages.module.css.
 * 문구는 props 로만 받는다 — 이 파일에 한글 리터럴 없음. 링크는 i18n Link(로케일 프리픽스).
 */
import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";

import h from "@/components/home/home.module.css";
import p from "./pages.module.css";

export interface Crumb {
  href: string;
  label: string;
}

export function PageHeader({
  navLabel,
  homeLabel,
  crumbs = [],
  current,
  eyebrow,
  title,
  desc,
}: {
  /** 브레드크럼 <nav> 의 aria-label */
  navLabel: string;
  /** 첫 항목(홈) 라벨 */
  homeLabel: string;
  /** 홈과 현재 사이의 중간 항목(상세 페이지의 목록 등) */
  crumbs?: readonly Crumb[];
  /** 현재 페이지 라벨 — 옛 메뉴 텍스트 그대로 */
  current: string;
  eyebrow: string;
  title: ReactNode;
  desc?: ReactNode;
}) {
  return (
    <header className={p.pageHead}>
      <div className={h.wrap}>
        <nav aria-label={navLabel}>
          <ol className={p.crumbs}>
            <li>
              <Link className={p.crumbLink} href="/">
                {homeLabel}
              </Link>
            </li>
            {crumbs.map((c) => (
              <li key={c.href}>
                <Link className={p.crumbLink} href={c.href}>
                  {c.label}
                </Link>
              </li>
            ))}
            <li>
              <span className={p.crumbCurrent} aria-current="page">
                {current}
              </span>
            </li>
          </ol>
        </nav>
        <p className={h.eyebrow}>{eyebrow}</p>
        <h1 className={h.title}>{title}</h1>
        {desc ? <p className={h.desc}>{desc}</p> : null}
      </div>
    </header>
  );
}
