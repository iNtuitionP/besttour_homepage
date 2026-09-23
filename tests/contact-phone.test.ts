/**
 * P1-7 (1-C) — 예약·상담 전화 배치 계약.
 *
 * 사용자 결정(2026-09-21): **010-6362-6188 이 이 홈페이지의 전화번호다**(예약 문의·상담). 손님에게 "여기로 전화하라" 고 안내하는
 * 모든 자리는 원장 `COMPANY.consultTel`(영문 페이지는 `COMPANY.consultTelIntl` — 해외에서 1566 번호는 걸리지 않는다)이고,
 * 대표전화 1566-6188(`COMPANY.tel`)은 **푸터 사업자 정보 블록의 "대표전화" 한 줄로만** 남는다.
 *
 * 무엇을 잠그는가
 *   1. consultPhone(locale) — 표시 문자열은 로케일별, 링크는 언제나 `tel:+821063626188`(원장 국제 표기에서 만든다 — 번호를 다시 적지 않는다).
 *   2. 원장 UI 라벨 — "예약·상담 전화" / "Bookings & inquiries".
 *   3. 소스 — 전화 안내 자리는 전부 consultPhone 을 거치고, `COMPANY.tel` 을 읽는 공개 화면 파일은 푸터 하나(사업자 정보 한 줄)뿐이다.
 *   4. 문자 — 고객 문자(접수·확정)의 "문의"·"변경·취소" 번호는 예약·상담 전화다.
 *   5. 렌더(EN_BASE_URL 이 있을 때만, GET) — 헤더·플로팅은 010-6362-6188 · 영문은 +82 형식 · 1566-6188 은 푸터 사업자 정보 밖에 없다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { CONSULT_TEL_HREF, consultPhone } from "@/lib/contact-phone";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";
import { renderVariants } from "@/lib/notify/templates";

import { findElements, findText } from "./helpers/hangul-html";
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
const MAIN = "1566-6188";

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
    expect(code).not.toMatch(/6362|6188|1566/);
    expect(code).toMatch(/COMPANY\.consultTelIntl/);
    expect(code).toMatch(/COMPANY\.consultTel\b/);
  });
});

describe("2. 라벨 — 예약·상담 전화 / Bookings & inquiries", () => {
  test("ko 는 원장 LEGAL_LABELS 그대로, en 은 확정 영문", () => {
    expect(LEGAL_LABELS.contact.consultTel).toBe("예약·상담 전화");
    expect(ledgerUi("ko").labels.contact.consultTel).toBe(LEGAL_LABELS.contact.consultTel);
    expect(ledgerUi("en").labels.contact.consultTel).toBe("Bookings & inquiries");
  });

  test("대표전화 라벨은 그대로 남는다(푸터 사업자 정보 한 줄)", () => {
    expect(ledgerUi("ko").labels.contact.tel).toBe("대표전화");
  });
});

describe("3. 소스 — 전화 안내는 consultPhone, 1566 은 푸터 사업자 정보 한 줄", () => {
  const PUBLIC = [...walk("app"), ...walk("components")].filter((f) => /\.tsx?$/.test(f) && !f.startsWith("app/admin/") && !f.startsWith("components/admin/"));

  test("COMPANY.tel 을 읽는 공개 화면 파일은 Footer.tsx 하나, 그 안에서도 사업자 정보의 대표전화 한 줄뿐이다", () => {
    const readers = PUBLIC.filter((f) => /\bCOMPANY\.tel\b/.test(codeOf(f)));
    expect(readers).toEqual(["components/layout/Footer.tsx"]);
    const footer = codeOf("components/layout/Footer.tsx");
    expect(footer.match(/\bCOMPANY\.tel\b/g)).toHaveLength(1);
    expect(footer).toMatch(/\{\s*label:\s*contactLabels\.tel,\s*value:\s*COMPANY\.tel\s*\}/);
  });

  test.for([
    ["components/layout/Header.tsx"],
    ["components/layout/FloatingContact.tsx"],
    ["components/layout/Footer.tsx"],
    ["components/home/NoticeSection.tsx"],
    ["app/[locale]/(site)/fares/page.tsx"],
    ["app/[locale]/(site)/not-found.tsx"],
    ["app/[locale]/(site)/quote/page.tsx"],
    ["app/[locale]/(site)/quote/done/page.tsx"],
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
    for (const f of ["components/quote/QuoteWizard.tsx", "components/reservation-check/CheckForm.tsx", "components/reservation-check/ReservationCard.tsx"]) {
      const code = codeOf(f);
      expect(code, f).not.toMatch(/tel:\$\{tel\}/);
      expect(code, f).toMatch(/href=\{tel\.href\}/);
    }
  });

  test("messages 에 전화번호 리터럴이 없다 — {tel} 보간만", () => {
    for (const f of ["messages/ko.json", "messages/en.json"]) {
      const raw = read(f);
      for (const n of [CONSULT, CONSULT_INTL, MAIN, COMPANY.mobile]) expect(raw.includes(n), `${f}: ${n}`).toBe(false);
    }
  });
});

describe("4. 고객 문자 — 문의·변경·취소 번호는 예약·상담 전화", () => {
  const vars = { publicCode: "BT12ABCD", origin: "https://bestour.co.kr" };
  test.for([["created.customer.sms"], ["confirmed.customer.sms"]] as const)("%s — sms·lms 모두 010-6362-6188, 1566-6188 없음", ([key]) => {
    const r = renderVariants(key, vars);
    for (const text of [r.sms, r.lms]) {
      expect(text).toContain(CONSULT);
      expect(text).not.toContain(MAIN);
    }
  });
});

// =============================================================================
// 5. 렌더 실측 — EN_BASE_URL(예: http://localhost:3000) 이 있을 때만. GET 만 한다.
// =============================================================================
const BASE = process.env.EN_BASE_URL;

/** 1566-6188 이 나와도 되는 유일한 블록 — 푸터 사업자 정보(data-testid="footer-company-info") */
const inFooterCompanyInfo = (ancestors: Array<{ attrs: Map<string, string> }>) =>
  ancestors.some((a) => a.attrs.get("data-testid") === "footer-company-info");

describe.runIf(Boolean(BASE))("5. 렌더 실측 — 전화 배치 (GET)", { timeout: 120_000 }, () => {
  const html = async (p: string) => {
    const res = await fetch(`${BASE}${p}`);
    expect(res.status, p).toBe(200);
    return res.text();
  };

  test("/ — 헤더 전화 · 플로팅 전화 버튼 · 모바일 패널 버튼이 010-6362-6188 (tel:+821063626188)", async () => {
    const page = await html("/");
    const links = findElements(page, (tag, a) => tag === "a" && a.get("href") === "tel:+821063626188");
    expect(links.length, "예약·상담 전화 링크").toBeGreaterThanOrEqual(3);
    const header = links.filter((l) => l.ancestors.some((a) => a.tag === "header"));
    expect(header.length, "헤더 안(줄 + 모바일 패널)").toBeGreaterThanOrEqual(2);
    const floating = findElements(page, (tag, a) => tag === "a" && a.get("href") === "tel:+821063626188" && (a.get("aria-label") ?? "").includes(CONSULT));
    expect(floating.length).toBeGreaterThanOrEqual(2);
    expect(findText(page, CONSULT).length).toBeGreaterThan(0);
  });

  test("/en — 표시는 +82 10-6362-6188, 한국어 표기 010-… 는 전화 안내에 쓰지 않는다", async () => {
    const page = await html("/en");
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
    ["/fares"],
    ["/fleet"],
    ["/quote"],
    ["/quote/done"],
    ["/reservation/check"],
    ["/notices"],
    ["/en"],
    ["/en/about"],
    ["/en/fares"],
    ["/en/quote"],
    ["/guide"],
    ["/privacy"],
    ["/terms"],
    ["/en/guide"],
  ] as const)("%s — 1566-6188 은 푸터 사업자 정보 블록 밖에 렌더되지 않는다", async ([route]) => {
    const page = await html(route);
    const outside = [...findText(page, MAIN), ...findText(page, "15666188")].filter((h) => !inFooterCompanyInfo(h.ancestors));
    expect(outside.map((h) => `${h.where}: ${h.value}`)).toEqual([]);
  });

  test("(site) 화면에는 푸터 사업자 정보에 대표전화 1566-6188 이 한 줄 있다", async () => {
    for (const route of ["/", "/en/about"]) {
      const page = await html(route);
      const inside = findText(page, MAIN).filter((h) => inFooterCompanyInfo(h.ancestors) && h.where === "text");
      expect(inside.length, route).toBe(1);
    }
  });
});
