/**
 * P7-6 — 위 메뉴 9개 → 6개 · 차량운임료(/fares) 삭제 (사용자 결정 2026-10-09, 오픈 당일 미리보기 승인).
 *
 * 사용자 지시: "회사소개·인사말·찾아오시는 길은 한 페이지인데 나눌 필요 없고, 차량운임료는 아예 빼버려(별 내용 없음),
 * 견적요청·예약확인·공지사항은 좋고, 이용안내는 빼고, 갤러리 남겨놔." — 플랜의 "기존 메뉴 10개 전부 매핑" 게이트와
 * UIUX 브리프 "메뉴 삭제 금지" 를 **사용자가 직접 뒤집었다.** 이 파일이 새 결정을 렌더 결과로 잠근다(같은 강도 — 목록·순서·경로 전부).
 *
 * 무엇을 잠그는가 (ko · en 둘 다)
 *   1. 머리글(PC) · 휴대폰 메뉴 패널 = 6개, 이 순서: 회사소개 · 차량소개·보험내용 · 견적요청 · 예약확인 · 공지사항 · 갤러리.
 *      찾아오시는 길(/about#location) · 차량운임료(/fares) · 이용안내(/guide) 는 위 메뉴에 없다.
 *   2. 푸터 — 회사 열 = 회사소개 하나 · 고객센터 열 = 공지사항 · 이용안내 · 갤러리. 법정 링크(처리방침·약관·이용안내)는 그대로.
 *      이용안내는 위 메뉴에서만 빠진다 — 전자상거래법상 거래조건(취소·환불·계약금) 고지가 사이트에서 닿아야 한다.
 *   3. /fares 라우트 파일이 없다(ko·en 공용 [locale] 라우트째).
 *
 * 렌더는 서버 컴포넌트를 직접 불러 renderToStaticMarkup 한다(서버를 띄우지 않는다). next-intl/server 만 가짜(문구는 실제 카탈로그),
 * i18n Link 는 평범한 <a> 로 바꾼다(tests/uiux-polish.test.ts 와 같은 방식). 네이버 블로그는 env 가 없으면 숨는다 — 테스트 환경엔 없다.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ locale: "ko" as "ko" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { readFileSync: rf } = await import("node:fs");
  const p = await import("node:path");
  const load = (l: string) => JSON.parse(rf(p.resolve(import.meta.dirname, "..", "messages", `${l}.json`), "utf8"));
  const messages: Record<string, unknown> = { ko: load("ko"), en: load("en") };
  return {
    getLocale: vi.fn(async () => state.locale),
    setRequestLocale: vi.fn(),
    getTranslations: vi.fn(async (opts?: { namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return createTranslator({ locale: state.locale, messages: messages[state.locale] as never, namespace: namespace as never });
    }),
  };
});
// next-intl 의 Link 는 라우터 컨텍스트가 필요하다 — 메뉴 검사에는 평범한 <a> 로 충분하다.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
  usePathname: () => "/about",
  getPathname: ({ href }: { href: string }) => href,
}));

import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { loadMessages } from "@/i18n/messages";
import { HEADER_MENU, LEGACY_MENU, MENU_BY_GROUP } from "@/lib/legacy-menu-map";

const ROOT = path.resolve(import.meta.dirname, "..");
const ko = JSON.parse(readFileSync(path.join(ROOT, "messages/ko.json"), "utf8")) as { layout: Record<string, string> };
const en = JSON.parse(readFileSync(path.join(ROOT, "messages/en.json"), "utf8")) as { layout: Record<string, string> };
const LAYOUT = { ko: ko.layout, en: en.layout } as const;

function withIntl(locale: "ko" | "en", node: ReactNode): string {
  const providerProps = { locale, messages: loadMessages(locale), timeZone: "Asia/Seoul" } as unknown as Parameters<typeof NextIntlClientProvider>[0];
  return renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps, node));
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** aria-label 로 고른 <nav> 하나의 링크(href · 글자) — 순서 그대로. 그 이름의 nav 가 정확히 하나여야 한다. */
function navLinks(html: string, ariaLabel: string): Array<{ href: string; text: string }> {
  const re = new RegExp(`<nav[^>]*aria-label="${escAttr(ariaLabel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([\\s\\S]*?)</nav>`, "g");
  const blocks = [...html.matchAll(re)].map((m) => m[1]);
  expect(blocks, `<nav aria-label="${ariaLabel}"> 가 정확히 하나`).toHaveLength(1);
  return [...blocks[0].matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: decode(m[1]),
    text: decode(m[2].replace(/<[^>]*>/g, "")).trim(),
  }));
}

/** 위 메뉴(머리글 · 휴대폰 패널) — 사용자 결정 순서 그대로 */
const HEADER_EXPECTED = {
  ko: [
    ["/about", "회사소개"],
    ["/fleet", "차량소개 · 보험내용"],
    ["/#quote", "견적요청"],
    ["/reservation/check", "예약확인"],
    ["/notices", "공지사항"],
    ["/gallery", "갤러리"],
  ],
  en: [
    ["/about", "About Us"],
    ["/fleet", "Vehicles · Insurance"],
    ["/#quote", "Request a Quote"],
    ["/reservation/check", "Check Booking"],
    ["/notices", "Notices"],
    ["/gallery", "Gallery"],
  ],
} as const;

const FOOTER_EXPECTED = {
  ko: { company: [["/about", "회사소개"]], support: [["/notices", "공지사항"], ["/guide", "이용안내"], ["/gallery", "갤러리"]] },
  en: { company: [["/about", "About Us"]], support: [["/notices", "Notices"], ["/guide", "Booking Guide"], ["/gallery", "Gallery"]] },
} as const;

/** 위 메뉴에서 빠진 것 — 어느 메뉴에도(위·아래) 링크로 남지 않는 것은 앞의 둘이다. */
const GONE_HREFS = ["/fares", "/about#location"] as const;

describe("0. 데이터 — HEADER_MENU · MENU_BY_GROUP (env 없음: 블로그 숨김)", () => {
  test("HEADER_MENU 는 LEGACY_MENU 에서 header:true 만, 순서 유지 — 6개 + 블로그(외부·env)", () => {
    expect(HEADER_MENU.map((m) => m.key)).toEqual(["about", "fleet", "quote", "reservationCheck", "notices", "gallery", "blog"]);
    expect(HEADER_MENU).toEqual(LEGACY_MENU.filter((m) => m.header));
  });

  test("이용안내는 위 메뉴가 아니라 푸터 고객센터 열에만 있다", () => {
    const guide = LEGACY_MENU.find((m) => m.key === "guide");
    expect(guide?.href).toBe("/guide");
    expect(guide?.header).toBe(false);
    expect(MENU_BY_GROUP.support.map((m) => m.key)).toEqual(["notices", "guide", "gallery", "blog"]);
    expect(MENU_BY_GROUP.company.map((m) => m.key)).toEqual(["about"]);
  });

  test("찾아오시는 길 · 차량운임료 항목은 없다 (키·경로 둘 다)", () => {
    for (const m of LEGACY_MENU) {
      expect(["location", "fares"], m.key).not.toContain(m.key);
      expect(GONE_HREFS as readonly string[], m.key).not.toContain(m.href);
    }
  });
});

describe.each(["ko", "en"] as const)("1. 머리글 렌더 (%s) — 위 메뉴 6개 · 순서", (locale) => {
  const layout = LAYOUT[locale];

  test("PC 머리글(주요 메뉴) = 6개, 순서·경로·라벨", async () => {
    state.locale = locale;
    const html = withIntl(locale, await Header());
    const links = navLinks(html, layout.primaryNav).map((l) => [l.href, l.text]);
    expect(links).toEqual(HEADER_EXPECTED[locale].map(([h, t]) => [h, t]));
  });

  test("휴대폰 메뉴 패널 = 같은 6개, 같은 순서", async () => {
    state.locale = locale;
    const html = withIntl(locale, await Header());
    const links = navLinks(html, layout.mobileNav).map((l) => [l.href, l.text]);
    expect(links).toEqual(HEADER_EXPECTED[locale].map(([h, t]) => [h, t]));
  });

  test("머리글 어디에도 /fares · /about#location · /guide 링크가 없다", async () => {
    state.locale = locale;
    const html = withIntl(locale, await Header());
    for (const href of [...GONE_HREFS, "/guide"]) expect(html, href).not.toContain(`href="${href}"`);
  });

  test("회사소개 페이지(/about)에서 켜지는 위 메뉴는 회사소개 하나다 (aria-current=page)", async () => {
    state.locale = locale;
    const html = withIntl(locale, await Header());
    for (const label of [layout.primaryNav, layout.mobileNav]) {
      const block = html.match(new RegExp(`<nav[^>]*aria-label="${escAttr(label)}"[^>]*>([\\s\\S]*?)</nav>`))![1];
      const current = [...block.matchAll(/<a\b[^>]*aria-current="([^"]+)"[^>]*\bhref="([^"]*)"|<a\b[^>]*\bhref="([^"]*)"[^>]*aria-current="([^"]+)"/g)];
      expect(current.map((m) => m[2] ?? m[3]), label).toEqual(["/about"]);
    }
  });
});

describe.each(["ko", "en"] as const)("2. 푸터 렌더 (%s) — 회사 열 1개 · 고객센터 열 3개", (locale) => {
  const layout = LAYOUT[locale];

  test("회사 열(메뉴) = 회사소개 하나", async () => {
    state.locale = locale;
    const html = withIntl(locale, await Footer());
    expect(navLinks(html, layout.menuHeading).map((l) => [l.href, l.text])).toEqual(FOOTER_EXPECTED[locale].company.map(([h, t]) => [h, t]));
  });

  test("고객센터 열 = 공지사항 · 이용안내 · 갤러리", async () => {
    state.locale = locale;
    const html = withIntl(locale, await Footer());
    expect(navLinks(html, layout.supportHeading).map((l) => [l.href, l.text])).toEqual(FOOTER_EXPECTED[locale].support.map(([h, t]) => [h, t]));
  });

  test("푸터 어디에도 /fares · /about#location 링크가 없다 · 법정 링크(처리방침·약관·이용안내)는 그대로", async () => {
    state.locale = locale;
    const html = withIntl(locale, await Footer());
    for (const href of GONE_HREFS) expect(html, href).not.toContain(`href="${href}"`);
    for (const href of ["/privacy", "/terms", "/guide"]) expect(html, href).toContain(`href="${href}"`);
  });
});

describe("3. /fares 페이지 삭제 — 라우트 파일째", () => {
  test("app/[locale]/(site)/fares 가 없다", () => {
    expect(existsSync(path.join(ROOT, "app/[locale]/(site)/fares/page.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "app/[locale]/(site)/fares"))).toBe(false);
  });

  test("카탈로그에 메뉴 라벨 location · fares 가 없고, 회사소개 라벨은 '회사소개' / 'About Us'", () => {
    const koMenu = (ko.layout as unknown as { menu: Record<string, string> }).menu;
    const enMenu = (en.layout as unknown as { menu: Record<string, string> }).menu;
    for (const menu of [koMenu, enMenu]) {
      expect(menu).not.toHaveProperty("location");
      expect(menu).not.toHaveProperty("fares");
    }
    expect(koMenu.about).toBe("회사소개");
    expect(enMenu.about).toBe("About Us");
  });
});
