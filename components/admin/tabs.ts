/**
 * 관리자 메뉴 정의 — 단일 진실 (플랜 v4 P5-3~6·P6-2 · P5-20 사이드바·탭 바). 순수 모듈: 라벨도, Next 도, DOM 도 없다.
 *
 * `ready` 규약은 lib/legacy-menu-map.ts 와 같은 정신이다: "지금 링크해도 404 가 아니다" 를 손으로 적은 플래그로 믿는다.
 * 화면을 만드는 태스크가 자기 항목의 ready 를 true 로 올린다(P5-4 팝업 · P5-5 공지 · P5-6 대표 노선 · P6-2 갤러리).
 * ready 가 아닌 항목은 **지우지 않는다** — 사장님이 앞으로 무엇이 생길지 알아야 하고, 지우면 다음 태스크가 자리를 잊는다.
 * 대신 링크가 아니라 `aria-disabled` 로 렌더한다(components/admin/AdminTabs.tsx).
 *
 * P5-20 — 메뉴가 두 모양이 됐다(시안 docs/handoff/2026-09-27-admin-ux · 제안서 ⑥ 내비 결정).
 *   - ≥1024px **왼쪽 사이드바**: 매일(홈 · 접수) / 묶음 "홈페이지"(공지 · 팝업 · 갤러리 · 대표 노선) / 묶음 "기록"(문자 기록 · 통계).
 *     항목 순서가 곧 사이드바 순서다 — 같은 묶음은 이어져 있다.
 *   - <1024px **아래 탭 바 4개**: 매일 두 항목은 탭에 바로, 나머지 묶음은 **허브 화면**(ADMIN_HUBS)으로 간다. "더보기" 탭은 없다
 *     (Apple HIG — 넘치는 탭을 모은 More 탭을 피한다). 라벨은 한글 5자 이내(SEED).
 *   - `group` 은 묶음, `mobileHub` 는 "휴대폰에서는 허브를 거친다" 이다. 둘 다 여기서만 정한다.
 *
 * 새 접수 배지(ADMIN_BADGE_TAB)는 **정의가 하나**다 — `status='new'` 건수(lib/admin/reservations.ts countNewReservations).
 * 사이드바·탭 바가 같은 값을 받고(레이아웃이 한 번 센다), P5-21 의 홈 카드·목록 탭도 같은 함수를 부른다(Shopify 의 두 숫자 혼란을 피한다).
 * 0 이면 숨기고 99 를 넘으면 "99+" 로 줄인다(SEED Notification badge) — 스크린리더 문장에는 실제 건수를 적는다.
 *
 * 라벨은 여기 없다: messages/ko.json `admin.tabs.<key>`. 관리자 영역은 로케일 밖이라 레이아웃이 기본 로케일로 풀어 내린다.
 */
export const ADMIN_TAB_KEYS = ["home", "reservations", "notices", "popups", "gallery", "routes", "notifications", "stats"] as const;
export type AdminTabKey = (typeof ADMIN_TAB_KEYS)[number];

/** 묶음 — daily(매일 쓰는 것) · site(홈페이지에 보이는 것) · records(기록을 보는 것). */
export const ADMIN_NAV_GROUPS = ["daily", "site", "records"] as const;
export type AdminNavGroup = (typeof ADMIN_NAV_GROUPS)[number];
/** 허브 화면을 가진 묶음(휴대폰 탭 바의 탭 하나가 된다). */
export type AdminHubKey = Exclude<AdminNavGroup, "daily">;

export interface AdminTab {
  key: AdminTabKey;
  /** 활성일 때의 경로. ready 가 false 여도 적어 둔다 — 다음 태스크가 이 자리에 만든다. */
  href: string;
  ready: boolean;
  group: AdminNavGroup;
  /** 휴대폰(1024px 미만)에서는 탭 바에 바로 나오지 않고 묶음의 허브 화면을 거친다. */
  mobileHub: boolean;
}

export const ADMIN_TABS: readonly AdminTab[] = [
  // 홈은 로그인 뒤 매번 도착하는 첫 화면이다(대시보드는 P5-21 — 지금은 링크만 건다).
  { key: "home", href: "/admin", ready: true, group: "daily", mobileHub: false },
  { key: "reservations", href: "/admin/reservations", ready: true, group: "daily", mobileHub: false },
  { key: "notices", href: "/admin/notices", ready: true, group: "site", mobileHub: true },
  { key: "popups", href: "/admin/popups", ready: true, group: "site", mobileHub: true },
  { key: "gallery", href: "/admin/gallery", ready: true, group: "site", mobileHub: true },
  { key: "routes", href: "/admin/routes", ready: true, group: "site", mobileHub: true },
  // P5-8 발송 내역(메뉴 이름 '문자 기록') — 읽기 전용. 아웃박스가 기록만 하고 아무도 읽지 않던 구멍을 막는 화면이다(lib/admin/notifications.ts 헤더).
  { key: "notifications", href: "/admin/notifications", ready: true, group: "records", mobileHub: true },
  // P5-17 통계 — 읽기 전용. 0022 의 definer 함수 하나가 집계해 준다(lib/admin/stats.ts 헤더). 매일 누르는 화면이 아니라 **맨 뒤**다.
  { key: "stats", href: "/admin/stats", ready: true, group: "records", mobileHub: true },
];

export interface AdminHub {
  key: AdminHubKey;
  href: string;
}

/** 허브 화면 — 휴대폰 탭 바의 '홈페이지' · '기록'. 화면은 app/admin/(protected)/site · records. */
export const ADMIN_HUBS: readonly AdminHub[] = [
  { key: "site", href: "/admin/site" },
  { key: "records", href: "/admin/records" },
];

/** 새 접수 배지가 붙는 항목. */
export const ADMIN_BADGE_TAB: AdminTabKey = "reservations";
/** 배지 숫자의 상한 — 넘으면 "99+". */
export const NAV_BADGE_MAX = 99;

const ADMIN_ROOT = "/admin";

/**
 * 현재 표시 판정 — 자기 경로면 "page", 그 아래 화면(상세 등)이면 "section", 아니면 null.
 * 홈(/admin)은 모든 경로의 조상이라 **정확히 같을 때만** 현재다.
 */
export function navMatch(pathname: string, href: string): "page" | "section" | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === href) return "page";
  if (href === ADMIN_ROOT) return null;
  return path.startsWith(`${href}/`) ? "section" : null;
}

/** 사이드바에서 현재인 항목. 허브 화면·로그인 화면에서는 없다. */
export function currentTabKey(pathname: string, tabs: readonly AdminTab[] = ADMIN_TABS): AdminTabKey | null {
  return tabs.find((t) => t.ready && navMatch(pathname, t.href) !== null)?.key ?? null;
}

/** 묶음의 항목(사이드바 순서 그대로) — 허브 화면이 이 목록을 그린다. */
export function hubItems(group: AdminHubKey, tabs: readonly AdminTab[] = ADMIN_TABS): AdminTab[] {
  return tabs.filter((t) => t.group === group);
}

export interface MobileTab {
  key: AdminTabKey | AdminHubKey;
  href: string;
  ready: boolean;
  /** 허브로 가는 탭인가. */
  hub: boolean;
}

/** 휴대폰 탭 바 — 허브를 거치지 않는 항목(홈 · 접수) + 허브(홈페이지 · 기록). */
export function mobileTabs(tabs: readonly AdminTab[] = ADMIN_TABS, hubs: readonly AdminHub[] = ADMIN_HUBS): MobileTab[] {
  return [
    ...tabs.filter((t) => !t.mobileHub).map((t) => ({ key: t.key, href: t.href, ready: t.ready, hub: false })),
    ...hubs.map((h) => ({ key: h.key, href: h.href, ready: true, hub: true })),
  ];
}

/** 탭 바에서 현재인 탭 — 허브 화면 자체이거나 그 묶음의 항목(상세 포함)이면 허브 탭이 현재다. */
export function currentMobileKey(
  pathname: string,
  tabs: readonly AdminTab[] = ADMIN_TABS,
  hubs: readonly AdminHub[] = ADMIN_HUBS,
): AdminTabKey | AdminHubKey | null {
  const direct = tabs.find((t) => !t.mobileHub && t.ready && navMatch(pathname, t.href) !== null);
  if (direct) return direct.key;
  const hub = hubs.find((h) => navMatch(pathname, h.href) !== null);
  if (hub) return hub.key;
  const inside = tabs.find((t) => t.mobileHub && t.ready && navMatch(pathname, t.href) !== null);
  return inside && inside.group !== "daily" ? inside.group : null;
}

/** 배지 숫자 — 99 를 넘으면 "99+". */
export function badgeCountText(count: number): string {
  return count > NAV_BADGE_MAX ? `${NAV_BADGE_MAX}+` : String(count);
}

/** 메뉴 배지 — 보이는 숫자(aria-hidden)와 스크린리더 문장(실제 건수). 건수가 없거나(null·0) 이상하면 배지를 그리지 않는다. */
export interface NavBadge {
  visible: string;
  label: string;
}

export function navBadge(count: number | null, label: (n: number) => string): NavBadge | null {
  if (count === null || !Number.isInteger(count) || count <= 0) return null;
  return { visible: badgeCountText(count), label: label(count) };
}
