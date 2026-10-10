/**
 * 사장님 요청 7 · 20 · 21 · 결정 3 — 단계 2 T2-2 확인·결제·소비자 고지 문구
 * (2026-10-10, 계획 `.superpowers/sdd/2026-09-06-bestour-implementation-v4/OWNER-FEEDBACK-plan.md` T2-2 · 결정 3-1~3-8,
 *  사용자 결정 `OWNER-FEEDBACK-decisions.md` — 3 A안 · 21 VAT 문장 삭제).
 *
 *   1. verbatim 새 값과 바이트 잠금 — 원장 · CLAUDE.md §3 · 게이트 스크립트 · en 짝이 같은 문장을 가리킨다. 옛 문장 둘은 역사 상수 말고 0.
 *   2. verbatim 자리(결정 3-2) — 남김: 견적 모달 제출 위 · 완료 화면 · 예약 확인 카드(접수 상태만).
 *                              삭제: 푸터 · 홈 이용 방법 · /guide 안내 상자 · 견적 위젯 하단 · 확정 문자·알림톡.
 *                              접수 문자·알림톡에는 남긴다(접수 직후라 "확인 후 연락드리겠습니다" 의 뜻이 맞다).
 *   3. 확정 문자의 약관 제8조 줄(대금 · 취소·환불 · 청약철회 · 계좌 · 이용안내)은 그대로 있다.
 *   4. 카탈로그 — "온라인 결제" 어구 0(ko·en) · 완료 화면 "확정 전까지 비용 없음" 유지 · VAT 문장 삭제 · 위젯 부제 어미.
 *   5. 대금 지급 줄(요청 20) — 홈 이용 방법에서 빠지고, 견적 모달("자세히 보기" 안)·/guide 에는 남는다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ locale: "ko" as "ko" | "en" }));

// Hero 가 lib/guard/turnstile(서버 전용)에서 action 이름을 가져온다 — 렌더만 하므로 표지 모듈을 비운다.
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
import { Hero } from "@/components/home/Hero";
import { HowItWorks } from "@/components/home/HowItWorks";
import { QuoteWidget } from "@/components/home/QuoteWidget";
import Footer from "@/components/layout/Footer";
import { ReservationCard } from "@/components/reservation-check/ReservationCard";
import { consultPhone } from "@/lib/contact-phone";
import { ledgerUi, localizeVerbatim } from "@/lib/i18n/ledger-ui";
import { CANCELLATION, PAYMENT, QUOTE_BASIS, RELATED_COMPANY, VERBATIM, WITHDRAWAL } from "@/lib/legal/disclosures";
import type { ReservationCheckRow } from "@/lib/reservation-check/lookup";
import { RESERVATION_STATUSES, toReservationView } from "@/lib/reservation-check/view";
import { ALIMTALK_TEMPLATES, CONTRACT_PARTY_LINE, GUIDE_PATH, renderTemplate, renderVariants, type CustomerVars } from "@/lib/notify/templates";

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
function leaves(node: unknown, prefix = ""): Array<[string, string]> {
  if (typeof node === "string") return [[prefix, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${prefix}.${i}`));
  if (node && typeof node === "object") return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  return [];
}
/** 손님 화면 카탈로그 — admin.* 는 사장님 화면이라 뺀다. */
const publicLeaves = (cat: Catalog) => leaves(Object.fromEntries(Object.entries(cat).filter(([ns]) => ns !== "admin")));

// ── 새 값 ────────────────────────────────────────────────────────────────
const NEW_KO = "확인 후 연락드리겠습니다.";
const NEW_EN = "We will review your request and contact you.";

// ── 역사 값 — 이 파일이 "없어야 한다" 를 단언하려고 담는다(배포 표면 밖) ─────────────
const HISTORY_OWNER_NOTICE = "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다.";
const HISTORY_STAFF_NOTICE = "담당자 확인 후 연락드리며, 확정된 예약만 결제 진행됩니다.";
const HISTORY_EN_NOTICE = "We will contact you after reviewing your request. Payment is taken only for confirmed bookings.";
const HISTORY_FRAGMENTS = [HISTORY_OWNER_NOTICE, HISTORY_STAFF_NOTICE, HISTORY_EN_NOTICE, "확정된 예약만 결제", "Payment is taken only for confirmed"];

// =============================================================================
// 1. verbatim 새 값 · 바이트 잠금
// =============================================================================
describe("1. verbatim 새 값 — 원장 · CLAUDE.md §3 · 게이트 · en 짝이 같은 문장", () => {
  test("원장 VERBATIM.bookingNotice = '확인 후 연락드리겠습니다.'(바이트)", () => {
    expect(Buffer.compare(Buffer.from(VERBATIM.bookingNotice, "utf8"), Buffer.from(NEW_KO, "utf8"))).toBe(0);
  });

  test("CLAUDE.md §3 의 접수·확정 줄 = 새 문장 · 같은 줄에 '2026-10-10 사장님 요청 7' 메모 · 옛 문장 0", () => {
    const claude = read("CLAUDE.md");
    const row = claude.split("\n").find((l) => /^\s*-\s*접수·확정:\s*"/.test(l));
    expect(row, "CLAUDE.md §3 의 접수·확정 줄").toBeDefined();
    expect(/"([^"]+)"/.exec(row!)?.[1]).toBe(NEW_KO);
    expect(row).toContain("2026-10-10 사장님 요청 7");
    for (const h of HISTORY_FRAGMENTS) expect(claude.includes(h), h).toBe(false);
  });

  test("게이트 스크립트의 verbatim 배열 = 새 문장(옛 문장 0)", () => {
    const sh = read("scripts/check-legal-disclosures.sh");
    const arr = /VERBATIM=\(\n([\s\S]*?)\n\)/.exec(sh)?.[1] ?? "";
    const items = [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(items).toEqual([NEW_KO, VERBATIM.showcaseNotice]);
    for (const h of HISTORY_FRAGMENTS) expect(sh.includes(h), h).toBe(false);
  });

  test("en 짝 — en.json legal.verbatim.bookingNotice · ledgerUi('en') · localizeVerbatim('en') = 'We will review your request and contact you.'", () => {
    expect(at(en, "legal.verbatim.bookingNotice")).toBe(NEW_EN);
    expect(ledgerUi("en").verbatim.bookingNotice).toBe(NEW_EN);
    expect(localizeVerbatim("en", VERBATIM.bookingNotice)).toBe(NEW_EN);
    expect(localizeVerbatim("ko", VERBATIM.bookingNotice)).toBe(NEW_KO);
  });

  test("옛 문장(ko 둘 · en 하나)이 배포 표면 어디에도 없다 — app · components · lib · actions · i18n · messages · styles · supabase · scripts", () => {
    const DIRS = ["app", "components", "lib", "actions", "i18n", "messages", "styles", "supabase", "scripts"];
    const walk = (rel: string): string[] => {
      const abs = path.join(ROOT, rel);
      return readdirSync(abs).flatMap((name) => {
        const r = `${rel}/${name}`;
        return statSync(path.join(ROOT, r)).isDirectory() ? walk(r) : /\.(ts|tsx|js|mjs|cjs|json|sh|sql|css|md)$/.test(name) ? [r] : [];
      });
    };
    const files = DIRS.flatMap(walk);
    expect(files.length).toBeGreaterThan(100); // 탐지가 비지 않았다
    const hits = files.flatMap((f) => HISTORY_FRAGMENTS.filter((h) => read(f).includes(h)).map((h) => `${f}: ${h}`));
    expect(hits).toEqual([]);
  });

  test("tests/ 에서는 옛 문장이 이름에 BASELINE·HISTORY 가 든 역사 상수 줄에만 있다", () => {
    const files = readdirSync(path.join(ROOT, "tests")).filter((n) => n.endsWith(".ts")).map((n) => `tests/${n}`);
    const bad = files.flatMap((f) =>
      read(f)
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => [HISTORY_OWNER_NOTICE, HISTORY_STAFF_NOTICE, HISTORY_EN_NOTICE].some((h) => l.includes(h)))
        .filter(([, l]) => !/\bconst [A-Z_]*(BASELINE|HISTORY)[A-Z_]* = "/.test(l))
        .map(([n, l]) => `${f}:${n}: ${l.trim().slice(0, 80)}`),
    );
    expect(bad).toEqual([]);
  });
});

// =============================================================================
// 2. verbatim 자리 (결정 3-2)
// =============================================================================
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
function block(tree: ReactNode, pred: (el: El) => boolean, what: string): string {
  const el = findEl(tree, pred);
  expect(el, `${what} 를 찾지 못했다`).toBeDefined();
  return renderToStaticMarkup(el!);
}

describe.each(["ko", "en"] as const)("2-a. 지운 자리 (%s) — 푸터 · 홈 이용 방법 · /guide · 견적 위젯", (locale) => {
  const notice = locale === "ko" ? NEW_KO : NEW_EN;

  test("푸터 사업자 정보 블록에 verbatim 0 · 계약·대금 주체 고지는 그대로", async () => {
    state.locale = locale;
    const html = block(await Footer(), (el) => el.props["data-testid"] === "footer-company-info", "footer-company-info");
    expect(html).not.toContain(esc(notice));
    expect(html).not.toContain(esc(VERBATIM.bookingNotice));
    expect(count(html, esc(RELATED_COMPANY.note))).toBe(1); // 블록이 비지 않았다 — 같은 자리의 다른 고지는 남는다
    expect(codeOf("components/layout/Footer.tsx")).not.toMatch(/bookingNotice|localizeVerbatim|\bVERBATIM\b/);
  });

  test("홈 이용 방법 — verbatim 0 · 대금 지급 줄 0 · 산정 기준 줄은 남음", async () => {
    state.locale = locale;
    const html = renderToStaticMarkup(await HowItWorks());
    expect(html).not.toContain(esc(notice));
    expect(html).not.toContain(esc(VERBATIM.bookingNotice));
    expect(html).not.toContain(esc(PAYMENT.line));
    expect(count(html, esc(QUOTE_BASIS.line))).toBe(1);
    const src = codeOf("components/home/HowItWorks.tsx");
    expect(src).not.toMatch(/\bPAYMENT\b|\bVERBATIM\b|localizeVerbatim/);
  });

  test("/guide — 안내 상자에 verbatim 0(Top-5 고지만) · 본문 어디에도 verbatim 0 · 대금 지급 줄은 남음", async () => {
    state.locale = locale;
    const tree = await GuidePage(params(locale));
    const box = block(tree, (el) => el.props["data-testid"] === "verbatim", "/guide 안내 상자");
    expect(box).not.toContain(esc(VERBATIM.bookingNotice));
    expect(count(box, esc(VERBATIM.showcaseNotice))).toBe(1);
    const src = codeOf("app/[locale]/(legal)/guide/page.tsx");
    expect(src).not.toMatch(/VERBATIM\.bookingNotice/);
    expect(src).toMatch(/VERBATIM\.showcaseNotice/);
    expect(src).toMatch(/PAYMENT\.line/);
  });

  test("견적 위젯 — Hero 가 위젯에 verbatim·결제 안내를 내리지 않는다(모달 legal.bookingNotice 는 그대로)", async () => {
    state.locale = locale;
    const widget = findEl(await Hero(), (el) => el.type === QuoteWidget);
    expect(widget, "QuoteWidget").toBeDefined();
    const props = widget!.props as Record<string, unknown>;
    expect("bookingNotice" in props).toBe(false);
    expect("paymentNote" in props).toBe(false);
    expect((props.legal as { bookingNotice: string }).bookingNotice).toBe(notice);
  });
});

describe("2-b. 견적 위젯 소스 — 하단 안내 문단 0", () => {
  test("QuoteWidget 에 bookingNotice·paymentNote·quoteNote 가 없다", () => {
    const src = codeOf("components/home/QuoteWidget.tsx");
    expect(src).not.toMatch(/\bbookingNotice\b|\bpaymentNote\b|quoteNote/);
  });
});

// ── 예약 확인 카드 — 접수(new) 상태에서만 ─────────────────────────────────────
const ROW: ReservationCheckRow = {
  name: "홍길동",
  phone: "+821012345678",
  status: "new",
  intake: "quick",
  trip_type: null,
  depart_at: "2026-11-30T15:00:00.000Z",
  return_at: null,
  vehicle_slug: null,
  origin_code: "SEL",
  destination_code: "BSN",
  bus_count: null,
  passengers: 40,
  created_at: "2026-10-10T05:04:00.000Z",
};
function renderCard(locale: "ko" | "en", status: string): string {
  const view = toReservationView({ ...ROW, status }, null, locale);
  const providerProps = { locale, messages: locale === "ko" ? ko : en, timeZone: "Asia/Seoul" } as unknown as Parameters<typeof NextIntlClientProvider>[0];
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      providerProps,
      createElement(ReservationCard, { view, bookingNotice: localizeVerbatim(locale, VERBATIM.bookingNotice), tel: consultPhone(locale), onAgain: () => {} }),
    ),
  );
}

describe.each(["ko", "en"] as const)("2-c. 예약 확인 카드 (%s) — verbatim 은 접수(new) 상태에서만", (locale) => {
  const notice = esc(locale === "ko" ? NEW_KO : NEW_EN);

  test("상태 넷을 모두 본다", () => {
    expect([...RESERVATION_STATUSES].sort()).toEqual(["cancelled", "confirmed", "done", "new"]);
  });

  test.for(RESERVATION_STATUSES.map((s) => [s] as const))("%s", ([status]) => {
    const html = renderCard(locale, status);
    if (status === "new") {
      expect(count(html, notice)).toBe(1);
      expect(count(html, 'data-legal="booking-notice"')).toBe(1);
    } else {
      expect(html).not.toContain(notice);
      expect(html).not.toContain('data-legal="booking-notice"');
    }
    // 도움말(전화)은 상태와 무관하게 남는다
    expect(html).toContain('data-testid="reservation-call"');
  });
});

// ── 문자·알림톡 ─────────────────────────────────────────────────────────────
const CUSTOMER: CustomerVars = { publicCode: "BT12ABCD", origin: "https://bestour.co.kr" };
const wholeLines = (s: string, line: string) => s.split("\n").filter((l) => l === line).length;

describe("2-d. 문자·알림톡 — 확정에서 verbatim 삭제 · 접수에는 남김", () => {
  test("확정 문자(SMS 판 · LMS 판 · 보낼 한 통)에 verbatim 0", () => {
    const v = renderVariants("confirmed.customer.sms", CUSTOMER);
    for (const [variant, text] of [
      ["sms", v.sms],
      ["lms", v.lms],
      ["sent", renderTemplate("confirmed.customer.sms", CUSTOMER).text],
    ] as const) {
      expect(text, variant).not.toContain(VERBATIM.bookingNotice);
      expect(text, variant).not.toContain("확인 후 연락");
    }
  });

  test("확정 알림톡 심사 제출본에 verbatim 0", () => {
    const confirmed = ALIMTALK_TEMPLATES.find((t) => t.event === "confirmed")!;
    expect(confirmed.body).not.toContain(VERBATIM.bookingNotice);
    expect(confirmed.body).not.toContain("확인 후 연락");
  });

  test("접수 문자(두 판)·접수 알림톡에는 verbatim 이 줄 전체로 정확히 한 번", () => {
    const v = renderVariants("created.customer.sms", CUSTOMER);
    expect(wholeLines(v.sms, VERBATIM.bookingNotice)).toBe(1);
    expect(wholeLines(v.lms, VERBATIM.bookingNotice)).toBe(1);
    const created = ALIMTALK_TEMPLATES.find((t) => t.event === "created")!;
    expect(wholeLines(created.body, VERBATIM.bookingNotice)).toBe(1);
  });

  // T2-4(2026-10-10 · 사장님 요청 8 · 사용자 승인 초안 · 위험 #9): 확정 문자·알림톡이 블록 서식으로 바뀌어 같은 고지가 다른 줄 모양으로 실린다 —
  //   대금 지급  : PAYMENT.line(한 줄)        → `■ 대금` 의 PAYMENT.smsDeposit · smsBalance 두 항목
  //   계좌       : PAYMENT.accountLine(한 줄) → PAYMENT.smsAccount 항목 + smsAccountHolder 이어지는 줄
  //   취소·청약철회: 원장 그대로 — 항목 표시 "- " 가 앞에 붙는다. 취소는 CANCELLATION.smsItem(smsLine 에서 머리말 "취소·환불 : " 만 뺀
  //                같은 문장 — 섹션 제목 "■ 취소·환불" 과 겹치지 않게, T2-4 후속), 청약철회는 WITHDRAWAL.smsLine
  //   이용안내   : "자세한 내용 <주소>"          → "- 이용안내: <주소>"(알림톡은 버튼)
  // 줄 전체 일치 단언을 새 줄 모양으로 바꿨다. **빠진 고지는 없다** — 약관 제8조 줄 넷과 계약 주체 줄은 그대로 있다.
  test("확정 문자·알림톡의 약관 제8조 줄(대금 지급 · 취소·환불 · 청약철회 · 계좌)과 계약 주체 줄은 그대로", () => {
    const v = renderVariants("confirmed.customer.sms", CUSTOMER);
    const confirmed = ALIMTALK_TEMPLATES.find((t) => t.event === "confirmed")!;
    for (const text of [v.sms, v.lms, confirmed.body]) {
      for (const line of [
        `- ${PAYMENT.smsDeposit}`,
        `- ${PAYMENT.smsBalance}`,
        `- ${PAYMENT.smsAccount}`,
        `  ${PAYMENT.smsAccountHolder}`,
        `- ${CANCELLATION.smsItem}`,
        `- ${WITHDRAWAL.smsLine}`,
      ]) {
        expect(wholeLines(text, line), line).toBe(1);
      }
      const rows = text.split("\n").filter((l) => l.trim().length > 0);
      expect(rows[rows.length - 1]).toBe(CONTRACT_PARTY_LINE);
    }
    for (const text of [v.sms, v.lms]) expect(wholeLines(text, `- 이용안내: ${CUSTOMER.origin}${GUIDE_PATH}`)).toBe(1);
  });
});

// =============================================================================
// 3. 카탈로그 — 온라인 결제 · 완료 화면 · VAT · 위젯 부제
// =============================================================================
describe("3. 카탈로그", () => {
  test("손님 화면(ko·en)에 '온라인 결제' · 'online payment' 0", () => {
    expect(publicLeaves(ko).filter(([, v]) => v.includes("온라인 결제"))).toEqual([]);
    expect(publicLeaves(en).filter(([, v]) => /online payment/i.test(v))).toEqual([]);
  });

  test("위젯 하단 안내 키(home.hero.widget.note)는 ko·en 모두 없다", () => {
    expect(at(ko, "home.hero.widget.note")).toBeUndefined();
    expect(at(en, "home.hero.widget.note")).toBeUndefined();
  });

  test("완료 화면 done.sub — '온라인 결제' 어구만 빠지고 '확정 전까지 비용 없음'·전화 안내는 그대로", () => {
    expect(at(ko, "quote.modal.done.sub")).toBe("확정 전까지는 어떤 비용도 청구되지 않습니다. 급하시면 {tel} 로 전화 주셔도 됩니다.");
    expect(at(en, "quote.modal.done.sub")).toBe("You will not be charged anything before your booking is confirmed. If it is urgent, feel free to call {tel}.");
  });

  test("차량 안내 home.fleet.disc — VAT 문장 삭제(첫 문장만) · 손님 화면에 VAT·부가세 0", () => {
    expect(at(ko, "home.fleet.disc")).toBe("차종별 정원·옵션은 배차 차량에 따라 일부 다를 수 있습니다.");
    expect(at(en, "home.fleet.disc")).toBe("Seating capacity and options may vary slightly depending on the vehicle assigned.");
    expect(publicLeaves(ko).filter(([, v]) => /VAT|부가세|주차료/.test(v))).toEqual([]);
    expect(publicLeaves(en).filter(([, v]) => /\bVAT\b|parking fee/i.test(v))).toEqual([]);
  });

  test("위젯 부제 — ko '…확인 후 연락드리겠습니다' · en 은 같은 뜻(검토 후 연락)", () => {
    expect(at(ko, "home.hero.widget.sub")).toBe("일정과 인원을 남겨 주시면 확인 후 연락드리겠습니다");
    expect(at(en, "home.hero.widget.sub")).toBe("Leave your dates and group size, and we will review them and contact you");
  });
});

// =============================================================================
// 5. 대금 지급 줄 — 홈 이용 방법에서만 빠진다
// =============================================================================
describe("5. 대금 지급 줄(요청 20) — 견적 모달('자세히 보기' 안) · /guide 에는 남는다", () => {
  test("견적 모달의 청약철회 고지는 PAYMENT.line 을 MoreToggle 안에서만 렌더한다", () => {
    const src = codeOf("components/quote/WithdrawalNotice.tsx");
    const more = /<MoreToggle\b[\s\S]*?<\/MoreToggle>/.exec(src)?.[0] ?? "";
    expect(more).toMatch(/PAYMENT\.line/);
    expect(src.replace(more, "")).not.toMatch(/PAYMENT\.line/);
  });

  test("/guide 소스가 대금 지급 줄과 계좌 줄을 렌더한다", () => {
    const src = codeOf("app/[locale]/(legal)/guide/page.tsx");
    expect(src).toMatch(/PAYMENT\.line/);
    expect(src).toMatch(/PAYMENT\.accountLine/);
  });
});
