"use client";
/**
 * 관리자 셸 — 메뉴 (P5-3 탭 줄 → P5-20 사이드바·탭 바 · 시안 docs/handoff/2026-09-27-admin-ux 셸 · 제안서 ⑥ 내비 결정).
 *
 * 한 벌의 마크업을 폭에 따라 보여 준다(CSS · components/admin/admin.module.css 「셸」):
 *   - ≥1024px **왼쪽 사이드바 248px** — 브랜드 · 홈 · 접수(새 접수 배지) / 묶음 "홈페이지": 공지 · 팝업 · 갤러리 · 대표 노선 /
 *     묶음 "기록": 발송 기록 · 통계 / 아래: "관리자 계정으로 로그인 중" · 홈페이지 보기(새 탭) · 로그아웃. 항목 높이 44px.
 *     묶음 이름은 스크린리더에 한 번만 읽힌다(보이는 이름 aria-hidden · 목록 aria-label — 리뷰 P2-9).
 *     현재 표시는 **옅은 면 + 왼쪽 4px 띠 + 굵은 글자**다 — 채운 보라(--action-primary-bg)는 버튼 전용이라 쓰지 않는다(시안 ⑤-0).
 *   - <1024px **위 제목줄 56px**(브랜드 · 홈페이지 보기 · 로그아웃 — P5-21 부터 스크롤해도 위에 붙어 있다) + **아래 탭 바 4개**
 *     (홈 · 접수 · 홈페이지 · 기록, 56px + safe area). "더보기" 탭은 없다 — 홈페이지·기록은 허브 화면(/admin/site · /admin/records)으로 간다.
 *     현재 표시는 보라 글자 + 위 3px 띠.
 * 항목·묶음·순서·현재 판정은 순수 모듈(components/admin/tabs.ts)이 정한다. 이 파일은 그리기만 한다.
 *
 * 클라이언트인 이유 — 현재 경로를 알아야 `aria-current` 를 붙일 수 있다(자기 경로는 "page", 그 아래 화면은 "true"). 그리고 P5-21 부터
 * 배지 보고(아래)를 받는 상태가 있다.
 * 개인정보는 props 에 없다(라벨·경로·배지 숫자뿐): 서버 컴포넌트 props 는 dev 에서 HTML 로 직렬화된다(P3-5 리뷰 N-2).
 * 새 접수 배지는 레이아웃이 게이트 **뒤**에 한 번 센 값이다(`badge` — null 이면 그리지 않는다). 숫자는 aria-hidden, 스크린리더에는
 * "새 접수 N건" 문장 하나(WordPress 메뉴 버블과 같은 방식).
 * P5-21(리뷰 P2-10 "두 숫자 금지"): 숫자를 그리는 화면(관리 홈 · 접수 목록)이 자기가 센 값을 보고한다(NavBadgeReport → 이 파일이 여는 context).
 * 메뉴는 레이아웃 값(`badge` · 센 시각 `badgeAt`)과 보고 중 **더 새로 센 쪽**을 두 자리(사이드바 · 탭 바) 모두에 그린다(tabs.ts pickNavBadge).
 *
 * 아직 만들지 않은 항목은 링크가 아니라 `aria-disabled` 인 span 이다 — 링크하면 404 이고, 지우면 자리가 사라진다
 * (components/admin/tabs.ts 헤더). 스크린리더에는 `준비 중`이 함께 읽힌다.
 *
 * **로그아웃이 여기 있다** (P5-11 · D5) — 사이드바 아래와 휴대폰 위 제목줄, 두 자리. 보호 구역의 모든 화면이 이 셸을 공유하므로
 * 사장님이 어느 화면에 계시든 나갈 수 있다. 형태는 반드시 **form 제출(POST)** 이다 — `<a href>` 로 만들면 브라우저·크롤러의
 * 프리페치가 사장님을 로그아웃시킨다. 서버액션(actions/admin/session.ts)이 첫 문장에서 게이트를 타므로 이 버튼은 인가를 스스로
 * 판단하지 않는다.
 *
 * **내 계정**(OF-T3-6 · 비밀번호 정하기·바꾸기 /admin/account)도 같은 두 자리에 있다 — 사이드바 아래는 "내 계정" 글자 링크,
 * 휴대폰 위 제목줄은 사람 아이콘 버튼(aria-label "내 계정"). 탭 항목(tabs.ts)이 아니라 계정 도구라 메뉴 목록에는 넣지 않았다.
 *
 * 본문 자리(`#admin-content`)는 건너뛰기 링크의 목적지다. 탭 바는 본문 **뒤**에 둔다 — 화면 아래에 붙어 있어도 읽는 순서는 본문이 먼저다.
 */
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { signOutAdmin } from "@/actions/admin/session";
import { ADMIN_ACCOUNT_PATH } from "@/lib/auth/adminLogin";

import { NavBadgeReportContext } from "./NavBadgeReport";
import {
  ADMIN_BADGE_TAB,
  ADMIN_NAV_GROUPS,
  currentMobileKey,
  mobileTabs,
  navMatch,
  pickNavBadge,
  type AdminHub,
  type AdminHubKey,
  type AdminTab,
  type AdminTabKey,
  type NavBadge,
  type TimedNavBadge,
} from "./tabs";

import s from "./admin.module.css";

export interface AdminNavItem extends AdminTab {
  label: string;
}

export interface AdminNavHub extends AdminHub {
  label: string;
}

export interface AdminNavLabels {
  navLabel: string;
  comingSoon: string;
  brand: string;
  account: string;
  /** 내 계정(비밀번호 변경) 링크 라벨 — OF-T3-6. */
  myAccount: string;
  siteLink: string;
  newWindow: string;
  skip: string;
  groups: Record<AdminHubKey, string>;
}

type IconKey = AdminTabKey | AdminHubKey | "external" | "account";

/** 선 아이콘(24 격자) — 시안의 아이콘과 같은 모양. 라벨이 늘 함께 붙는 장식이다(aria-hidden). */
const ICON_PATHS: Readonly<Record<IconKey, string>> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  reservations: "M4 4h16v16H4z M4 14h4l2 3h4l2-3h4",
  notices: "M4 9v6h3l7 4V5L7 9z M17.5 9.5a3.5 3.5 0 0 1 0 5",
  popups: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8 8h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z",
  gallery: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M11 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z M21 17l-5-5-9 8",
  routes: "M8.5 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M20.5 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5",
  notifications: "M4 5h16v11H9l-5 4z M8 10h8",
  stats: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  site: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M3 9h18 M7 6.5h.01 M10 6.5h.01",
  records: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  account: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4 21a8 8 0 0 1 16 0",
};

function Icon({ name, className }: { name: IconKey; className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** 새 접수 배지 — 숫자는 aria-hidden, 스크린리더에는 문장 하나. */
function Count({ badge, className }: { badge: NavBadge; className: string }) {
  return (
    <>
      <span className={className} aria-hidden="true" data-testid="admin-nav-count">
        {badge.visible}
      </span>
      <span className={s.srOnly}>{badge.label}</span>
    </>
  );
}

/** aria-current 값 — 자기 경로는 page, 그 아래 화면(상세 등)은 true. */
function currentAttr(match: "page" | "section" | null): "page" | "true" | undefined {
  return match === "page" ? "page" : match === "section" ? "true" : undefined;
}

export function AdminTabs({
  items,
  hubs,
  labels,
  signOutLabel,
  badge,
  badgeAt = 0,
  publicHref,
  children,
}: {
  items: readonly AdminNavItem[];
  hubs: readonly AdminNavHub[];
  labels: AdminNavLabels;
  signOutLabel: string;
  badge: NavBadge | null;
  /** 레이아웃이 배지 수를 센 시각(서버 ms). 화면의 보고와 어느 쪽이 새것인지 가른다. */
  badgeAt?: number;
  publicHref: string;
  children?: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  /*
   * 보고는 **마지막에 그린 화면의 것**으로 덮는다(더 새로 센 보고와 견주지 않는다) — 의도다(리뷰 P2-8 을 적어 둔다).
   * 뒤로·앞으로 가기는 Next 라우터 캐시의 화면을 다시 쓴다: 목록(5)에서 뒤로 가면 캐시된 홈(4)이 자기 수를 다시 보고하고, 배지도 4로 돌아간다.
   * 그 뒤 보고하지 않는 화면(공지 등)으로 가도 4가 남는다. 대신 **한 화면 안의 숫자는 늘 하나**다 — 캐시된 홈의 카드(4)와 배지(4)가 같다.
   * "더 새로 센 쪽만 받기" 로 바꾸면 그 캐시된 홈에서 카드 4 · 배지 5 가 함께 보인다(제안서 원칙 2 가 피하려던 두 숫자). 새 수는 새로고침·
   * 다음 서버 렌더(레이아웃 badgeAt 이 더 새것)에서 돌아온다. 캐시 화면 자체가 옛 값을 보이는 것은 라우터 캐시의 성질이다.
   */
  const [reported, setReported] = useState<TimedNavBadge | null>(null);
  const shownBadge = pickNavBadge({ badge, at: badgeAt }, reported);

  const sideItem = (item: AdminNavItem) => {
    if (!item.ready) {
      return (
        <li key={item.key}>
          <span className={s.sideItem} aria-disabled="true" data-ready="false">
            <Icon name={item.key} className={s.navIcon} />
            <span className={s.sideLabel}>{item.label}</span>
            <span className={s.sideNote}>{labels.comingSoon}</span>
          </span>
        </li>
      );
    }
    return (
      <li key={item.key}>
        <Link className={s.sideItem} href={item.href} aria-current={currentAttr(navMatch(pathname, item.href))}>
          <Icon name={item.key} className={s.navIcon} />
          <span className={s.sideLabel}>{item.label}</span>
          {item.key === ADMIN_BADGE_TAB && shownBadge !== null ? <Count badge={shownBadge} className={s.navCount} /> : null}
        </Link>
      </li>
    );
  };

  const mobileCurrent = currentMobileKey(pathname, items, hubs);
  const labelOf = (key: AdminTabKey | AdminHubKey): string =>
    items.find((it) => it.key === key)?.label ?? hubs.find((h) => h.key === key)?.label ?? key;

  return (
    <NavBadgeReportContext.Provider value={setReported}>
      <div className={s.shell}>
        <a className={s.skip} href="#admin-content">
          {labels.skip}
        </a>

        <aside className={s.sidebar} data-testid="admin-sidebar">
          <div className={s.brand}>
            <Image className={s.brandMark} src="/brand/symbol-mark.png" alt="" width={32} height={29} />
            <span className={s.brandName}>{labels.brand}</span>
          </div>
          <nav className={s.sideNav} aria-label={labels.navLabel} data-testid="admin-sidebar-nav">
            <ul className={s.sideList}>{items.filter((it) => it.group === "daily").map(sideItem)}</ul>
            {ADMIN_NAV_GROUPS.filter((g): g is AdminHubKey => g !== "daily").map((group) => (
              <div key={group} className={s.sideGroup}>
                {/* 묶음 이름은 한 번만 읽힌다 — 보이는 이름은 스크린리더에서 숨기고 목록이 이름을 갖는다(리뷰 P2-9).
                    h2 로 바꾸지 않은 이유: 사이드바가 본문 h1 보다 앞이라 제목 순서가 h2 → h1 로 뒤집힌다. */}
                <p className={s.sideGroupLabel} aria-hidden="true">
                  {labels.groups[group]}
                </p>
                <ul className={s.sideList} aria-label={labels.groups[group]}>
                  {items.filter((it) => it.group === group).map(sideItem)}
                </ul>
              </div>
            ))}
          </nav>
          <div className={s.sideFoot}>
            <p className={s.sideWho}>{labels.account}</p>
            <Link
              className={s.sideLink}
              href={ADMIN_ACCOUNT_PATH}
              aria-current={currentAttr(navMatch(pathname, ADMIN_ACCOUNT_PATH))}
              data-testid="admin-account-link"
            >
              <Icon name="account" className={s.navIcon} />
              {labels.myAccount}
            </Link>
            <a className={s.sideLink} href={publicHref} target="_blank" rel="noopener noreferrer">
              <Icon name="external" className={s.navIcon} />
              {labels.siteLink}
              <span className={s.srOnly}> ({labels.newWindow})</span>
            </a>
            <form action={signOutAdmin} data-testid="admin-signout-form">
              <button type="submit" className={s.signOut} data-testid="admin-signout">
                {signOutLabel}
              </button>
            </form>
          </div>
        </aside>

        <header className={s.topbar} data-testid="admin-topbar">
          <span className={s.topBrand}>
            <Image className={s.brandMark} src="/brand/symbol-mark.png" alt="" width={28} height={25} />
            {labels.brand}
          </span>
          <Link
            className={s.iconBtn}
            href={ADMIN_ACCOUNT_PATH}
            aria-label={labels.myAccount}
            aria-current={currentAttr(navMatch(pathname, ADMIN_ACCOUNT_PATH))}
            data-testid="admin-account-link-mobile"
          >
            <Icon name="account" className={s.navIcon} />
          </Link>
          <a className={s.iconBtn} href={publicHref} target="_blank" rel="noopener noreferrer" aria-label={`${labels.siteLink} (${labels.newWindow})`}>
            <Icon name="external" className={s.navIcon} />
          </a>
          <form action={signOutAdmin} data-testid="admin-signout-form-mobile">
            <button type="submit" className={s.topSignOut} data-testid="admin-signout-mobile">
              {signOutLabel}
            </button>
          </form>
        </header>

        <div className={s.content} id="admin-content" tabIndex={-1} data-testid="admin-content">
          {children}
          <div className={s.tabbarSpacer} aria-hidden="true" />
        </div>

        <nav className={s.tabbar} aria-label={labels.navLabel} data-testid="admin-tabbar">
          <ul className={s.tabbarList}>
            {mobileTabs(items, hubs).map((tab) => {
              const current = mobileCurrent === tab.key ? currentAttr(navMatch(pathname, tab.href) ?? "section") : undefined;
              return (
                <li key={tab.key}>
                  {tab.ready ? (
                    <Link className={s.tabItem} href={tab.href} aria-current={current}>
                      <Icon name={tab.key} className={s.tabIcon} />
                      <span>{labelOf(tab.key)}</span>
                      {tab.key === ADMIN_BADGE_TAB && shownBadge !== null ? <Count badge={shownBadge} className={s.tabCount} /> : null}
                    </Link>
                  ) : (
                    <span className={s.tabItem} aria-disabled="true" data-ready="false">
                      <Icon name={tab.key} className={s.tabIcon} />
                      <span>{labelOf(tab.key)}</span>
                      <span className={s.srOnly}>{labels.comingSoon}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </NavBadgeReportContext.Provider>
  );
}
