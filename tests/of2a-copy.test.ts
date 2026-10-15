/**
 * OF2-A — 사장님 요청(2026-10-15) 중 **카피·고지 지우기** 묶음의 렌더 잠금. 구현이 아니라 결과(화면에 무엇이 있고 없는가)를 본다.
 *
 *   1. 푸터 맨 아래 계약·대금 주체 문장(RELATED_COMPANY.note) — 푸터엔 없고 /guide 엔 있다 (전자상거래법 §13①1호)
 *   4. 홈 접수 현황 아래 공개 고지(PRIVACY_NOTICE.publicFeedNotice) — 홈엔 없고 견적 모달 동의 블록·/privacy 엔 있다
 *   5. 이용 방법 설명 — "복잡한 절차는 저희가 대신합니다." 뒤 줄바꿈(ko·en 같은 자리)
 *
 * 법정 문구는 **양쪽을 다** 단언한다 — 한쪽(없다)만 보면 실수로 원장·다른 쪽까지 지운 것을 못 잡고,
 * 한쪽(있다)만 보면 지우라는 요청이 구현됐는지 못 잡는다.
 * 2(회사소개 사업자 정보)는 tests/about-owner-requests.test.ts, 3(시각)은 quick-quote·reservation-*·quick-display·notify-*,
 * 6(예약 확인 안내)은 tests/reservation-check.test.ts, 7(편집기)은 tests/admin-editor-of2a.test.ts 에 있다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ locale: "ko" as "ko" | "en" }));

vi.mock("server-only", () => ({}));

// 서버 컴포넌트를 실제로 불러 렌더한다 — next-intl/server 만 가짜다(로케일은 테스트가 고르고, 문구는 실제 카탈로그).
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

import { NextIntlClientProvider } from "next-intl";

import GuidePage from "@/app/[locale]/(legal)/guide/page";
import PrivacyPage from "@/app/[locale]/(legal)/privacy/page";
import { HowItWorks } from "@/components/home/HowItWorks";
import { RecentFeed } from "@/components/home/RecentFeed";
import Footer from "@/components/layout/Footer";
import { ConsentBlock, type ConsentText } from "@/components/quote/ConsentBlock";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { LEGAL_LINKS, PRIVACY_NOTICE, RELATED_COMPANY } from "@/lib/legal/disclosures";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

type Catalog = Record<string, unknown>;
const ko = JSON.parse(read("messages/ko.json")) as Catalog;
const en = JSON.parse(read("messages/en.json")) as Catalog;
const at = (cat: Catalog, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Catalog)[k] : undefined), cat);

type El = ReactElement<Record<string, unknown>>;
function findEl(node: unknown, pred: (el: El) => boolean): El | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findEl(n, pred);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const el = node as El;
  if (pred(el)) return el;
  return findEl(el.props.children, pred);
}
function html(tree: ReactNode): string {
  return renderToStaticMarkup(tree as ReactElement);
}

// 원장 값 그대로 — 지우는 것은 화면이지 원장이 아니다
const NOTE = "계약과 개인정보 처리의 주체는 합자회사 베스트투어이며, 대금은 (주)베스트모빌리티 명의 계좌로 받습니다.";
const FEED_NOTICE = PRIVACY_NOTICE.publicFeedNotice;

describe("원장은 그대로다 — 지운 것은 화면뿐", () => {
  test("RELATED_COMPANY.note 와 PRIVACY_NOTICE.publicFeedNotice 는 원장에 남아 있다(공백까지 같은 값)", () => {
    expect(RELATED_COMPANY.note).toBe(NOTE);
    expect(typeof FEED_NOTICE).toBe("string");
    expect(FEED_NOTICE.length).toBeGreaterThan(10);
  });
});

// =============================================================================
// 1. 푸터 — 계약·대금 주체 문장
// =============================================================================
describe.each(["ko", "en"] as const)("1. 계약·대금 주체 문장 (%s) — 푸터엔 없고 /guide 엔 있다", (locale) => {
  test("푸터 전체 — 문장 0 · 두 번째 회사 줄((주)베스트모빌리티)은 그대로", async () => {
    state.locale = locale;
    // 사업자 정보 구역 전체(두 회사 줄 포함) — 푸터 전체는 클라이언트 Nav 가 intl 컨텍스트를 요구해 구역만 렌더한다(다른 푸터 테스트와 같다)
    const info = findEl(await Footer(), (el) => el.props["data-testid"] === "footer-company-info");
    expect(info, "footer-company-info 구역").toBeDefined();
    const out = html(info);
    expect(count(out, esc(NOTE))).toBe(0);
    expect(out).not.toContain("계약과 개인정보 처리의 주체");
    expect(out).toContain(esc(RELATED_COMPANY.legalName));
    expect(out).toContain(esc(RELATED_COMPANY.bizRegNo));
  });

  test("/guide — 같은 문장이 정확히 한 번 있다", async () => {
    state.locale = locale;
    const out = html(await GuidePage(params(locale)));
    expect(count(out, esc(NOTE))).toBe(1);
  });

  test("푸터 소스 — note 렌더·클래스가 없다", () => {
    const code = codeOf("components/layout/Footer.tsx");
    expect(code).not.toMatch(/RELATED_COMPANY\.note/);
    expect(code).not.toMatch(/styles\.note\b/);
    expect(codeOf("app/[locale]/(legal)/guide/page.tsx")).toMatch(/RELATED_COMPANY\.note/);
  });
});

// =============================================================================
// 4. 홈 접수 현황 — 공개 고지 문장
// =============================================================================
const CONSENT_KO: ConsentText = {
  title: ledgerUi("ko").headings.privacyNotice,
  purpose: PRIVACY_NOTICE.purpose,
  itemsLine: PRIVACY_NOTICE.itemsLine,
  retention: PRIVACY_NOTICE.retention,
  retentionSummary: PRIVACY_NOTICE.retentionSummary,
  refusal: PRIVACY_NOTICE.refusal,
  consentLabel: ledgerUi("ko").consent.privacy,
  publicFeedNotice: PRIVACY_NOTICE.publicFeedNotice,
  privacyHref: LEGAL_LINKS.privacy,
  summaryEn: null,
  officialNotice: null,
};

describe.each(["ko", "en"] as const)("4. 접수 현황 공개 고지 (%s) — 홈엔 없고 견적 모달 동의 블록·/privacy 엔 있다", (locale) => {
  const ITEMS = [
    { status: "new", maskedName: "김**", vehicleLabel: null, departDateKst: "2026-10-20" },
    { status: "confirmed", maskedName: "이**", vehicleLabel: "45인승 우등", departDateKst: "2026-10-22" },
  ] as const;

  test("홈 접수 현황 — 목록은 그대로 · 고지 문장·고지 요소 0", async () => {
    state.locale = locale;
    const out = html(await RecentFeed({ items: ITEMS as never }));
    expect(out).toContain('data-testid="recent-feed"');
    expect(out).toContain("김**");
    expect(count(out, esc(FEED_NOTICE))).toBe(0);
    expect(out).not.toContain('data-testid="recent-feed-notice"');
    expect(out).not.toContain('data-legal="official-korean-notice"'); // en 에서도 그 고지 위에 놓이던 안내가 따라 사라졌다
    expect(out).not.toContain("마스킹하여");
  });

  test("견적 모달 동의 블록 — 같은 고지가 한 번 있다(접힌 줄에 보인다)", () => {
    const provider = { locale, messages: locale === "ko" ? ko : en, timeZone: "Asia/Seoul" } as unknown as Parameters<typeof NextIntlClientProvider>[0];
    const out = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        provider,
        createElement(ConsentBlock, { text: CONSENT_KO, privacyConsent: false, onPrivacyChange: () => {}, idPrefix: "t" }),
      ),
    );
    expect(count(out, esc(FEED_NOTICE))).toBe(1);
    expect(out).toContain('data-testid="consent-public-feed"');
  });

  test("/privacy — 같은 고지가 있다", async () => {
    state.locale = locale;
    const out = html(await PrivacyPage(params(locale)));
    expect(out).toContain(esc(FEED_NOTICE));
  });

  test("소스 — RecentFeed 에는 없고 ConsentBlock·privacy 페이지에는 있다", () => {
    expect(codeOf("components/home/RecentFeed.tsx")).not.toMatch(/publicFeedNotice|OfficialKoreanNotice/);
    expect(codeOf("components/quote/ConsentBlock.tsx")).toMatch(/publicFeedNotice/);
    expect(codeOf("app/[locale]/(legal)/privacy/page.tsx")).toMatch(/publicFeedNotice/);
  });
});

// =============================================================================
// 5. 이용 방법 설명 줄바꿈
// =============================================================================
describe.each(["ko", "en"] as const)("5. 이용 방법 설명 (%s) — 첫 문장 뒤에서 줄이 바뀐다", (locale) => {
  const cat = locale === "ko" ? ko : en;
  const lead = at(cat, "home.how.descLead") as string;
  const body = at(cat, "home.how.descBody") as string;

  test("카탈로그 — descLead·descBody 두 문장(옛 단일 키 desc 는 없다)", () => {
    expect(typeof lead).toBe("string");
    expect(typeof body).toBe("string");
    expect(at(cat, "home.how.desc")).toBeUndefined();
    if (locale === "ko") {
      expect(lead).toBe("복잡한 절차는 저희가 대신합니다.");
      expect(body).toBe("고객님은 출발지·도착지와 날짜, 인원만 알려 주시면 됩니다.");
    } else {
      expect(lead).toBe("We take care of the complicated parts.");
      expect(body).toBe("All you need to do is tell us where you are going, when, and how many people.");
    }
  });

  test("렌더 — 설명 단락 안에서 첫 문장 · <br/> · 둘째 문장 순서", async () => {
    state.locale = locale;
    const out = html(await HowItWorks());
    const desc = /<p class="[^"]*desc[^"]*">([\s\S]*?)<\/p>/.exec(out)?.[1] ?? "";
    expect(desc).toBe(`${esc(lead)}<br/>${esc(body)}`);
  });
});
