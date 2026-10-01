/**
 * 서브페이지 머리 — 브레드크럼(홈 → [중간] → 현재) + eyebrow + h1 [+ 설명] (P6-3).
 * 스타일은 홈 섹션 헤드(home.module.css .eyebrow/.title/.desc)를 그대로 쓰고, 브레드크럼만 pages.module.css.
 * 문구는 props 로만 받는다 — 이 파일에 한글 리터럴 없음. 링크는 i18n Link(로케일 프리픽스).
 * `contentLang`(P7-4): 현재 위치·제목·설명이 사장님이 쓴 글(공지 제목 · 앨범 제목·설명)일 때, 영문 화면에서 그 세 자리에 lang="ko" 를 단다
 * (페이지가 koLang(locale) 을 넘긴다 — ko 화면은 undefined 라 속성을 내지 않는다).
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
  contentLang,
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
  /** 현재 위치·제목·설명이 화면 언어와 다른 글(사장님이 쓴 한국어)일 때 그 언어 — koLang(locale). */
  contentLang?: string;
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
              <span className={p.crumbCurrent} aria-current="page" lang={contentLang}>
                {current}
              </span>
            </li>
          </ol>
        </nav>
        <p className={h.eyebrow}>{eyebrow}</p>
        <h1 className={h.title} lang={contentLang}>
          {title}
        </h1>
        {desc ? (
          <p className={h.desc} lang={contentLang}>
            {desc}
          </p>
        ) : null}
      </div>
    </header>
  );
}
