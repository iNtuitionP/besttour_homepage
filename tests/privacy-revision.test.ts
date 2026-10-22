/**
 * OF3-H(R3 §C) — 처리방침 개정 표시. 시행일 판정 한 곳(lib/privacy-revision.ts)과 그것을 쓰는 세 곳(/privacy 표시 · 동의 버전 · 네이버 스크립트 게이트)을 잠근다.
 *
 *   1. 원장 값 — effectiveDate − announcedOn ≥ 7일 (처리방침 '변경' 절의 "시행 7일 전부터 공지" 약속을 사람 기억에 맡기지 않는다 · 리뷰 F6)
 *   2. 판정 헬퍼 — KST 달력 날짜 문자열 비교. 시행일 전날 23:59:59.999 KST = 전, 시행일 00:00 KST = 후. 서버 TZ 와 무관.
 *   3. 동의 버전 — consentFields(…, now) 가 접수 시각으로 판을 고른다(모듈 로드 때 굳는 상수가 아니다)
 *   4. /privacy 렌더 — 시행 전: 상단 개정 예정 안내 + '자동 수집 장치' 절에 cookiesAddendum 미리보기("(시행일부터 적용)") · 표시 시행일 = 기존 ·
 *                      시행 후: 안내 없음 + addendum 이 절 본문에 이어 붙음 · 표시 시행일 = 개정 시행일. en 도 같은 구조(한국어 블록은 lang="ko").
 *   5. /privacy 는 /guide 와 같은 ISR(revalidate) — 정적이면 시행일에 저절로 바뀌지 않는다(리뷰 F6)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "ko"),
  setRequestLocale: vi.fn(),
}));

import PrivacyPage, { revalidate as privacyRevalidate } from "@/app/[locale]/(legal)/privacy/page";
import { isKstDateOnOrAfter } from "@/lib/kst";
import { LEGAL_PAGES, PRIVACY_POLICY_REVISION, PRIVACY_POLICY_SECTIONS } from "@/lib/legal/disclosures";
import { privacyEffectiveDate, privacyRevisionActive } from "@/lib/privacy-revision";
import { consentFields, privacyPolicyVersion } from "@/lib/reservations/consent";

import { findUnmarkedHangul } from "./helpers/hangul-html";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

const REV = PRIVACY_POLICY_REVISION;
const OLD = LEGAL_PAGES.privacy.effectiveDate;
const DAY = 24 * 60 * 60 * 1000;
const utcDay = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** 시행 전 · 시행 직전 · 시행 직후 · 시행 뒤 */
const BEFORE = new Date("2026-10-25T12:00:00+09:00");
const EFFECTIVE_START = new Date(`${REV.effectiveDate}T00:00:00+09:00`);
const EDGE_BEFORE = new Date(EFFECTIVE_START.getTime() - 1); // 시행일 전날 23:59:59.999 KST
const EDGE_AT = EFFECTIVE_START; // 시행일 00:00:00.000 KST
const AFTER = new Date(EFFECTIVE_START.getTime() + 3 * DAY);

afterEach(() => {
  vi.useRealTimers();
});

describe("1. 원장 값 — 7일 전 공지 약속", () => {
  test("effectiveDate · announcedOn 은 YYYY-MM-DD 실존 날짜", () => {
    for (const v of [REV.effectiveDate, REV.announcedOn]) {
      expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10)).toBe(v);
    }
  });

  test("시행일 − 공지일 ≥ 7일 — 배포가 늦어지면 두 값을 함께 민다(이 테스트가 막는다)", () => {
    const gap = (utcDay(REV.effectiveDate) - utcDay(REV.announcedOn)) / DAY;
    expect(gap, `시행일 ${REV.effectiveDate} − 공지일 ${REV.announcedOn} = ${gap}일`).toBeGreaterThanOrEqual(7);
  });

  test("개정 시행일은 기존 시행일보다 뒤다", () => {
    expect(utcDay(REV.effectiveDate)).toBeGreaterThan(utcDay(OLD));
  });

  test("처리방침 '변경' 절이 약속하는 문구와 같은 7일이다", () => {
    const changes = PRIVACY_POLICY_SECTIONS.find((s) => s.key === "changes") as { body: string };
    expect(changes.body).toMatch(/7일 전/);
  });

  test("summary 는 10-10 · 10-15 변경을 사실대로 적는다(소급 공지로 꾸미지 않는다 — 리뷰 F5)", () => {
    expect(REV.summary).toContain("2026-10-10");
    expect(REV.summary).toContain("2026-10-15");
    expect(REV.cookiesAddendum.length).toBeGreaterThan(200);
  });
});

describe("2. 시행일 판정 — KST 달력 날짜, 서버 TZ 무관", () => {
  test("isKstDateOnOrAfter — 경계", () => {
    expect(isKstDateOnOrAfter("2026-11-02", new Date("2026-11-01T14:59:59.999Z"))).toBe(false); // KST 11-01 23:59:59.999
    expect(isKstDateOnOrAfter("2026-11-02", new Date("2026-11-01T15:00:00.000Z"))).toBe(true); // KST 11-02 00:00:00
    expect(isKstDateOnOrAfter("2026-11-02", new Date("2026-12-31T00:00:00Z"))).toBe(true);
  });

  test("형식이 틀린 날짜는 throw — 문자열 비교가 조용히 틀린 판을 고르지 않게", () => {
    expect(() => isKstDateOnOrAfter("2026-1-2", new Date())).toThrow();
    expect(() => isKstDateOnOrAfter("", new Date())).toThrow();
  });

  test("privacyRevisionActive · privacyEffectiveDate — 시행 직전 = 기존 · 시행 00:00 KST = 개정", () => {
    expect(privacyRevisionActive(BEFORE)).toBe(false);
    expect(privacyRevisionActive(EDGE_BEFORE)).toBe(false);
    expect(privacyRevisionActive(EDGE_AT)).toBe(true);
    expect(privacyRevisionActive(AFTER)).toBe(true);
    expect(privacyEffectiveDate(BEFORE)).toBe(OLD);
    expect(privacyEffectiveDate(EDGE_BEFORE)).toBe(OLD);
    expect(privacyEffectiveDate(EDGE_AT)).toBe(REV.effectiveDate);
    expect(privacyEffectiveDate(AFTER)).toBe(REV.effectiveDate);
  });

  test("헬퍼가 원장 두 상수에서만 날짜를 읽는다 — 날짜 리터럴이 없다", () => {
    const code = codeOf("lib/privacy-revision.ts");
    expect(code).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(code).toMatch(/PRIVACY_POLICY_REVISION\.effectiveDate/);
    expect(code).toMatch(/LEGAL_PAGES\.privacy\.effectiveDate/);
  });
});

describe("3. 동의 버전 — 접수 시각으로 판을 고른다", () => {
  const input = { privacyConsent: true, marketingConsent: false, withdrawalConsent: true } as const;

  test("시행 전 접수 = 기존 시행일 · 시행일 00:00 KST 부터 = 개정 시행일", () => {
    expect(privacyPolicyVersion(BEFORE)).toBe(OLD);
    expect(privacyPolicyVersion(EDGE_BEFORE)).toBe(OLD);
    expect(privacyPolicyVersion(EDGE_AT)).toBe(REV.effectiveDate);
    expect(privacyPolicyVersion(AFTER)).toBe(REV.effectiveDate);
  });

  test("consentFields 가 접수 시각(now)으로 privacy_policy_version 을 채운다 — 같은 모듈에서 두 시각이 다른 값을 낸다", () => {
    expect(consentFields(input, BEFORE).privacy_policy_version).toBe(OLD);
    expect(consentFields(input, AFTER).privacy_policy_version).toBe(REV.effectiveDate);
  });

  test("모듈 로드 시 굳는 상수 PRIVACY_POLICY_VERSION 이 없다(소스 · 호출부 전부)", () => {
    expect(codeOf("lib/reservations/consent.ts")).not.toMatch(/PRIVACY_POLICY_VERSION/);
    expect(codeOf("lib/reservations/consent.ts")).toMatch(/privacyEffectiveDate\(now\)/);
    for (const f of ["lib/reservations/create.ts", "actions/reservation.ts"]) {
      try {
        expect(codeOf(f), f).not.toMatch(/PRIVACY_POLICY_VERSION/);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  });
});

describe("4. /privacy 렌더 — 시행 전 · 시행 후", () => {
  const render = async (locale: "ko" | "en", now: Date) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    return renderToStaticMarkup(await PrivacyPage(params(locale)));
  };
  const time = (html: string) => /<time dateTime="([^"]+)"/.exec(html)?.[1];
  /** '자동 수집 장치' 절(<section … data-section-key="cookies">…</section>) */
  const cookiesSection = (html: string) => {
    const m = /<section[^>]*data-section-key="cookies"[^>]*>([\s\S]*?)<\/section>/.exec(html);
    expect(m, "cookies 절").not.toBeNull();
    return m![1];
  };
  const cookiesBody = (PRIVACY_POLICY_SECTIONS.find((s) => s.key === "cookies") as { body: string }).body;

  test.each(["ko", "en"] as const)("%s · 시행 전 — 상단 개정 예정 안내(요약·시행일) + 절에 addendum 미리보기 + 표시 시행일은 기존", async (locale) => {
    const html = await render(locale, BEFORE);
    const notice = /<[^>]*data-testid="privacy-revision-notice"[^>]*>([\s\S]*?)<\/aside>/.exec(html);
    expect(notice, "개정 예정 안내").not.toBeNull();
    expect(notice![1]).toContain(esc(REV.summary));
    expect(notice![1]).toContain(REV.effectiveDate.slice(0, 4)); // 시행일 표기(공개 날짜 틀)
    expect(time(html)).toBe(OLD);
    const sec = cookiesSection(html);
    expect(sec).toContain(esc(cookiesBody));
    expect(count(sec, esc(REV.cookiesAddendum))).toBe(1);
    expect(sec).toMatch(/data-legal="cookies-addendum"[^>]*data-state="pending"/);
    expect(sec).toContain('data-legal="cookies-addendum-mark"');
    // 미리보기는 본문 뒤에 온다
    expect(sec.indexOf(esc(cookiesBody))).toBeLessThan(sec.indexOf(esc(REV.cookiesAddendum)));
  });

  test.each(["ko", "en"] as const)("%s · 시행 직전(전날 23:59:59.999 KST) — 아직 시행 전", async (locale) => {
    const html = await render(locale, EDGE_BEFORE);
    expect(html).toContain('data-testid="privacy-revision-notice"');
    expect(time(html)).toBe(OLD);
  });

  test.each(["ko", "en"] as const)("%s · 시행일 00:00 KST 이후 — 안내 없음 · addendum 이 절 본문에 이어 붙음 · 표시 시행일 = 개정 시행일", async (locale) => {
    for (const now of [EDGE_AT, AFTER]) {
      const html = await render(locale, now);
      expect(html).not.toContain('data-testid="privacy-revision-notice"');
      expect(time(html)).toBe(REV.effectiveDate);
      const sec = cookiesSection(html);
      expect(sec).toContain(esc(cookiesBody));
      expect(count(sec, esc(REV.cookiesAddendum))).toBe(1);
      expect(sec).toMatch(/data-legal="cookies-addendum"[^>]*data-state="active"/);
      expect(sec).not.toContain('data-legal="cookies-addendum-mark"');
      expect(sec).not.toContain("시행일부터 적용");
      expect(sec.indexOf(esc(cookiesBody))).toBeLessThan(sec.indexOf(esc(REV.cookiesAddendum)));
    }
  });

  test("addendum 은 시행 전·후 모두 화면에 한 번만 있다(안내 상자에 중복해 싣지 않는다)", async () => {
    for (const now of [BEFORE, AFTER]) {
      const html = await render("ko", now);
      expect(count(html, esc(REV.cookiesAddendum))).toBe(1);
    }
  });

  test("ko · 시행 전 — 표시는 '시행일부터 적용' 표지가 붙고, ko 마크업에 lang 속성이 새지 않는다", async () => {
    const html = await render("ko", BEFORE);
    const sec = cookiesSection(html);
    expect(sec).toContain("(시행일부터 적용)");
    expect(html).not.toMatch(/data-testid="privacy-revision-notice"[^>]*lang=/);
  });

  test("en — 영문 라벨 + 한국어 원문 블록은 lang=\"ko\" · 라벨 밖 한글 0건(시행 전·후)", async () => {
    for (const now of [BEFORE, AFTER]) {
      const html = await render("en", now);
      expect(findUnmarkedHangul(html), `en /privacy ${now.toISOString()}`).toEqual([]);
    }
    const before = await render("en", BEFORE);
    expect(before).toMatch(/data-testid="privacy-revision-notice"/);
    expect(before).toContain("Upcoming revision");
    expect(before).toContain("(applies from the effective date)");
  });

  test("방문 통계 거부 버튼 · 기존 절 구조는 그대로 — 안내·addendum 이 절 순서를 바꾸지 않는다", async () => {
    for (const now of [BEFORE, AFTER]) {
      const html = await render("ko", now);
      const keys = [...html.matchAll(/data-section-key="([^"]+)"/g)].map((m) => m[1]);
      expect(keys).toEqual(PRIVACY_POLICY_SECTIONS.map((s) => s.key));
    }
  });
});

describe("5. /privacy ISR · 소스 연결", () => {
  test("revalidate = 600 (/guide 와 같은 주기) — 시행일에 저절로 바뀐다", () => {
    expect(privacyRevalidate).toBe(600);
    expect(codeOf("app/[locale]/(legal)/privacy/page.tsx")).toMatch(/export const revalidate = 600;/);
    expect(codeOf("app/[locale]/(legal)/guide/page.tsx")).toMatch(/export const revalidate = 600;/);
  });

  test("페이지는 헬퍼(privacyRevisionActive · privacyEffectiveDate)와 원장 상수를 쓴다 — 날짜 비교를 직접 하지 않는다", () => {
    const src = codeOf("app/[locale]/(legal)/privacy/page.tsx");
    expect(src).toMatch(/privacyRevisionActive\(\s*now\s*\)/);
    expect(src).toMatch(/privacyEffectiveDate\(\s*now\s*\)/);
    expect(src).toMatch(/PRIVACY_POLICY_REVISION\.cookiesAddendum/);
    expect(src).toMatch(/PRIVACY_POLICY_REVISION\.summary/);
    expect(src).not.toMatch(/LEGAL_PAGES\.privacy\.effectiveDate/);
    expect(src).not.toMatch(/toKstDateString|isKstDateOnOrAfter/);
  });
});
