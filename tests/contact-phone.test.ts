/**
 * 전화번호 계약 — P1-7 (1-C) 예약·상담 전화 배치 · P7-5 번호 통일 · OF3-C(2026-10-22) 대표번호 추가.
 *
 * OF3-C: 번호가 둘이다 — 대표번호 1566-6189(원장 COMPANY.mainTel · 국내 전용) 와 예약·상담 010-6362-6188(consultTel).
 *   헤더(줄 + 모바일 패널) · 푸터 큰 번호 · 푸터 사업자 정보의 전화 줄(ko) = mainPhone(locale) — 한국어 화면만 1566, 영문은 consultPhone 과 같은 +82 번호.
 *   그 밖의 자리(플로팅 · 접수 완료 · 예약 조회 · 오류 화면 · 회사소개 · 문자 · 보호책임자)는 예약·상담 전화 그대로. 푸터 큰 번호 아래에 "예약 문의 010-…" 한 줄(ko 만).
 *   옛 대표전화 1566-6188 은 끝자리가 다르다 — 아래 §0 의 차단은 그대로다.
 *   (아래 §1~§4 의 설명 중 "번호 하나" 는 OF3-C 이전의 서술이다 — 단언은 현행 기준으로 고쳤다.)
 *
 * 사용자 결정(2026-09-21): **010-6362-6188 이 이 홈페이지의 전화번호다**(예약 문의·상담). 손님에게 "여기로 전화하라" 고 안내하는
 * 모든 자리는 원장 `COMPANY.consultTel`(영문 페이지는 `COMPANY.consultTelIntl` — +82 표기)이다.
 * 사용자 결정(2026-10-09, P7-5): **모든 전화 관련 번호는 010-6362-6188 하나로 통일.** 대표전화 1566-6188 · 사장님 휴대전화
 * 010-2048-8585 는 원장에서 필드째 지웠다(`COMPANY.tel`·`COMPANY.mobile` 없음). 푸터 사업자 정보의 전화 줄(전자상거래법 §10①)은
 * 줄을 없애지 않고 번호를 예약·상담 전화로 바꿨다. 팩스는 전화가 아니라 남는다.
 *
 * 무엇을 잠그는가
 *   0. 옛 번호 0건 — 배포 표면(app·components·lib·messages·supabase 등)에 1566-6188 · 010-2048-8585(하이픈 유무·+82 변형) 0건,
 *      원장 COMPANY 에 tel·mobile 키 없음.
 *   1. consultPhone(locale) — 표시 문자열은 로케일별, 링크는 언제나 `tel:+821063626188`(원장 국제 표기에서 만든다 — 번호를 다시 적지 않는다).
 *   2. 원장 UI 라벨 — "예약·상담 전화" / "Bookings & inquiries" · 사업자 정보 전화 줄 라벨 · 휴대전화 라벨은 UI 에서 지웠다.
 *   3. 소스 — 전화 안내 자리는 전부 consultPhone 을 거치고, 푸터 사업자 정보의 전화 줄도 consultPhone 값이다.
 *   4. 문자 — 고객 문자(접수·확정)의 "문의"·"변경·취소" 번호는 예약·상담 전화다.
 *   5. 렌더(EN_BASE_URL 이 있을 때만, GET) — 헤더·플로팅은 010-6362-6188 · 영문은 +82 형식 · 옛 번호는 어디에도 없다.
 *   6. 렌더(서버 컴포넌트를 직접 불러 renderToStaticMarkup) — 푸터 사업자 정보 · 홈 고객센터 카드 · 회사소개 표 · 이용안내 연락처,
 *      ko·en 각각. 옛 번호 0 · 예약·상담 전화 존재 · 한 카드에 같은 번호 한 번.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ locale: "ko" as "ko" | "en" }));

// 서버 컴포넌트를 실제로 불러 렌더한다 — next-intl/server 만 가짜다(로케일은 테스트가 고르고, 문구는 실제 카탈로그). tests/how-it-works.test.ts 와 같은 방식.
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

import GuidePage from "@/app/[locale]/(legal)/guide/page";
import AboutPage from "@/app/[locale]/(site)/about/page";
import { NoticeSection } from "@/components/home/NoticeSection";
import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { CONSULT_TEL_HREF, consultPhone, hasSeparateMainLine, localPhone, mainPhone } from "@/lib/contact-phone";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";
import { renderVariants } from "@/lib/notify/templates";
import type { Notice } from "@/lib/types";

import { findElements, findText } from "./helpers/hangul-html";
import { CREATED_BEFORE_REFUND_CHANGE } from "./helpers/refund-policy-fixtures";
import { RETIRED_PHONE, RETIRED_PHONE_FORMS } from "./helpers/retired-phones";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);

function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const p = path.join(abs, name);
    if (statSync(p).isDirectory()) out.push(...walk(path.relative(ROOT, p)));
    else out.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return out;
}

const CONSULT = "010-6362-6188";
const CONSULT_INTL = "+82 10-6362-6188";
const MAIN = "1566-6189";
const en = JSON.parse(read("messages/en.json")) as { legal: { labels: { contact: Record<string, string> } } };

describe("0. 옛 번호 0건 — 1566-6188 · 010-2048-8585 (P7-5)", () => {
  test("원장 COMPANY 에 tel · mobile 키가 없다 — 사이트의 전화번호는 consultTel 하나(+ 영문 표기 consultTelIntl)", () => {
    expect(Object.keys(COMPANY)).not.toContain("tel");
    expect(Object.keys(COMPANY)).not.toContain("mobile");
    expect(COMPANY.privacyOfficer.phone).toBe(COMPANY.consultTel);
  });

  test("정규식이 표기 변형을 잡는다(자기검증)", () => {
    for (const form of [...RETIRED_PHONE_FORMS, "1566 6188", "010 2048 8585", "+82-10-2048-8585"]) expect(RETIRED_PHONE.test(form), form).toBe(true);
    for (const ok of [CONSULT, CONSULT_INTL, COMPANY.fax, "010-2047-8585"]) expect(RETIRED_PHONE.test(ok), ok).toBe(false);
  });

  // 배포 표면 — 화면·문자·카탈로그·DB 시드로 나가는 파일 전부. 주석까지 본다(다음 사람이 틀린 사실을 읽지 않게).
  // 예외 하나: 원장(lib/legal/disclosures.ts)은 "필드째 지웠다" 는 이력 주석이 옛 번호를 말한다 — 원장은 컨트롤러 소유라 코드(주석 제거)만 본다.
  const TEXT = /\.(tsx?|mts|cts|mjs|cjs|js|jsx|json|css|scss|sql|toml|txt|xml|html|svg|webmanifest|md)$/;
  const LEDGER = "lib/legal/disclosures.ts";
  const SURFACE = [
    ...["app", "components", "lib", "messages", "supabase", "actions", "i18n", "styles", "public"].flatMap(walk),
    "middleware.ts",
    "next.config.ts",
    "vercel.json",
  ].filter((f) => TEXT.test(f) && !f.startsWith("supabase/.temp/"));

  test("표면 목록이 비어 있지 않다(자기검증)", () => {
    for (const f of ["components/layout/Footer.tsx", "messages/ko.json", "messages/en.json", LEDGER, "lib/notify/templates.ts"]) expect(SURFACE).toContain(f);
    expect(SURFACE.some((f) => f.startsWith("supabase/migrations/"))).toBe(true);
  });

  test("배포 표면 어디에도 옛 번호가 없다(하이픈 유무 · +82 표기 포함)", () => {
    const hits: string[] = [];
    for (const f of SURFACE) {
      const text = f === LEDGER ? codeOf(f) : read(f);
      text.split("\n").forEach((line, i) => {
        if (RETIRED_PHONE.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe("1. consultPhone — 표시는 로케일별, 링크는 E.164", () => {
  test("원장 값", () => {
    expect(COMPANY.consultTel).toBe(CONSULT);
    expect(COMPANY.consultTelIntl).toBe(CONSULT_INTL);
  });

  test("ko → 010-6362-6188 · en → +82 10-6362-6188 · 둘 다 tel:+821063626188", () => {
    expect(consultPhone("ko")).toEqual({ display: CONSULT, href: "tel:+821063626188" });
    expect(consultPhone("en")).toEqual({ display: CONSULT_INTL, href: "tel:+821063626188" });
    expect(CONSULT_TEL_HREF).toBe("tel:+821063626188");
  });

  test("링크는 원장 국제 표기에서 만든다 — 모듈에 번호 리터럴이 없다", () => {
    const code = codeOf("lib/contact-phone.ts");
    expect(code).not.toMatch(/6362|6188|6189|1566/);
    expect(code).toMatch(/COMPANY\.consultTelIntl/);
    expect(code).toMatch(/COMPANY\.consultTel\b/);
    expect(code).toMatch(/COMPANY\.mainTel\b/);
  });
});

describe("1-b. mainPhone — 대표번호 (OF3-C)", () => {
  test("원장 값 — mainTel 은 1566-6189 (옛 1566-6188 이 아니다)", () => {
    expect(COMPANY.mainTel).toBe(MAIN);
    expect(COMPANY.mainTel).not.toMatch(RETIRED_PHONE);
  });

  test("ko → 1566-6189 · tel:15666189 (국내 전용 번호 — 국가번호 없이)", () => {
    expect(mainPhone("ko")).toEqual({ display: MAIN, href: "tel:15666189" });
  });

  test("en(그 밖의 로케일) → consultPhone 과 같은 값 — 1566 은 해외에서 걸리지 않으므로 영문 화면에 쓰지 않는다", () => {
    expect(mainPhone("en")).toEqual(consultPhone("en"));
    expect(mainPhone("fr")).toEqual(consultPhone("fr"));
    expect(mainPhone("en").display).toBe(CONSULT_INTL);
    expect(mainPhone("en").href).toBe("tel:+821063626188");
    expect(JSON.stringify(mainPhone("en"))).not.toContain("1566");
  });

  test("hasSeparateMainLine — ko 만 참(대표번호가 예약·상담 번호와 다른 화면)", () => {
    expect(hasSeparateMainLine("ko")).toBe(true);
    expect(hasSeparateMainLine("en")).toBe(false);
  });

  test("옛 대표전화 차단 정규식은 새 대표번호를 막지 않고, 옛 번호는 계속 막는다", () => {
    expect(RETIRED_PHONE.test("1566-6188")).toBe(true);
    expect(RETIRED_PHONE.test(MAIN)).toBe(false);
  });
});

describe("2. 라벨", () => {
  test("예약·상담 전화 — ko 는 원장 LEGAL_LABELS 그대로, en 은 확정 영문", () => {
    expect(LEGAL_LABELS.contact.consultTel).toBe("예약·상담 전화");
    expect(ledgerUi("ko").labels.contact.consultTel).toBe(LEGAL_LABELS.contact.consultTel);
    expect(ledgerUi("en").labels.contact.consultTel).toBe("Bookings & inquiries");
  });

  test("대표번호(mainTel) — ko 는 원장 LEGAL_LABELS 그대로, en 은 'Main line' (OF3-C)", () => {
    expect(LEGAL_LABELS.contact.mainTel).toBe("대표번호");
    expect(ledgerUi("ko").labels.contact.mainTel).toBe(LEGAL_LABELS.contact.mainTel);
    expect(ledgerUi("en").labels.contact.mainTel).toBe("Main line");
    expect(en.legal.labels.contact.mainTel).toBe("Main line");
  });

  test("사업자 정보 전화 줄 라벨(tel) — ko 는 원장 라벨 그대로, en 은 'Phone'", () => {
    expect(ledgerUi("ko").labels.contact.tel).toBe(LEGAL_LABELS.contact.tel);
    expect(ledgerUi("en").labels.contact.tel).toBe("Phone");
  });

  test("휴대전화 라벨은 공개 UI 라벨에서 지웠다(쓰는 화면이 없다) — ko·en 둘 다", () => {
    expect(Object.keys(ledgerUi("ko").labels.contact)).not.toContain("mobile");
    expect(Object.keys(ledgerUi("en").labels.contact)).not.toContain("mobile");
    expect(Object.keys(en.legal.labels.contact)).not.toContain("mobile");
  });
});

describe("3. 소스 — 전화는 consultPhone, 옛 필드를 읽는 곳 0", () => {
  const PUBLIC = [...walk("app"), ...walk("components"), ...walk("lib")].filter((f) => /\.tsx?$/.test(f));

  test("COMPANY.tel · COMPANY.mobile 을 읽는 소스가 없다", () => {
    const readers = PUBLIC.filter((f) => /\bCOMPANY\.(tel|mobile)\b/.test(codeOf(f)));
    expect(readers).toEqual([]);
  });

  test("푸터 사업자 정보의 전화 줄은 대표번호 값이다(줄은 남는다 — 전자상거래법 §10① · OF3-C) · 큰 번호 아래 줄은 예약·상담 전화 · 휴대전화 줄은 없다", () => {
    const footer = codeOf("components/layout/Footer.tsx");
    expect(footer).toMatch(/const phone = mainPhone\(\s*locale\s*\)/);
    expect(footer).toMatch(/const booking = consultPhone\(\s*locale\s*\)/);
    expect(footer).toMatch(/\{\s*label:\s*contactLabels\.tel,\s*value:\s*phone\.display\s*\}/);
    expect(footer).not.toMatch(/contactLabels\.mobile/);
  });

  test("헤더 — 줄의 번호와 모바일 패널 call 이 둘 다 대표번호(mainPhone)다 · 플로팅 전화는 예약·상담 전화 그대로", () => {
    const header = codeOf("components/layout/Header.tsx");
    expect(header).toMatch(/const phone = mainPhone\(\s*locale\s*\)/);
    expect(header).not.toMatch(/consultPhone/);
    expect(header).toMatch(/call=\{\{\s*href:\s*phone\.href/);
    expect(codeOf("components/layout/FloatingContact.tsx")).not.toMatch(/mainPhone/);
  });

  test("접수 완료 · 예약 조회 · 오류 화면 · 회사소개 · 홈 고객센터는 대표번호를 쓰지 않는다 (010 그대로)", () => {
    for (const f of [
      "components/quote/QuickQuoteModal.tsx",
      "components/reservation-check/CheckForm.tsx",
      "components/reservation-check/ReservationCard.tsx",
      "app/[locale]/(site)/reservation/check/page.tsx",
      "app/[locale]/(site)/error.tsx",
      "app/[locale]/(site)/not-found.tsx",
      "app/not-found.tsx",
      "app/[locale]/(site)/about/page.tsx",
      "components/home/NoticeSection.tsx",
      "components/home/Hero.tsx",
      "lib/notify/templates.ts",
    ]) {
      expect(codeOf(f), f).not.toMatch(/mainPhone|mainTel/);
    }
  });

  test.for([
    ["components/layout/FloatingContact.tsx"],
    ["components/layout/Footer.tsx"],
    ["components/home/NoticeSection.tsx"],
    // P7-6: /fares(운임료 CTA 의 전화 링크)는 페이지째 지웠다.
    ["app/[locale]/(site)/not-found.tsx"],
    // P3-8: 위저드 두 화면 대신 홈 간편 견적 — 모달의 전화 폴백은 Hero(서버)가 고른다.
    ["components/home/Hero.tsx"],
    ["app/[locale]/(site)/reservation/check/page.tsx"],
    ["app/[locale]/(site)/about/page.tsx"],
    ["app/[locale]/(legal)/guide/page.tsx"],
  ] as const)("%s — consultPhone(locale) 로 번호를 고른다", ([file]) => {
    expect(codeOf(file)).toMatch(/\bconsultPhone\(\s*locale\s*\)/);
  });

  test("로케일 밖 404·클라이언트 에러 화면도 예약·상담 전화로 건다", () => {
    const root = codeOf("app/not-found.tsx");
    expect(root).toMatch(/COMPANY\.consultTel\b/);
    expect(root).toMatch(/href=\{CONSULT_TEL_HREF\}/);
    const err = codeOf("app/[locale]/(site)/error.tsx");
    expect(err).toMatch(/\bconsultPhone\(\s*locale\s*\)/);
  });

  test("모바일 메뉴 패널 맨 아래에 예약·상담 전화 버튼이 있다 (목업 variant-08 .drawer .btn)", () => {
    const menu = codeOf("components/layout/MobileMenu.tsx");
    expect(menu).toMatch(/href=\{call\.href\}/);
    expect(menu).toMatch(/data-testid="mobile-menu-call"/);
    const header = codeOf("components/layout/Header.tsx");
    expect(header).toMatch(/call=\{/);
  });

  test("클라이언트 컴포넌트는 표시 문자열과 링크를 따로 받는다 — tel: 에 표시 문자열(+82 공백)을 넣지 않는다", () => {
    for (const f of ["components/quote/QuickQuoteModal.tsx", "components/reservation-check/CheckForm.tsx", "components/reservation-check/ReservationCard.tsx"]) {
      const code = codeOf(f);
      expect(code, f).not.toMatch(/tel:\$\{tel\}/);
      expect(code, f).toMatch(/href=\{tel\.href\}/);
    }
  });

  test("messages 에 전화번호 리터럴이 없다 — {tel} 보간만 (옛 번호는 §0 이 본다)", () => {
    for (const f of ["messages/ko.json", "messages/en.json"]) {
      const raw = read(f);
      for (const n of [CONSULT, CONSULT_INTL, MAIN]) expect(raw.includes(n), `${f}: ${n}`).toBe(false);
    }
  });
});

describe("4. 고객 문자 — 문의·변경·취소 번호는 예약·상담 전화", () => {
  // OF-T2-3: 고객 변수에 접수 시각(created_at)이 생겼다 — 판과 무관한 전화 줄만 본다.
  const vars = { publicCode: "BT12ABCD", origin: "https://bestour.co.kr", createdAt: CREATED_BEFORE_REFUND_CHANGE };
  test.for([["created.customer.sms"], ["confirmed.customer.sms"]] as const)("%s — sms·lms 모두 010-6362-6188, 옛 번호 없음", ([key]) => {
    const r = renderVariants(key, vars);
    for (const text of [r.sms, r.lms]) {
      expect(text).toContain(CONSULT);
      expect(text).not.toMatch(RETIRED_PHONE);
    }
  });
});

// =============================================================================
// 5. 렌더 실측 — EN_BASE_URL(예: http://localhost:3000) 이 있을 때만. GET 만 한다.
// =============================================================================
const BASE = process.env.EN_BASE_URL;

/** 푸터 사업자 정보 블록(data-testid="footer-company-info") 안인가 */
const inFooterCompanyInfo = (ancestors: Array<{ attrs: Map<string, string> }>) =>
  ancestors.some((a) => a.attrs.get("data-testid") === "footer-company-info");

describe.runIf(Boolean(BASE))("5. 렌더 실측 — 전화 배치 (GET)", { timeout: 120_000 }, () => {
  const html = async (p: string) => {
    const res = await fetch(`${BASE}${p}`);
    expect(res.status, p).toBe(200);
    return res.text();
  };

  test("/ — 헤더(줄 + 모바일 패널)·푸터 큰 번호는 대표번호 1566-6189(tel:15666189), 플로팅 전화·푸터 예약 문의 줄은 010-6362-6188(tel:+821063626188)", async () => {
    const page = await html("/");
    const main = findElements(page, (tag, a) => tag === "a" && a.get("href") === "tel:15666189");
    expect(main.length, "대표번호 링크").toBeGreaterThanOrEqual(3);
    const header = main.filter((l) => l.ancestors.some((a) => a.tag === "header"));
    expect(header.length, "헤더 안(줄 + 모바일 패널)").toBeGreaterThanOrEqual(2);
    const footer = main.filter((l) => l.ancestors.some((a) => a.tag === "footer"));
    expect(footer.length, "푸터 큰 번호").toBeGreaterThanOrEqual(1);
    const consult = findElements(page, (tag, a) => tag === "a" && a.get("href") === "tel:+821063626188");
    expect(consult.length, "예약·상담 전화 링크(플로팅 + 푸터 줄)").toBeGreaterThanOrEqual(3);
    const floating = findElements(page, (tag, a) => tag === "a" && a.get("href") === "tel:+821063626188" && (a.get("aria-label") ?? "").includes(CONSULT));
    expect(floating.length).toBeGreaterThanOrEqual(2);
    expect(findText(page, MAIN).length).toBeGreaterThan(0);
    expect(findText(page, CONSULT).length).toBeGreaterThan(0);
  });

  test("/en — 표시는 +82 10-6362-6188 뿐이다. 대표번호 1566 은 영문 화면 어디에도 없다(해외에서 걸리지 않는다)", async () => {
    const page = await html("/en");
    expect(findText(page, "1566")).toEqual([]);
    expect(findElements(page, (tag, a) => tag === "a" && (a.get("href") ?? "").startsWith("tel:15"))).toEqual([]);
    const links = findElements(page, (tag, a) => tag === "a" && a.get("href") === "tel:+821063626188");
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const l of links) {
      const label = l.attrs.get("aria-label");
      if (label) expect(label, "영문 aria-label").toContain(CONSULT_INTL);
    }
    expect(findText(page, CONSULT_INTL).length).toBeGreaterThan(0);
  });

  test.for([
    ["/"],
    ["/about"],
    ["/fleet"],
    ["/reservation/check"],
    ["/notices"],
    ["/en"],
    ["/en/about"],
    ["/en/fleet"],
    ["/guide"],
    ["/privacy"],
    ["/terms"],
    ["/en/guide"],
  ] as const)("%s — 옛 번호(1566-6188 · 010-2048-8585)가 어디에도 렌더되지 않는다", async ([route]) => {
    const page = await html(route);
    const hits = RETIRED_PHONE_FORMS.flatMap((n) => findText(page, n));
    expect(hits.map((h) => `${h.where}: ${h.value}`)).toEqual([]);
  });

  test("(site) 화면의 푸터 사업자 정보에 전화 줄이 있다 — ko 는 대표번호, en 은 예약·상담 전화", async () => {
    for (const [route, display] of [["/", MAIN], ["/en/about", CONSULT_INTL]] as const) {
      const page = await html(route);
      const inside = findText(page, display).filter((h) => inFooterCompanyInfo(h.ancestors) && h.where === "text");
      expect(inside.length, route).toBeGreaterThanOrEqual(1);
    }
  });
});

// =============================================================================
// 6. 렌더 — 서버 컴포넌트를 불러 renderToStaticMarkup (서버를 띄우지 않는다)
// =============================================================================
type El = ReactElement<Record<string, unknown>>;
/** 아직 펼치지 않은 React 요소 트리에서 조건에 맞는 첫 요소 — 비동기 자식(CompanyIntro 등)은 렌더하지 않고 필요한 블록만 꺼낸다. */
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
const count = (html: string, s: string) => html.split(s).length - 1;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const NOTICES: readonly Notice[] = [{ id: 1, title: "공지", body: "본문", category: "notice", publishedAt: "2026-10-01", active: true }];
const params = (locale: string) => ({ params: Promise.resolve({ locale }) });
/** 휴대전화 라벨 — UI 라벨에서는 지웠으므로 원장(ko)·옛 영문 라벨을 직접 본다 */
const MOBILE_LABELS = ["휴대전화", "Mobile"];

describe.each([
  ["ko", CONSULT],
  ["en", CONSULT_INTL],
] as const)("6. 렌더 (%s) — 옛 번호 0 · 예약·상담 전화 %s", (locale, display) => {
  const ui = ledgerUi(locale);
  const fax = localPhone(COMPANY.fax, locale).display;
  const other = locale === "ko" ? CONSULT_INTL : CONSULT;

  function common(html: string) {
    expect(html).not.toMatch(RETIRED_PHONE);
    expect(html).toContain(display);
    // 다른 로케일의 표기가 섞이지 않는다(+82 10-… 안의 "10-6362-6188" 은 "010-…" 와 겹치지 않는다)
    expect(html).not.toContain(other);
    for (const l of MOBILE_LABELS) expect(html, `휴대전화 라벨 ${l}`).not.toContain(`>${l}<`);
  }

  // OF3-C: 사업자 정보의 전화 줄은 mainPhone(locale) — ko 는 대표번호, en 은 예약·상담 전화(+82). 보호책임자 연락처는 어디서나 예약·상담 번호.
  const mainDisplay = mainPhone(locale).display;

  test("푸터 사업자 정보 — 전화 줄 = 대표번호(ko)/+82 예약·상담(en) · 보호책임자 = 예약·상담 · 팩스 줄 그대로 · 휴대전화 줄 없음", async () => {
    state.locale = locale;
    const html = block(await Footer(), (el) => el.props["data-testid"] === "footer-company-info", "footer-company-info");
    expect(html).not.toMatch(RETIRED_PHONE);
    expect(html).not.toContain(other);
    for (const l of MOBILE_LABELS) expect(html, `휴대전화 라벨 ${l}`).not.toContain(`>${l}<`);
    const telRow = `>${esc(ui.labels.contact.tel)}</span><span>${esc(mainDisplay)}</span>`;
    const officerRow = `>${esc(ui.labels.officer.phone)}</span><span>${esc(display)}</span>`;
    if (locale === "ko") {
      expect(count(html, telRow), "전화 줄 = 1566-6189").toBe(1);
      expect(count(html, officerRow), "보호책임자 연락처 = 010").toBe(1);
      expect(count(html, esc(MAIN))).toBe(1);
      expect(count(html, esc(display))).toBe(1);
    } else {
      // en — 두 라벨이 모두 "Phone", 두 값이 모두 +82 번호라 같은 모양이 두 번이다. 1566 은 없다.
      expect(count(html, telRow) + (telRow === officerRow ? 0 : count(html, officerRow))).toBe(2);
      expect(count(html, esc(display))).toBe(2);
      expect(html).not.toContain("1566");
    }
    expect(html).toContain(`>${esc(ui.labels.contact.fax)}</span><span>${esc(fax)}</span>`);
  });

  test("푸터 큰 번호 = 대표번호(ko)/+82(en) 링크 · ko 에만 그 아래 '예약 문의 010-…' 한 줄(en 은 같은 번호 줄을 중복하지 않는다)", async () => {
    state.locale = locale;
    const html = block(await Footer(), (el) => el.props["data-testid"] === "footer-brand", "footer-brand 열(로고 · 큰 번호)");
    // 큰 번호 링크
    const mainHref = mainPhone(locale).href;
    expect(html).toContain(`href="${mainHref}"`);
    // ko: 예약 문의 줄의 링크 하나만 예약·상담 번호 · en: 큰 번호 자체가 예약·상담 번호(한 번)
    expect(count(html, `href="${CONSULT_TEL_HREF}"`)).toBe(1);
    const booking = html.match(/<[^>]*data-testid="footer-booking-line"[^>]*>([\s\S]*?)<\/(?:p|div)>/);
    if (locale === "ko") {
      expect(booking, "예약 문의 줄").not.toBeNull();
      expect(booking![1]).toContain(esc(CONSULT));
      expect(booking![1]).toContain(`href="${CONSULT_TEL_HREF}"`);
      expect(html).toContain(`aria-label="${esc(ui.labels.contact.mainTel)} ${esc(MAIN)}"`);
    } else {
      expect(booking, "en 에는 예약 문의 줄이 없다").toBeNull();
      expect(html).not.toContain("1566");
      expect(html).toContain(`aria-label="${esc(ui.labels.contact.consultTel)} ${esc(CONSULT_INTL)}"`);
    }
  });

  test("헤더 — 줄의 번호와 모바일 패널 call 이 같은 번호(ko 대표번호 · en +82)이고 라벨이 번호 종류를 따른다", async () => {
    state.locale = locale;
    const tree = await Header();
    const menu = findEl(tree, (el) => typeof el.props.call === "object" && el.props.call !== null);
    expect(menu, "MobileMenu").toBeDefined();
    const call = menu!.props.call as { href: string; label: string; number: string };
    expect(call.number).toBe(mainDisplay);
    expect(call.href).toBe(mainPhone(locale).href);
    expect(call.label).toBe(locale === "ko" ? ui.labels.contact.mainTel : ui.labels.contact.consultTel);
    const row = findEl(tree, (el) => el.type === "a" && el.props.href === mainPhone(locale).href && typeof el.props["aria-label"] === "string");
    expect(row, "헤더 줄의 전화 링크").toBeDefined();
    expect(row!.props["aria-label"]).toBe(`${call.label} ${mainDisplay}`);
    if (locale === "en") expect(JSON.stringify([call, row!.props["aria-label"]])).not.toContain("1566");
  });

  test("홈 고객센터 카드 — 예약·상담 전화 한 번(링크) · 팩스 · 휴대전화 줄 없음", async () => {
    state.locale = locale;
    const html = block(await NoticeSection({ notices: NOTICES }), (el) => el.type === "aside", "고객센터 카드(aside)");
    common(html);
    expect(count(html, esc(display))).toBe(1);
    expect(html).toContain(`<dt>${esc(ui.labels.contact.consultTel)}</dt><dd><a href="${CONSULT_TEL_HREF}">${esc(display)}</a></dd>`);
    expect(html).toContain(`<dt>${esc(ui.labels.contact.fax)}</dt><dd>${esc(fax)}</dd>`);
    expect(count(html, "<dt>")).toBe(3);
  });

  test("회사소개 회사 정보 표 — 예약·상담 전화 한 번 · 팩스 · 휴대전화 줄 없음", async () => {
    state.locale = locale;
    const html = block(await AboutPage(params(locale)), (el) => el.props.testId === "company-facts", "company-facts");
    common(html);
    expect(count(html, esc(display))).toBe(1);
    expect(html).toContain(esc(ui.labels.contact.consultTel));
    expect(html).toContain(esc(fax));
  });

  test("이용안내 연락처 — 예약·상담 전화 한 번 · 팩스 · 휴대전화 줄 없음", async () => {
    state.locale = locale;
    const tree = await GuidePage(params(locale));
    const html = block(tree, (el) => (el.props.section as { key?: string } | undefined)?.key === "contact", "이용안내 연락처 절");
    common(html);
    expect(count(html, esc(display))).toBe(1);
    expect(html).toContain(esc(LEGAL_LABELS.contact.consultTel));
    // OF3-C(리뷰 F7): 대표번호 행은 국내 전용 — ko 에서만 렌더하고 en 에서는 행(라벨·값) 자체를 뺀다. 대표번호 → 예약·상담 순.
    if (locale === "ko") {
      expect(count(html, esc(MAIN))).toBe(1);
      expect(html).toContain(esc(LEGAL_LABELS.contact.mainTel));
      expect(html.indexOf(esc(MAIN))).toBeLessThan(html.indexOf(esc(CONSULT)));
    } else {
      expect(html).not.toContain("1566");
      expect(html).not.toContain(esc(LEGAL_LABELS.contact.mainTel));
    }
    expect(html).toContain(esc(fax));
    expect(html).toContain(esc(COMPANY.email));
    expect(html).toContain(esc(COMPANY.address));
  });
});
