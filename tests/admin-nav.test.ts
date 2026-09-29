/**
 * P5-20 — 관리자 메뉴: PC(≥1024px) 왼쪽 사이드바 · 휴대폰(<1024px) 위 제목줄 + 아래 탭 바 4개 · 새 접수 배지 · 허브 화면 2개
 * (브리프 P5-20 §B · 시안 docs/handoff/2026-09-27-admin-ux/admin-ux-mockup.html 셸 · 제안서 ⑥ 내비 결정).
 *
 * 이 파일이 잠그는 것
 *   1. 메뉴 정의(components/admin/tabs.ts) — 항목·묶음·순서 · `ready` 규약 유지 · `group`·`mobileHub` · 허브 두 곳 · 현재 표시 판정
 *   2. 메뉴 마크업(AdminTabs) — 사이드바 순서·묶음 · 현재 표시(aria-current) · 배지(0 이면 숨김 · 스크린리더 문장) ·
 *      로그아웃은 form POST(두 자리 모두) · 탭 바 4개(더보기 없음) · 홈페이지 보기는 새 탭
 *   3. 레이아웃 — 배지 조회는 게이트 **뒤** · 실패해도 화면은 열린다(배지만 숨김) · 배지 정의는 하나(status='new' 건수)
 *   4. 허브 화면(/admin/site · /admin/records) — 첫 문장 게이트 · 조회는 게이트 뒤 병렬 · 항목마다 한 줄 상태 · 모르는 것은 "불러오지 못했어요"
 *   5. countNewReservations — head 집계 한 번(status='new') · 오류·빈 count 를 0 으로 갈음하지 않는다
 *
 * vitest 는 node 환경(DOM 패키지 없음) — 클라이언트 컴포넌트는 renderToStaticMarkup 으로 첫 화면 마크업을 보고,
 * 현재 경로(usePathname)는 모의로 바꿔 끼운다(tests/admin-confirm-sheet.test.ts 와 같은 방식). 실제 전환·포커스는 브라우저 실측(보고서 ⑦).
 * tests/ 아래라 게이트 3종의 검사 대상이다 — 금지어·임시값 마커 리터럴을 쓰지 않는다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { stripComments } from "./helpers/strip-comments";

vi.mock("server-only", () => ({}));
const nav = vi.hoisted(() => ({ pathname: "/admin" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt, width, height, className }: { src: string; alt: string; width: number; height: number; className?: string }) =>
    createElement("img", { src, alt, width, height, className }),
}));
// 서버액션 모듈 — 'use server' 파일이 next/headers 를 끌어오지 않게 바꿔치기. 마크업 테스트는 부르지 않는다.
vi.mock("@/actions/admin/session", () => ({ signOutAdmin: vi.fn() }));

import { formatAdminDate } from "@/components/admin/admin-date";
import { AdminTabs, type AdminNavItem } from "@/components/admin/AdminTabs";
import {
  ADMIN_BADGE_TAB,
  ADMIN_HUBS,
  ADMIN_TAB_KEYS,
  ADMIN_TABS,
  NAV_BADGE_MAX,
  badgeCountText,
  currentMobileKey,
  currentTabKey,
  hubItems,
  mobileTabs,
  navBadge,
  navMatch,
} from "@/components/admin/tabs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const exists = (rel: string) => existsSync(path.join(ROOT, rel));
const codeOf = (rel: string) => stripComments(read(rel), rel);
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

const ko = JSON.parse(read("messages/ko.json")) as { admin: Record<string, Record<string, unknown>> };
const tabsKo = ko.admin.tabs as Record<string, string>;

const TABS_DEF = "components/admin/tabs.ts";
const TABS_UI = "components/admin/AdminTabs.tsx";
const LAYOUT = "app/admin/(protected)/layout.tsx";
const SITE_HUB = "app/admin/(protected)/site/page.tsx";
const RECORDS_HUB = "app/admin/(protected)/records/page.tsx";
const HOME = "app/admin/(protected)/page.tsx";

/** href → (protected) 아래 page 파일. `/admin` 은 (protected)/page.tsx. */
const pageFileOf = (href: string) => `app/admin/(protected)${href.replace(/^\/admin/, "")}/page.tsx`;

/** 태그를 지운 본문. */
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** data-testid 로 여는 태그 하나. */
function openTag(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`);
  expect(at, `${testid} 가 없다`).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}
/** data-testid 요소의 안쪽 전체(같은 태그 이름이 중첩되지 않는 영역용 — nav·header·aside 는 중첩되지 않는다). */
function region(html: string, testid: string): string {
  const tag = openTag(html, testid);
  const name = /^<([a-z0-9]+)/i.exec(tag)![1];
  const start = html.indexOf(tag);
  const end = html.indexOf(`</${name}>`, start);
  return html.slice(start, end + name.length + 3);
}
const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
/** 영역 안의 링크 — [href, 본문, 여는 태그]. */
const links = (html: string) => [...html.matchAll(/<a\s[^>]*>[\s\S]*?<\/a>/g)].map((m) => ({ tag: /^<a\s[^>]*>/.exec(m[0])![0], href: attr(m[0], "href"), text: text(m[0]) }));

// =============================================================================
// 1. 메뉴 정의 — components/admin/tabs.ts
// =============================================================================
describe("1. 메뉴 정의 (tabs.ts)", () => {
  test("항목·순서 — 홈 · 접수 / 공지 · 팝업 · 갤러리 · 대표 노선 / 발송 기록 · 통계 (브리프 §B · 시안 사이드바)", () => {
    expect([...ADMIN_TAB_KEYS]).toEqual(["home", "reservations", "notices", "popups", "gallery", "routes", "notifications", "stats"]);
    expect(ADMIN_TABS.map((t) => t.key)).toEqual([...ADMIN_TAB_KEYS]);
    expect(ADMIN_TABS.map((t) => t.href)).toEqual([
      "/admin",
      "/admin/reservations",
      "/admin/notices",
      "/admin/popups",
      "/admin/gallery",
      "/admin/routes",
      "/admin/notifications",
      "/admin/stats",
    ]);
  });

  test("묶음 — daily(매일) · site(홈페이지) · records(기록). 묶음마다 이어져 있다(사이드바에서 한 덩어리)", () => {
    expect(ADMIN_TABS.map((t) => t.group)).toEqual(["daily", "daily", "site", "site", "site", "site", "records", "records"]);
    expect(hubItems("site").map((t) => t.key)).toEqual(["notices", "popups", "gallery", "routes"]);
    expect(hubItems("records").map((t) => t.key)).toEqual(["notifications", "stats"]);
  });

  test("mobileHub — 매일 쓰는 둘(홈·접수)은 탭 바에 바로, 나머지는 묶음의 허브 화면을 거친다", () => {
    for (const t of ADMIN_TABS) expect(t.mobileHub, t.key).toBe(t.group !== "daily");
  });

  test("`ready` 규약은 그대로 — 모두 켜져 있고, 켜진 항목의 경로에는 실제 화면 파일이 있다(404 링크 금지)", () => {
    expect(ADMIN_TABS.filter((t) => !t.ready)).toEqual([]);
    for (const t of ADMIN_TABS) expect(exists(pageFileOf(t.href)), `${t.key} → ${pageFileOf(t.href)}`).toBe(true);
  });

  test("허브 두 곳 — /admin/site(홈페이지) · /admin/records(기록) · 화면 파일이 (protected) 아래에 있다", () => {
    expect(ADMIN_HUBS).toEqual([
      { key: "site", href: "/admin/site" },
      { key: "records", href: "/admin/records" },
    ]);
    expect(exists(SITE_HUB)).toBe(true);
    expect(exists(RECORDS_HUB)).toBe(true);
  });

  test("탭 바 = 4개(홈 · 접수 · 홈페이지 · 기록) · '더보기' 없음 · 라벨은 한글 5자 이내(SEED)", () => {
    const tabs = mobileTabs();
    expect(tabs.map((t) => t.key)).toEqual(["home", "reservations", "site", "records"]);
    expect(tabs.map((t) => t.href)).toEqual(["/admin", "/admin/reservations", "/admin/site", "/admin/records"]);
    expect(tabs.map((t) => t.hub)).toEqual([false, false, true, true]);
    for (const t of tabs) {
      const label = tabsKo[t.key];
      expect(label, `admin.tabs.${t.key}`).toBeTruthy();
      expect([...label.replace(/\s/g, "")].length, `${t.key}: ${label}`).toBeLessThanOrEqual(5);
    }
    expect(Object.keys(tabsKo)).not.toContain("more");
  });

  test("현재 표시 판정 — 홈은 정확히 /admin 일 때만, 나머지는 자기 경로(page)·그 아래(section)", () => {
    expect(navMatch("/admin", "/admin")).toBe("page");
    expect(navMatch("/admin/", "/admin")).toBe("page");
    expect(navMatch("/admin/reservations", "/admin")).toBeNull();
    expect(navMatch("/admin/reservations", "/admin/reservations")).toBe("page");
    expect(navMatch("/admin/reservations/7c9e6679-7425-40de-944b-e07fc1f90ae7", "/admin/reservations")).toBe("section");
    expect(navMatch("/admin/reservationsX", "/admin/reservations")).toBeNull();
  });

  test.each([
    ["/admin", "home", "home"],
    ["/admin/reservations", "reservations", "reservations"],
    ["/admin/reservations/7c9e6679-7425-40de-944b-e07fc1f90ae7", "reservations", "reservations"],
    ["/admin/notices", "notices", "site"],
    ["/admin/notices/12", "notices", "site"],
    ["/admin/routes/3", "routes", "site"],
    ["/admin/site", null, "site"],
    ["/admin/notifications", "notifications", "records"],
    ["/admin/stats", "stats", "records"],
    ["/admin/records", null, "records"],
    ["/admin/login", null, null],
  ] as const)("%s → 사이드바 %s · 탭 바 %s", (pathname, side, mobile) => {
    expect(currentTabKey(pathname)).toBe(side);
    expect(currentMobileKey(pathname)).toBe(mobile);
  });

  test("배지 — 건수 0·모름(null)이면 숨김, 99 넘으면 99+ · 스크린리더에는 '새 접수 N건'(실제 건수)", () => {
    expect(ADMIN_BADGE_TAB).toBe("reservations");
    expect(NAV_BADGE_MAX).toBe(99);
    expect(badgeCountText(1)).toBe("1");
    expect(badgeCountText(99)).toBe("99");
    expect(badgeCountText(100)).toBe("99+");
    const label = (n: number) => `L${n}`;
    expect(navBadge(null, label)).toBeNull();
    expect(navBadge(0, label)).toBeNull();
    expect(navBadge(-1, label)).toBeNull();
    expect(navBadge(4, label)).toEqual({ visible: "4", label: "L4" });
    expect(navBadge(120, label)).toEqual({ visible: "99+", label: "L120" });
    expect(tabsKo.newCount).toBe("새 접수 {n}건");
  });

  test("순수 모듈 — 문구·Next·React 없음 · 한글 리터럴 0", () => {
    const src = codeOf(TABS_DEF);
    expect(src).not.toMatch(/from\s+"(next|react)[/"]/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });
});

// =============================================================================
// 2. 메뉴 마크업 — AdminTabs (사이드바 · 위 제목줄 · 아래 탭 바)
// =============================================================================
const items: AdminNavItem[] = ADMIN_TABS.map((t) => ({ ...t, label: tabsKo[t.key] }));
const hubs = ADMIN_HUBS.map((h) => ({ ...h, label: tabsKo[h.key] }));
const labels = {
  navLabel: tabsKo.navLabel,
  comingSoon: tabsKo.comingSoon,
  brand: tabsKo.brand,
  account: tabsKo.account,
  siteLink: tabsKo.siteLink,
  newWindow: tabsKo.newWindow,
  skip: tabsKo.skip,
  groups: { site: tabsKo.site, records: tabsKo.records },
};

function renderNav(opts: { pathname?: string; badge?: { visible: string; label: string } | null; items?: AdminNavItem[] } = {}): string {
  nav.pathname = opts.pathname ?? "/admin";
  return renderToStaticMarkup(
    createElement(
      AdminTabs,
      {
        items: opts.items ?? items,
        hubs,
        labels,
        signOutLabel: (ko.admin.session as Record<string, string>).signOut,
        badge: opts.badge === undefined ? null : opts.badge,
        publicHref: "/",
      },
      createElement("p", { "data-testid": "page-child" }, "CHILD"),
    ),
  );
}

describe("2. 메뉴 마크업 — 사이드바", () => {
  test("브랜드 · 항목 순서 · 묶음 제목(홈페이지 · 기록) · 아래: 계정 안내 · 홈페이지 보기(새 탭) · 로그아웃", () => {
    const html = renderNav();
    const side = region(html, "admin-sidebar");
    expect(text(side)).toContain(tabsKo.brand);
    const got = links(region(html, "admin-sidebar-nav")).map((l) => [l.href, l.text]);
    expect(got).toEqual(ADMIN_TABS.map((t) => [t.href, tabsKo[t.key]]));
    // 묶음 제목이 제자리에 — 접수 뒤·공지 앞에 '홈페이지', 대표 노선 뒤·발송 기록 앞에 '기록'
    const s = text(region(html, "admin-sidebar-nav"));
    const at = (w: string) => s.indexOf(w);
    expect(at(tabsKo.site)).toBeGreaterThan(at(tabsKo.reservations));
    expect(at(tabsKo.site)).toBeLessThan(at(tabsKo.notices));
    expect(at(tabsKo.records)).toBeGreaterThan(at(tabsKo.routes));
    expect(at(tabsKo.records)).toBeLessThan(at(tabsKo.notifications));

    const foot = text(side);
    expect(foot).toContain(tabsKo.account);
    const site = links(side).find((l) => l.href === "/");
    expect(site, "홈페이지 보기 링크").toBeDefined();
    expect(site!.text).toContain(tabsKo.siteLink);
    expect(attr(site!.tag, "target")).toBe("_blank");
    expect(attr(site!.tag, "rel")).toMatch(/noopener/);
    expect(site!.text, "새 탭으로 열린다는 것을 스크린리더에 알린다").toContain(tabsKo.newWindow);
  });

  test("현재 표시 — 자기 경로는 aria-current=page, 그 아래 화면(상세)은 aria-current=true · 다른 항목엔 없음", () => {
    const onList = links(region(renderNav({ pathname: "/admin/notices" }), "admin-sidebar-nav"));
    expect(onList.filter((l) => attr(l.tag, "aria-current") !== null).map((l) => [l.href, attr(l.tag, "aria-current")])).toEqual([["/admin/notices", "page"]]);
    const onDetail = links(region(renderNav({ pathname: "/admin/notices/12" }), "admin-sidebar-nav"));
    expect(onDetail.filter((l) => attr(l.tag, "aria-current") !== null).map((l) => [l.href, attr(l.tag, "aria-current")])).toEqual([["/admin/notices", "true"]]);
    const onHome = links(region(renderNav({ pathname: "/admin" }), "admin-sidebar-nav"));
    expect(onHome.filter((l) => attr(l.tag, "aria-current") !== null).map((l) => l.href)).toEqual(["/admin"]);
  });

  test("만들지 않은 항목은 링크가 아니라 aria-disabled + '준비 중'(ready 규약 — 자리를 지킨다)", () => {
    const withPending = items.map((it) => (it.key === "stats" ? { ...it, ready: false } : it));
    const html = renderNav({ items: withPending });
    const side = region(html, "admin-sidebar-nav");
    expect(links(side).map((l) => l.href)).not.toContain("/admin/stats");
    expect(side).toMatch(/aria-disabled="true"/);
    expect(text(side)).toContain(tabsKo.comingSoon);
  });

  /**
   * 🔴 리뷰 P2-9: 묶음 이름이 두 번 읽혔다(`paragraph: 홈페이지 | list "홈페이지"`). 보이는 이름은 스크린리더에서 숨기고(aria-hidden)
   * 목록이 이름을 한 번 갖는다(aria-label). 제목(h2)으로 바꾸는 길은 택하지 않았다 — 사이드바가 본문의 h1 보다 앞에 있어
   * 제목 순서가 h2 → h1 로 뒤집힌다.
   */
  test("🔴 묶음 이름은 스크린리더에 한 번만 — 보이는 이름은 aria-hidden, 목록이 aria-label 로 이름을 갖는다(aria-labelledby 없음)", () => {
    const nav = region(renderNav(), "admin-sidebar-nav");
    for (const group of ["site", "records"] as const) {
      const name = tabsKo[group];
      const labelTag = [...nav.matchAll(/<p\s[^>]*>([^<]*)<\/p>/g)].find((m) => m[1] === name);
      expect(labelTag, `${name} 묶음 이름`).toBeDefined();
      expect(attr(labelTag![0], "aria-hidden")).toBe("true");
      const lists = [...nav.matchAll(/<ul\s[^>]*>/g)].map((m) => m[0]).filter((t) => attr(t, "aria-label") === name);
      expect(lists, `${name} 목록`).toHaveLength(1);
    }
    expect(nav).not.toMatch(/aria-labelledby=/);
  });
});

describe("2-b. 메뉴 마크업 — 새 접수 배지", () => {
  const badge = { visible: "4", label: "새 접수 4건" };

  test("건수가 있으면 '접수' 항목에만 — 숫자는 aria-hidden, 스크린리더에는 문장 하나", () => {
    const html = renderNav({ badge });
    for (const where of ["admin-sidebar-nav", "admin-tabbar"]) {
      const area = region(html, where);
      const withBadge = links(area).filter((l) => l.text.includes(badge.label));
      expect(withBadge.map((l) => l.href), where).toEqual(["/admin/reservations"]);
      const link = /<a\s[^>]*href="\/admin\/reservations"[^>]*>[\s\S]*?<\/a>/.exec(area)![0];
      expect(link, where).toMatch(/<span[^>]*aria-hidden="true"[^>]*>4<\/span>/);
      expect(link, where).toMatch(new RegExp(`<span[^>]*>${badge.label}</span>`));
    }
  });

  test("건수가 없으면(null) 배지 자리 자체가 없다 — 숫자도, 스크린리더 문장도", () => {
    const html = renderNav({ badge: null });
    expect(text(html)).not.toContain("새 접수");
    expect(html).not.toMatch(/data-testid="admin-nav-count"/);
  });

  test("99+ 는 보이는 글자만 줄인다 — 스크린리더 문장은 실제 건수", () => {
    const html = renderNav({ badge: { visible: "99+", label: "새 접수 120건" } });
    expect(html).toContain(">99+<");
    expect(text(html)).toContain("새 접수 120건");
  });
});

describe("2-c. 메뉴 마크업 — 휴대폰 위 제목줄 · 아래 탭 바", () => {
  test("탭 바 — 링크 4개(홈 · 접수 · 홈페이지 · 기록) · 순서 · 경로", () => {
    const bar = region(renderNav(), "admin-tabbar");
    expect(links(bar).map((l) => [l.href, l.text])).toEqual([
      ["/admin", tabsKo.home],
      ["/admin/reservations", tabsKo.reservations],
      ["/admin/site", tabsKo.site],
      ["/admin/records", tabsKo.records],
    ]);
  });

  test.each([
    ["/admin", "/admin", "page"],
    ["/admin/reservations/7c9e6679-7425-40de-944b-e07fc1f90ae7", "/admin/reservations", "true"],
    ["/admin/site", "/admin/site", "page"],
    ["/admin/popups", "/admin/site", "true"],
    ["/admin/gallery", "/admin/site", "true"],
    ["/admin/records", "/admin/records", "page"],
    ["/admin/stats", "/admin/records", "true"],
  ] as const)("%s 에서 탭 바의 현재 표시는 %s (%s)", (pathname, href, value) => {
    const bar = links(region(renderNav({ pathname }), "admin-tabbar"));
    expect(bar.filter((l) => attr(l.tag, "aria-current") !== null).map((l) => [l.href, attr(l.tag, "aria-current")])).toEqual([[href, value]]);
  });

  test("위 제목줄 — 브랜드 · 홈페이지 보기(새 탭, 이름 있음) · 로그아웃(form POST)", () => {
    const top = region(renderNav(), "admin-topbar");
    expect(text(top)).toContain(tabsKo.brand);
    const site = links(top).find((l) => l.href === "/");
    expect(site).toBeDefined();
    expect(attr(site!.tag, "target")).toBe("_blank");
    expect(`${attr(site!.tag, "aria-label") ?? ""} ${site!.text}`).toContain(tabsKo.siteLink);
    expect(top).toMatch(/<form[\s\S]*<button[^>]*type="submit"[\s\S]*<\/form>/);
    expect(text(top)).toContain((ko.admin.session as Record<string, string>).signOut);
  });

  test("로그아웃 — 두 자리(사이드바 · 위 제목줄) 모두 form 안의 submit 버튼 · 로그아웃 링크는 없다", () => {
    const html = renderNav();
    const forms = [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]);
    expect(forms).toHaveLength(2);
    for (const f of forms) {
      expect(f).toMatch(/<button[^>]*type="submit"/);
      expect(text(f)).toBe((ko.admin.session as Record<string, string>).signOut);
    }
    expect(html).not.toMatch(/<a[^>]*(signOut|logout|sign-out)/i);
  });

  test("본문 — 건너뛰기 링크가 본문 자리(id)로 간다 · 페이지는 그 안에 · 탭 바는 본문 뒤(읽는 순서)", () => {
    const html = renderNav();
    const skip = links(html).find((l) => l.text === tabsKo.skip);
    expect(skip?.href).toBe("#admin-content");
    const main = openTag(html, "admin-content");
    expect(attr(main, "id")).toBe("admin-content");
    expect(attr(main, "tabindex")).toBe("-1");
    expect(html.indexOf('data-testid="page-child"')).toBeGreaterThan(html.indexOf('data-testid="admin-content"'));
    expect(html.indexOf('data-testid="admin-tabbar"')).toBeGreaterThan(html.indexOf('data-testid="page-child"'));
  });
});

describe("2-d. 정적 규약 — AdminTabs", () => {
  test("'use client' · next/link Link 로 그린다(프리페치 끄지 않음) · 로그아웃은 form action · 한글 리터럴 0 · env 0", () => {
    const src = codeOf(TABS_UI);
    expect(src.split("\n")[0].trim()).toMatch(/^["']use client["'];?$/);
    expect(src).toMatch(/import Link from "next\/link";/);
    expect(src).not.toMatch(/prefetch=\{false\}/);
    expect((src.match(/<form\s+action=\{signOutAdmin\}/g) ?? []).length).toBe(2);
    expect(src).toMatch(/from "@\/actions\/admin\/session"/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
    expect(src).not.toMatch(/process\.env/);
  });
});

// =============================================================================
// 2-e. 셸 CSS — 크기·자리 (브리프 §B: 사이드바 248px · 항목 44px · 위 제목줄 56px · 탭 바 56px)
// =============================================================================
/** 주석을 걷은 CSS 의 `선택자 { 본문 }` 쌍(가장 안쪽 블록) — tests/admin-status-badge.test.ts 와 같은 방식. */
function cssRules(css: string): { selector: string; body: string; media: string | null }[] {
  const out: { selector: string; body: string; media: string | null }[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const mediaRe = /@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
  const medias: { start: number; end: number; query: string }[] = [];
  for (const m of stripped.matchAll(mediaRe)) medias.push({ start: m.index!, end: m.index! + m[0].length, query: m[1].trim() });
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith("@")) continue;
    const at = m.index!;
    const media = medias.find((x) => at > x.start && at < x.end)?.query ?? null;
    out.push({ selector: selector.replace(/^@media[^{]*/, "").trim(), body: m[2], media });
  }
  return out;
}
const decl = (body: string, prop: string): string | null => new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim() ?? null;

describe("2-e. 셸 CSS", () => {
  const rules = cssRules(read("components/admin/admin.module.css"));
  const DESKTOP = "(min-width: 1024px)";
  /** 선택자 목록(`a,\n b`)은 나눠서 본다 — 같은 선언을 여러 선택자가 함께 쓰는 규칙도 잡는다. */
  const body = (selector: string, media: string | null = null) =>
    rules
      .filter((r) => r.media === media && r.selector.split(",").map((s) => s.trim()).includes(selector))
      .map((r) => r.body)
      .join(";");

  /**
   * 🔴 브라우저 실측(보고서 ⑦)에서 잡은 결함: `.shell` 은 min-height 100vh 격자라, 내용이 짧은 화면(관리 홈 · 허브)에서
   * 남는 높이가 auto 줄(위 제목줄 · 본문)에 **나눠 붙어** 375px 위 제목줄이 272px 까지 늘었다(56px 이어야 한다).
   * 줄을 내용 높이로 두려면 `align-content: start` 가 있어야 한다.
   */
  test("🔴 격자 줄은 늘어나지 않는다 — .shell 에 align-content: start (짧은 화면에서 위 제목줄이 늘던 결함)", () => {
    expect(decl(body(".shell"), "min-height")).toBe("100vh");
    expect(decl(body(".shell"), "align-content")).toBe("start");
  });

  test("≥1024px — 사이드바 248px(고정 · 왼쪽 칸 예약) · 본문은 둘째 칸 · 위 제목줄과 탭 바는 숨김", () => {
    expect(decl(body(".shell", DESKTOP), "grid-template-columns")).toBe("248px minmax(0, 1fr)");
    expect(decl(body(".sidebar", DESKTOP), "width")).toBe("248px");
    expect(decl(body(".sidebar", DESKTOP), "position")).toBe("fixed");
    expect(decl(body(".content", DESKTOP), "grid-column")).toBe("2");
    expect(decl(body(".topbar", DESKTOP), "display")).toBe("none");
    expect(decl(body(".tabbar", DESKTOP), "display")).toBe("none");
    expect(decl(body(".sidebar"), "display")).toBe("none");
  });

  /**
   * 🔴 브라우저 실측(보고서 ⑦): 공지·팝업 화면의 두 칸 격자(폼 20~26rem + 목록)가 **뷰포트** 1024px 에서 켜지는데, 사이드바가
   * 본문을 248px 줄여 목록 칸이 236px 로 좁아졌다(게시일·상태·처리 칸이 스크롤 뒤로 숨음). 그래서 두 칸을 1280px 부터로 미뤘지만,
   * P5-23 라운드 1 촬영에서 **1280 에서도** 목록 칸이 좁아 제목이 낱말마다 꺾이고 '노출 끄기' 가 두 줄이 됐다.
   * 라운드 2(컨트롤러 B-5): 두 칸을 걷었다 — **모든 폭에서 한 칸, 목록이 먼저**, 등록 폼은 그 아래 자기 카드. 목록 칸이 좁아질 폭이 없다(같은 뜻의 더 강한 형태).
   */
  test("🔴 공지·팝업은 모든 폭에서 한 칸 — 두 칸 격자가 없다 · 목록 섹션이 등록 폼보다 먼저(P5-23 라운드 2 B-5)", () => {
    expect(rules.filter((r) => r.selector.split(",").map((s) => s.trim()).includes(".popupGrid"))).toEqual([]);
    for (const [page, list, form] of [
      ["app/admin/(protected)/notices/page.tsx", "notice-list-title", "notice-new-title"],
      ["app/admin/(protected)/popups/page.tsx", "popup-list-title", "popup-new-title"],
    ] as const) {
      const src = read(page);
      expect(src, page).not.toMatch(/popupGrid/);
      expect(src.indexOf(`id="${list}"`), page).toBeGreaterThan(0);
      expect(src.indexOf(`id="${list}"`), `${page} — 목록이 등록 폼보다 먼저`).toBeLessThan(src.indexOf(`id="${form}"`));
    }
  });

  test("누르는 자리 높이 — 사이드바 항목·링크·로그아웃 44px · 위 제목줄 56px · 탭 바 항목 56px(아래 고정)", () => {
    for (const sel of [".sideItem", ".sideLink", ".signOut", ".topSignOut"]) expect(decl(body(sel), "min-height"), sel).toBe("44px");
    expect(decl(body(".iconBtn"), "height")).toBe("44px");
    expect(decl(body(".topbar"), "min-height")).toBe("56px");
    expect(decl(body(".tabItem"), "min-height")).toBe("56px");
    expect(decl(body(".tabbar"), "position")).toBe("fixed");
    expect(decl(body(".tabbar"), "bottom")).toBe("0");
  });
});

// =============================================================================
// 3. 레이아웃 — 배지 조회는 게이트 뒤 · 실패해도 화면은 열린다
// =============================================================================
interface Found {
  type: unknown;
  props: Record<string, unknown>;
}
function collect(node: unknown, out: Found[] = []): Found[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const c of node) collect(c, out);
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.props) {
    out.push({ type: el.type, props: el.props });
    collect(el.props.children, out);
  }
  return out;
}
const nameOf = (t: unknown) => (typeof t === "function" ? ((t as { name?: string }).name ?? "") : "");

const realTranslator = async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: vi.fn(async (opts?: { namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return createTranslator({ locale: "ko", messages: ko as never, namespace: namespace as never });
    }),
  };
};

describe("3. 레이아웃 — 배지는 게이트 뒤에서 한 번 센다", () => {
  afterEach(() => {
    for (const m of ["@/lib/auth/requireAdmin", "next-intl/server", "@/lib/admin/reservations", "@/lib/log"]) vi.doUnmock(m);
    vi.resetModules();
  });

  async function renderLayout(count: () => Promise<number>) {
    vi.resetModules();
    const order: string[] = [];
    const logs: unknown[] = [];
    vi.doMock("@/lib/log", () => ({ structuredLog: (entry: unknown) => logs.push(entry) }));
    vi.doMock("@/lib/auth/requireAdmin", () => ({
      requireAdmin: async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push("gate");
        return { userId: "u", email: "owner@example.test" };
      },
    }));
    vi.doMock("next-intl/server", realTranslator);
    vi.doMock("@/lib/admin/reservations", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/reservations")),
      countNewReservations: async () => {
        order.push("count");
        return count();
      },
    }));
    const layout = (await import("@/app/admin/(protected)/layout")) as { default: (p: { children: ReactNode }) => Promise<ReactElement> };
    const tree = await layout.default({ children: createElement("p", null, "CHILD") });
    const tabs = collect(tree).find((n) => nameOf(n.type) === "AdminTabs");
    expect(tabs, "레이아웃이 AdminTabs 를 그린다").toBeDefined();
    return { props: tabs!.props, order, tree, logs };
  }

  test("조회는 게이트가 끝난 뒤에 시작한다 · 건수 4 → 배지 {4, '새 접수 4건'} · 센 시각(badgeAt)을 함께 넘긴다(P5-21 — 화면이 센 수와 어느 쪽이 새것인지 가른다)", async () => {
    const before = Date.now();
    const { props, order } = await renderLayout(async () => 4);
    expect(order).toEqual(["gate", "count"]);
    expect(props.badge).toEqual({ visible: "4", label: "새 접수 4건" });
    expect(props.signOutLabel).toBe((ko.admin.session as Record<string, string>).signOut);
    expect(typeof props.badgeAt).toBe("number");
    expect(props.badgeAt as number).toBeGreaterThanOrEqual(before);
    expect(props.badgeAt as number).toBeLessThanOrEqual(Date.now());
  });

  test("건수 0 → 배지 없음(null)", async () => {
    const { props } = await renderLayout(async () => 0);
    expect(props.badge).toBeNull();
  });

  test("조회가 실패해도 레이아웃은 열린다 — 배지만 숨긴다(0 이라고 말하지 않는다: 숫자를 그리지 않는다)", async () => {
    const { props, tree } = await renderLayout(async () => {
      throw new Error("count failed");
    });
    expect(props.badge).toBeNull();
    expect(collect(tree).some((n) => n.props.children === "CHILD")).toBe(true);
  });

  /**
   * 🔴 리뷰 P2-4: 모름(조회 실패)과 0 이 화면에서 같고 로그도 없었다 — 운영에서 권한·RLS 가 깨져도 배지가 조용히 사라질 뿐이다.
   * 화면은 그대로 두고(배지 숨김) **서버 로그 한 줄**을 남긴다. 오류 문구·주소는 싣지 않는다(예외의 종류만 — requireAdmin 과 같은 규약).
   */
  test("🔴 조회가 실패하면 구조화 로그 한 줄(event · 예외 종류만 — 문구·주소 없음) · 배지는 숨김", async () => {
    const { props, logs } = await renderLayout(async () => {
      throw new TypeError("permission denied for table reservations (owner@example.test)");
    });
    expect(props.badge).toBeNull();
    expect(logs).toEqual([{ level: "error", event: "admin.nav_badge_count_failed", name: "TypeError" }]);
    expect(JSON.stringify(logs)).not.toMatch(/permission|owner@|example\.test/);
  });

  test("조회가 되면(0 포함) 로그를 남기지 않는다", async () => {
    for (const n of [0, 3]) expect((await renderLayout(async () => n)).logs).toEqual([]);
  });

  test("레이아웃이 결과 알림(토스트) 자리를 본문 둘레에 둔다 — 공지·팝업·갤러리·노선이 같은 자리를 쓴다", async () => {
    const { tree } = await renderLayout(async () => 0);
    expect(collect(tree).some((n) => nameOf(n.type) === "AdminToastProvider")).toBe(true);
  });

  test("정적 — 게이트는 첫 문장 한 줄 · 배지 조회는 countNewReservations 하나(실패는 null) · 한글 리터럴 0", () => {
    const src = codeOf(LAYOUT);
    expect(src).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    expect(src.split("\n").filter((l) => /\brequireAdmin\s*\(/.test(l)).map((l) => l.trim())).toEqual(["await requireAdmin();"]);
    expect(src).toMatch(/countNewReservations\(\)\.catch\(/);
    expect(src).toMatch(/<AdminTabs[\s\S]*signOutLabel=/);
    expect(src.split("\n").filter((l) => HANGUL.test(l))).toEqual([]);
  });
});

// =============================================================================
// 4. 관리 홈 — P5-21 부터 대시보드(자세한 값 정의는 tests/admin-dashboard.test.ts) · 여기서는 메뉴와의 이음새만
// =============================================================================
describe("4. 관리 홈 /admin", () => {
  test("첫 문장 게이트 · 제목(오늘 확인할 일) · 접수로 가는 링크 · 옛 자리표시자('곧 채워져요')는 없다 · 조회가 모두 실패해도 화면은 열린다", async () => {
    vi.resetModules();
    const boom = async () => {
      throw new Error("down");
    };
    vi.doMock("@/lib/auth/requireAdmin", () => ({ requireAdmin: async () => ({ userId: "u", email: "e" }) }));
    vi.doMock("next-intl/server", realTranslator);
    vi.doMock("@/lib/admin/reservations", async () => ({
      ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/reservations")),
      countNewReservations: boom,
      countNewByIntake: boom,
      countOverdueNew: boom,
      countConfirmedDeparting: boom,
      listConfirmedDeparting: boom,
      listConfirmedDepartDates: boom,
      listReservations: boom,
      countCreatedBetween: boom,
    }));
    vi.doMock("@/lib/admin/notifications", async () => ({ ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/notifications")), getHomeSendAlerts: boom }));
    vi.doMock("@/lib/admin/popups", async () => ({ ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/popups")), listAdminPopups: boom }));
    vi.doMock("@/lib/admin/notices", async () => ({ ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/notices")), listAdminNotices: boom }));
    vi.doMock("@/lib/admin/routes", async () => ({ ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/routes")), listAdminRoutes: boom }));
    vi.doMock("@/lib/queries", () => ({ getVehicles: boom }));
    try {
      const page = (await import("@/app/admin/(protected)/page")) as { default: () => Promise<ReactElement> };
      const html = renderToStaticMarkup(await page.default());
      const home = ko.admin.home as Record<string, unknown> & Record<string, string>;
      expect(home.title).toBe("오늘 확인할 일");
      expect(home.sub).toBeUndefined();
      expect(text(html)).toContain(home.title);
      expect(text(html)).not.toContain("곧 채워져요");
      expect(links(html).map((l) => l.href)).toContain("/admin/reservations");
      expect(text(html)).toContain(home.unknown);
      expect(codeOf(HOME)).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    } finally {
      for (const m of ["@/lib/auth/requireAdmin", "next-intl/server", "@/lib/admin/reservations", "@/lib/admin/notifications", "@/lib/admin/popups", "@/lib/admin/notices", "@/lib/admin/routes", "@/lib/queries"]) {
        vi.doUnmock(m);
      }
      vi.resetModules();
    }
  });
});

// =============================================================================
// 5. 허브 화면 — 항목마다 한 줄 상태 · 게이트 뒤 병렬 · 모르는 것은 모른다고
// =============================================================================
const NOTICE = (id: number, active: boolean, published_at: string) => ({ id, title: `n${id}`, body: "b", category: "info", published_at, active });
const POPUP = (id: number, active: boolean) => ({ id, title: `p${id}`, body: "b", image_path: null, starts_at: "2000-01-01", ends_at: "2999-12-31", active, created_at: "2026-09-01T00:00:00.000Z" });
const ROUTE = (id: number, active: boolean, price_from: number | null) => ({ id, origin_code: "ICN", destination_code: "SEL", price_from, highlight: false, sort: id, active });

interface HubMocks {
  notices?: () => Promise<unknown>;
  popups?: () => Promise<unknown>;
  usage?: () => Promise<unknown>;
  routes?: () => Promise<unknown>;
  summary?: () => Promise<unknown>;
}

async function renderHub(which: "site" | "records", mocks: HubMocks) {
  vi.resetModules();
  let gateDone = false;
  const beforeGate: string[] = [];
  const started: string[] = [];
  const mark = (name: string) => {
    if (!gateDone) beforeGate.push(name);
    started.push(name);
  };
  vi.doMock("@/lib/auth/requireAdmin", () => ({
    requireAdmin: async () => {
      await new Promise((r) => setTimeout(r, 5));
      gateDone = true;
      return { userId: "u", email: "e" };
    },
  }));
  vi.doMock("next-intl/server", realTranslator);
  vi.doMock("@/lib/admin/notices", async () => ({
    ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/notices")),
    listAdminNotices: async () => {
      mark("notices");
      return (mocks.notices ?? (async () => []))();
    },
  }));
  vi.doMock("@/lib/admin/popups", async () => ({
    ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/popups")),
    listAdminPopups: async () => {
      mark("popups");
      return (mocks.popups ?? (async () => []))();
    },
  }));
  vi.doMock("@/lib/admin/gallery", async () => ({
    ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/gallery")),
    galleryUsage: async () => {
      mark("usage");
      return (mocks.usage ?? (async () => ({ photos: 0, bytes: 0 })))();
    },
  }));
  vi.doMock("@/lib/admin/routes", async () => ({
    ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/routes")),
    listAdminRoutes: async () => {
      mark("routes");
      return (mocks.routes ?? (async () => []))();
    },
  }));
  vi.doMock("@/lib/admin/notifications", async () => ({
    ...(await vi.importActual<Record<string, unknown>>("@/lib/admin/notifications")),
    getNotificationSummary: async () => {
      mark("summary");
      return (mocks.summary ?? (async () => ({ failed: 0, stuck: 0, sentUnconfirmed: 0, windowHours: 24, ok: true })))();
    },
  }));
  try {
    const page = (await import(which === "site" ? "@/app/admin/(protected)/site/page" : "@/app/admin/(protected)/records/page")) as {
      default: () => Promise<ReactElement>;
    };
    const html = renderToStaticMarkup(await page.default());
    return { html, beforeGate, started };
  } finally {
    for (const m of ["@/lib/auth/requireAdmin", "next-intl/server", "@/lib/admin/notices", "@/lib/admin/popups", "@/lib/admin/gallery", "@/lib/admin/routes", "@/lib/admin/notifications"]) {
      vi.doUnmock(m);
    }
    vi.resetModules();
  }
}

const hubKo = ko.admin.hub as Record<string, Record<string, string> & string>;
const fill = (tpl: string, v: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]));
/** 허브 한 줄 — data-hub-item 의 링크 본문. */
function hubRow(html: string, key: string): string {
  const m = new RegExp(`<a[^>]*data-hub-item="${key}"[^>]*>[\\s\\S]*?</a>`).exec(html);
  expect(m, `허브 항목 ${key} 가 없다`).not.toBeNull();
  return m![0];
}

describe("5. 허브 — /admin/site (홈페이지)", () => {
  test("네 항목(공지 · 팝업 · 갤러리 · 대표 노선) — 순서 · 경로 · 제목", async () => {
    const { html } = await renderHub("site", {});
    const rows = [...html.matchAll(/data-hub-item="(\w+)"/g)].map((m) => m[1]);
    expect(rows).toEqual(["notices", "popups", "gallery", "routes"]);
    for (const t of hubItems("site")) {
      const row = hubRow(html, t.key);
      expect(attr(row, "href")).toBe(t.href);
      expect(text(row)).toContain(tabsKo[t.key]);
    }
    expect(text(html)).toContain(hubKo.site.title);
  });

  test("한 줄 상태 — 노출 중 공지 수·마지막 게시일 · 노출 중 팝업 수 · 사진 수 · 노출 노선·금액 없는 노선", async () => {
    const { html } = await renderHub("site", {
      notices: async () => [NOTICE(3, true, "2026-09-25"), NOTICE(2, false, "2026-09-26"), NOTICE(1, true, "2026-09-10")],
      popups: async () => [POPUP(1, true), POPUP(2, false)],
      usage: async () => ({ photos: 7, bytes: 1234 }),
      routes: async () => [ROUTE(1, true, 400000), ROUTE(2, true, null), ROUTE(3, false, null)],
    });
    // 마지막 게시일은 관리자 날짜 틀(P5-23 라운드 2 A-3) — 원형 "2026-09-25" 가 아니라 "9월 25일 (금)"(올해가 아니면 연도까지 — 기준은 지금 KST)
    const d = ko.admin.dates as Record<string, unknown>;
    const labels = {
      weekdays: d.weekdays as string[],
      ...(Object.fromEntries(["day", "dayYear", "md", "mdYear", "month", "monthYear", "time", "dateTime", "period"].map((k) => [k, String(d[k])])) as Record<string, string>),
    } as unknown as Parameters<typeof formatAdminDate>[2];
    const lastDate = (formatAdminDate("2026-09-25", new Date(), labels) ?? "").replace(/\s+/g, " ");
    expect(lastDate).toMatch(/9월 25일 \(금\)$/);
    // 줄은 조각 줄이다(P5-23 라운드 3) — 문장의 " · " 는 조각 사이 CSS 장식이 되어 DOM 글자로는 빈칸 하나다
    const asSegments = (s: string) => s.split(" · ").join(" ");
    expect(text(hubRow(html, "notices"))).toContain(asSegments(fill(hubKo.notices.live, { n: 2, date: lastDate })));
    expect(text(hubRow(html, "notices"))).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text(hubRow(html, "popups"))).toContain(fill(hubKo.popups.live, { n: 1 }));
    expect(text(hubRow(html, "gallery"))).toContain(fill(hubKo.gallery.count, { n: 7 }));
    expect(text(hubRow(html, "routes"))).toContain(asSegments(fill(hubKo.routes.noPrice, { total: 3, live: 2, n: 1 })));
    expect(text(hubRow(html, "routes")), "구분점은 DOM 글자가 아니다").not.toContain(" · ");
  });

  test("비어 있을 때 — 거짓 없는 한 줄(노출 중 없음 · 아직 없음)", async () => {
    const { html } = await renderHub("site", {
      notices: async () => [NOTICE(1, false, "2026-09-10")],
      popups: async () => [POPUP(1, false)],
      usage: async () => ({ photos: 0, bytes: 0 }),
      routes: async () => [ROUTE(1, true, 400000)],
    });
    expect(text(hubRow(html, "notices"))).toContain(hubKo.notices.noneLive);
    expect(text(hubRow(html, "popups"))).toContain(hubKo.popups.noneLive);
    expect(text(hubRow(html, "gallery"))).toContain(hubKo.gallery.empty);
    expect(text(hubRow(html, "routes"))).toContain(fill(hubKo.routes.live, { total: 1, live: 1 }));
    const none = await renderHub("site", { notices: async () => [] });
    expect(text(hubRow(none.html, "notices"))).toContain(hubKo.notices.empty);
  });

  test("조회는 게이트 뒤 · 넷이 동시에 나간다(하나가 다른 것을 기다리지 않는다)", async () => {
    let arrived = 0;
    let release!: () => void;
    const opened = new Promise<void>((r) => {
      release = r;
    });
    const wait = async <T,>(v: T) => {
      arrived += 1;
      if (arrived >= 4) release();
      await Promise.race([opened, new Promise((_, rej) => setTimeout(() => rej(new Error("직렬로 줄 서 있다")), 3000))]);
      return v;
    };
    const { beforeGate, started } = await renderHub("site", {
      notices: () => wait([]),
      popups: () => wait([]),
      usage: () => wait({ photos: 0, bytes: 0 }),
      routes: () => wait([]),
    });
    expect(beforeGate, "조회가 게이트보다 먼저 시작했다").toEqual([]);
    expect(started.sort()).toEqual(["notices", "popups", "routes", "usage"]);
  });

  test("한 조회가 실패하면 그 줄만 '불러오지 못했어요' — 화면은 열리고 다른 줄은 그대로(모르는 것을 '없음'이라 하지 않는다)", async () => {
    const { html } = await renderHub("site", {
      popups: async () => {
        throw new Error("boom");
      },
      usage: async () => ({ photos: 3, bytes: 1 }),
    });
    expect(text(hubRow(html, "popups"))).toContain(hubKo.unknown);
    expect(text(hubRow(html, "popups"))).not.toContain(hubKo.popups.noneLive);
    expect(text(hubRow(html, "gallery"))).toContain(fill(hubKo.gallery.count, { n: 3 }));
  });
});

describe("5-b. 허브 — /admin/records (기록)", () => {
  const n = ko.admin.notifications as Record<string, Record<string, string>>;

  test("두 항목(발송 기록 · 통계) — 순서 · 경로", async () => {
    const { html } = await renderHub("records", {});
    for (const t of hubItems("records")) expect(attr(hubRow(html, t.key), "href")).toBe(t.href);
    expect(text(html)).toContain(hubKo.records.title);
  });

  test("발송 기록 — 이상 없으면 '이상 없음', 있으면 발송 내역 요약과 같은 말 · 통계는 설명 한 줄(무거운 집계를 부르지 않는다)", async () => {
    const ok = await renderHub("records", {});
    expect(text(hubRow(ok.html, "notifications"))).toContain(n.summary.ok);
    expect(text(hubRow(ok.html, "stats"))).toContain(hubKo.stats);
    expect(ok.started).toEqual(["summary"]);
    const bad = await renderHub("records", { summary: async () => ({ failed: 2, stuck: 0, sentUnconfirmed: 1, windowHours: 24, ok: false }) });
    const row = text(hubRow(bad.html, "notifications"));
    expect(row).toContain(fill(n.summary.failed, { n: 2 }));
    expect(row).toContain(fill(n.summary.sentUnconfirmed, { n: 1 }));
    expect(row).not.toContain(n.summary.ok);
  });

  test("요약 조회가 실패하면 '불러오지 못했어요'(이상 없음이라고 말하지 않는다) · 조회는 게이트 뒤", async () => {
    const r = await renderHub("records", {
      summary: async () => {
        throw new Error("down");
      },
    });
    expect(text(hubRow(r.html, "notifications"))).toContain(hubKo.unknown);
    expect(text(hubRow(r.html, "notifications"))).not.toContain(n.summary.ok);
    expect(r.beforeGate).toEqual([]);
  });

  test("정적 — 두 허브 모두 첫 문장 게이트 · 한 줄 · 한글 리터럴 0 · 자기 loading 없음((protected)/loading 이 맡는다)", () => {
    for (const rel of [SITE_HUB, RECORDS_HUB]) {
      const src = codeOf(rel);
      expect(src, rel).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
      expect(src.split("\n").filter((l) => /\brequireAdmin\s*\(/.test(l)).map((l) => l.trim()), rel).toEqual(["await requireAdmin();"]);
      expect(src.split("\n").filter((l) => HANGUL.test(l)), rel).toEqual([]);
      expect(exists(rel.replace("page.tsx", "loading.tsx")), rel).toBe(false);
    }
  });
});

// =============================================================================
// 6. countNewReservations — 배지 정의는 하나(status='new' 건수)
// =============================================================================
describe("6. countNewReservations", () => {
  function countClient(res: { count: number | null; error: { code?: string; message: string } | null }) {
    const calls: { method: string; args: unknown[] }[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ method: m, args });
        return chain;
      };
    }
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad);
    return {
      calls,
      client: {
        from: (table: string) => {
          calls.push({ method: "from", args: [table] });
          return chain;
        },
      },
    };
  }

  test("reservations 에 head 집계 한 번 — status='new' · 행은 오지 않는다(개인정보 0)", async () => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })) }));
    vi.doMock("@/lib/supabase/ssr", () => ({ createSsrClient: vi.fn() }));
    try {
      const { countNewReservations } = await import("@/lib/admin/reservations");
      const { client, calls } = countClient({ count: 4, error: null });
      expect(await countNewReservations(client as never)).toBe(4);
      expect(calls[0]).toEqual({ method: "from", args: ["reservations"] });
      const select = calls.find((c) => c.method === "select")!;
      expect(select.args[1]).toEqual({ count: "exact", head: true });
      expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["status", "new"]]);

      await expect(countNewReservations(countClient({ count: null, error: { code: "42501", message: "denied" } }).client as never)).rejects.toThrow(/42501/);
      await expect(countNewReservations(countClient({ count: null, error: null }).client as never), "count 를 0 으로 갈음하지 않는다").rejects.toThrow();
    } finally {
      vi.doUnmock("next/headers");
      vi.doUnmock("@/lib/supabase/ssr");
      vi.resetModules();
    }
  });
});

// =============================================================================
// 7. 관리자 인가 게이트 스크립트 — 새 라우트가 규칙을 통과한다(규칙을 약하게 하지 않았다)
// =============================================================================
describe("7. check-admin-gate", () => {
  test("저장소 그대로 exit 0 — 허브 두 화면 · 레이아웃 · 로딩 경계 규칙 7·8", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/check-admin-gate.mjs")], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    // 공개 예외 목록은 늘리지 않았다 — 로그인 화면과 콜백 둘뿐
    expect(read("scripts/check-admin-gate.mjs")).not.toMatch(/"app\/admin\/\(protected\)\/(site|records)/);
  }, 60_000);
});
