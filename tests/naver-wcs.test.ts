/**
 * OF3-H(R3 §B) — 네이버 프리미엄 로그 분석(wcslog.js). 구현이 아니라 **언제 불러오고 언제 보내는가**를 잠근다.
 *
 * 노드 환경이라 컴포넌트를 마운트하지 않는다. 판정·전송은 lib/analytics/naver-wcs.ts 의 순수 함수/컨트롤러에 있고(창·시계·신호를 인자로 받는다),
 * 컴포넌트(components/analytics/NaverWcs.tsx)는 그것을 부르는 얇은 껍데기라 소스로 연결을 잠근다.
 *
 *   1. 스크립트 게이트 — 환경변수 없음 · 시행 전(KST) · 거부 표시 · DNT · GPC · 저장소 읽기 실패 · 관리자 경로 → 불러오지 않는다
 *   2. 페이지뷰 — 첫 번째만 wcs.inflow() 후 wcs_do(), 이후 경로 이동마다 wcs_do(). 이동마다 **거부를 다시 읽는다**(로드 뒤 거부 → 그때부터 안 보냄 · 리뷰 F11)
 *   3. 전환 — 접수 성공 1회 wcs.trans({ type: "lead" }) · 어떤 필드도 넘기지 않는다 · 게이트를 한 번 더 본다
 *   4. 소스 — 공개 로케일 레이아웃에만(관리자 레이아웃 아님) · QuickQuoteModal 의 성공 경로에서만 호출
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AnalyticsSignals } from "@/lib/analytics/before-send";
import {
  NAVER_WCS_SRC,
  configureNaverWcs,
  createNaverWcsController,
  naverWaFromEnv,
  naverWcsAllowed,
  trackNaverLead,
  type NaverWindow,
} from "@/lib/analytics/naver-wcs";
import { PRIVACY_POLICY_REVISION } from "@/lib/legal/disclosures";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const codeOf = (rel: string) => stripComments(read(rel), rel);

const FROM = PRIVACY_POLICY_REVISION.effectiveDate;
const WA = "s_test123456";
const OK: AnalyticsSignals = { optedOut: false, doNotTrack: null, globalPrivacyControl: false };
const NOW_AFTER = new Date(`${FROM}T09:00:00+09:00`);
const NOW_BEFORE = new Date(new Date(`${FROM}T00:00:00+09:00`).getTime() - 1);

const gate = (over: Partial<Parameters<typeof naverWcsAllowed>[0]> = {}) => ({
  wa: WA,
  effectiveFrom: FROM,
  now: NOW_AFTER,
  signals: OK,
  pathname: "/",
  ...over,
});

/** 가짜 브라우저 창 — wcslog.js 가 불러진 뒤의 모양(wcs · wcs_do). */
function fakeWindow(loaded = true) {
  const calls: string[] = [];
  const trans = vi.fn((payload: unknown) => {
    calls.push(`trans:${JSON.stringify(payload)}`);
  });
  const win: NaverWindow = {};
  if (loaded) {
    win.wcs = {
      inflow: vi.fn(() => {
        calls.push("inflow");
      }),
      trans,
    };
    win.wcs_do = vi.fn(() => {
      calls.push("wcs_do");
    });
  }
  return { win, calls, trans };
}

describe("0. 환경변수 — naverWaFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("비었거나 없거나 공백뿐이면 undefined — 컴포넌트가 아무것도 렌더하지 않는다", () => {
    vi.stubEnv("NEXT_PUBLIC_NAVER_WA", "");
    expect(naverWaFromEnv()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_NAVER_WA", "   ");
    expect(naverWaFromEnv()).toBeUndefined();
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_NAVER_WA;
    expect(naverWaFromEnv()).toBeUndefined();
  });

  test("값이 있으면 공백을 떼어 돌려준다", () => {
    vi.stubEnv("NEXT_PUBLIC_NAVER_WA", "  s_abc123  ");
    expect(naverWaFromEnv()).toBe("s_abc123");
  });

  test("컴포넌트는 wa 가 없으면 null 을 돌려준다(렌더 호출 결과로 확인)", async () => {
    const { NaverWcs } = await import("@/components/analytics/NaverWcs");
    expect(NaverWcs({ wa: undefined, effectiveFrom: FROM })).toBeNull();
    expect(NaverWcs({ wa: "", effectiveFrom: FROM })).toBeNull();
    expect(NaverWcs({ wa: null, effectiveFrom: FROM })).toBeNull();
    expect(NaverWcs({ wa: WA, effectiveFrom: FROM })).not.toBeNull();
  });
});

describe("1. 스크립트 게이트 — naverWcsAllowed", () => {
  test("모든 조건을 만족하면 허용", () => {
    expect(naverWcsAllowed(gate())).toBe(true);
  });

  test.each([
    ["환경변수 없음(undefined)", { wa: undefined }],
    ["환경변수 null", { wa: null }],
    ["환경변수 빈 문자열", { wa: "" }],
    ["환경변수 공백뿐", { wa: "   " }],
    ["시행 전(시행일 전날 23:59:59.999 KST)", { now: NOW_BEFORE }],
    ["방문 통계 거부 표시", { signals: { ...OK, optedOut: true } }],
    ["Do Not Track = 1", { signals: { ...OK, doNotTrack: "1" } }],
    ["Do Not Track = yes(옛 Firefox)", { signals: { ...OK, doNotTrack: "yes" } }],
    ["GPC", { signals: { ...OK, globalPrivacyControl: true } }],
    ["관리자 경로 /admin", { pathname: "/admin" }],
    ["관리자 경로 /admin/reservations", { pathname: "/admin/reservations" }],
    ["관리자 경로 /ko/admin", { pathname: "/ko/admin" }],
    ["관리자 경로 인코딩 /%61dmin", { pathname: "/%61dmin" }],
  ] as const)("%s → 불러오지 않는다", (_label, over) => {
    expect(naverWcsAllowed(gate(over as never))).toBe(false);
  });

  test("시행일 00:00 KST 부터 허용(경계)", () => {
    expect(naverWcsAllowed(gate({ now: new Date(`${FROM}T00:00:00+09:00`) }))).toBe(true);
  });

  test("DNT 0 · 거부 아님 신호는 허용을 막지 않는다", () => {
    expect(naverWcsAllowed(gate({ signals: { ...OK, doNotTrack: "0" } }))).toBe(true);
  });

  test("로케일 공개 경로(/en/about 등)는 허용 — 영문 화면도 같은 규칙", () => {
    expect(naverWcsAllowed(gate({ pathname: "/en/about" }))).toBe(true);
  });
});

describe("2. 페이지뷰 컨트롤러 — 이동마다 거부를 다시 읽는다", () => {
  function make(opts: { loaded?: boolean; now?: Date; signals?: () => AnalyticsSignals; wa?: string | null } = {}) {
    const fw = fakeWindow(opts.loaded ?? true);
    let signals = opts.signals ?? (() => OK);
    const ctl = createNaverWcsController({
      win: fw.win,
      wa: opts.wa === undefined ? WA : opts.wa,
      effectiveFrom: FROM,
      now: () => opts.now ?? NOW_AFTER,
      readSignals: () => signals(),
    });
    return { ...fw, ctl, setSignals: (s: () => AnalyticsSignals) => (signals = s) };
  }

  test("첫 페이지뷰 — wcs_add = { wa } · inflow → wcs_do 순서로 한 번씩", () => {
    const { ctl, win, calls } = make();
    expect(ctl.pageview("/")).toBe(true);
    expect(win.wcs_add).toEqual({ wa: WA });
    expect(calls).toEqual(["inflow", "wcs_do"]);
  });

  test("이후 이동 — wcs_do 만(inflow 는 첫 번만)", () => {
    const { ctl, calls } = make();
    ctl.pageview("/");
    ctl.pageview("/about");
    ctl.pageview("/gallery");
    expect(calls).toEqual(["inflow", "wcs_do", "wcs_do", "wcs_do"]);
  });

  test("같은 경로를 연달아 부르면 한 번만(개발 모드 이중 효과 방지)", () => {
    const { ctl, calls } = make();
    ctl.pageview("/");
    ctl.pageview("/");
    expect(calls).toEqual(["inflow", "wcs_do"]);
  });

  test("로드 뒤 거부(저장 표시) → 그 이동부터 wcs_do 를 부르지 않는다 (리뷰 F11)", () => {
    const { ctl, calls, setSignals } = make();
    expect(ctl.pageview("/")).toBe(true);
    setSignals(() => ({ ...OK, optedOut: true }));
    expect(ctl.pageview("/about")).toBe(false);
    expect(calls).toEqual(["inflow", "wcs_do"]); // 두 번째 wcs_do 없음
  });

  test("로드 뒤 DNT · GPC 가 켜져도 마찬가지", () => {
    for (const refused of [{ ...OK, doNotTrack: "1" }, { ...OK, globalPrivacyControl: true }]) {
      const { ctl, calls, setSignals } = make();
      ctl.pageview("/");
      setSignals(() => refused);
      expect(ctl.pageview("/next")).toBe(false);
      expect(calls).toEqual(["inflow", "wcs_do"]);
    }
  });

  test("거부했다가 다시 허용하면 이동부터 재개 — inflow 는 다시 부르지 않는다", () => {
    const { ctl, calls, setSignals } = make();
    ctl.pageview("/");
    setSignals(() => ({ ...OK, optedOut: true }));
    ctl.pageview("/a");
    setSignals(() => OK);
    expect(ctl.pageview("/b")).toBe(true);
    expect(calls).toEqual(["inflow", "wcs_do", "wcs_do"]);
  });

  test("거부 상태로 시작하면 inflow 도 부르지 않는다 — 허용된 뒤 첫 전송이 '첫 번째'다", () => {
    const { ctl, calls, setSignals } = make({ signals: () => ({ ...OK, optedOut: true }) });
    expect(ctl.pageview("/")).toBe(false);
    expect(calls).toEqual([]);
    setSignals(() => OK);
    expect(ctl.pageview("/b")).toBe(true);
    expect(calls).toEqual(["inflow", "wcs_do"]);
  });

  test.each([
    ["시행 전", { now: NOW_BEFORE }],
    ["환경변수 없음", { wa: null }],
    ["스크립트가 아직 안 불러짐(wcs 없음)", { loaded: false }],
  ] as const)("%s → 아무것도 호출하지 않는다", (_l, over) => {
    const { ctl, calls, win } = make(over as never);
    expect(ctl.pageview("/")).toBe(false);
    expect(calls).toEqual([]);
    expect(win.wcs_add).toBeUndefined();
  });

  test("관리자 경로 이동은 보내지 않는다", () => {
    const { ctl, calls } = make();
    expect(ctl.pageview("/admin/reservations")).toBe(false);
    expect(calls).toEqual([]);
  });

  test("스크립트가 늦게 불러지면(wcs 가 나중에 생김) 그때의 호출이 첫 번째가 된다", () => {
    const fw = fakeWindow(false);
    const ctl = createNaverWcsController({ win: fw.win, wa: WA, effectiveFrom: FROM, now: () => NOW_AFTER, readSignals: () => OK });
    expect(ctl.pageview("/")).toBe(false);
    const loaded = fakeWindow(true);
    fw.win.wcs = loaded.win.wcs;
    fw.win.wcs_do = loaded.win.wcs_do;
    expect(ctl.pageview("/")).toBe(true);
    expect(loaded.calls).toEqual(["inflow", "wcs_do"]);
  });

  test("wcs 호출이 던져도 화면을 깨지 않는다(삼킨다)", () => {
    const fw = fakeWindow(true);
    fw.win.wcs_do = () => {
      throw new Error("boom");
    };
    const ctl = createNaverWcsController({ win: fw.win, wa: WA, effectiveFrom: FROM, now: () => NOW_AFTER, readSignals: () => OK });
    expect(() => ctl.pageview("/")).not.toThrow();
  });
});

describe("3. 전환 — trackNaverLead", () => {
  const deps = (over: { win?: NaverWindow; signals?: AnalyticsSignals; now?: Date; pathname?: string } = {}) => ({
    win: over.win,
    signals: () => over.signals ?? OK,
    now: () => over.now ?? NOW_AFTER,
    pathname: () => over.pathname ?? "/",
  });
  const configured = () => configureNaverWcs({ wa: WA, effectiveFrom: FROM });

  test("정상 — wcs.trans({ type: 'lead' }) 한 번, 그 객체만(이름·전화 등 어떤 필드도 없다)", () => {
    configured();
    const { win, trans } = fakeWindow();
    expect(trackNaverLead(deps({ win }))).toBe(true);
    expect(trans).toHaveBeenCalledTimes(1);
    expect(trans.mock.calls[0]).toEqual([{ type: "lead" }]);
    expect(Object.keys(trans.mock.calls[0][0] as object)).toEqual(["type"]);
  });

  test("호출 순간에 거부를 다시 읽는다 — 로드 뒤 거부했으면 보내지 않는다", () => {
    configured();
    for (const signals of [
      { ...OK, optedOut: true },
      { ...OK, doNotTrack: "1" },
      { ...OK, globalPrivacyControl: true },
    ]) {
      const { win, trans } = fakeWindow();
      expect(trackNaverLead(deps({ win, signals }))).toBe(false);
      expect(trans).not.toHaveBeenCalled();
    }
  });

  test("시행 전 · 스크립트 없음(window.wcs 부재) · 관리자 경로 → 보내지 않는다", () => {
    configured();
    const a = fakeWindow();
    expect(trackNaverLead(deps({ win: a.win, now: NOW_BEFORE }))).toBe(false);
    expect(a.trans).not.toHaveBeenCalled();
    expect(trackNaverLead(deps({ win: fakeWindow(false).win }))).toBe(false);
    const c = fakeWindow();
    expect(trackNaverLead(deps({ win: c.win, pathname: "/admin/x" }))).toBe(false);
    expect(c.trans).not.toHaveBeenCalled();
  });

  test("설정이 없으면(환경변수 없어 컴포넌트가 설정하지 않음) 보내지 않는다", () => {
    configureNaverWcs(null);
    const { win, trans } = fakeWindow();
    expect(trackNaverLead(deps({ win }))).toBe(false);
    expect(trans).not.toHaveBeenCalled();
    configureNaverWcs({ wa: "", effectiveFrom: FROM });
    expect(trackNaverLead(deps({ win }))).toBe(false);
    expect(trans).not.toHaveBeenCalled();
  });

  test("trans 가 던져도 접수 완료 화면을 깨지 않는다", () => {
    configured();
    const { win } = fakeWindow();
    win.wcs!.trans = () => {
      throw new Error("boom");
    };
    expect(() => trackNaverLead(deps({ win }))).not.toThrow();
    expect(trackNaverLead(deps({ win }))).toBe(false);
  });
});

describe("4. 소스 — 연결", () => {
  const walk = (rel: string): string[] =>
    readdirSync(path.join(ROOT, rel)).flatMap((n) => {
      const p = path.join(rel, n);
      return statSync(path.join(ROOT, p)).isDirectory() ? walk(p) : [p.split(path.sep).join("/")];
    });

  test("스크립트 주소 상수 — https://wcs.naver.net/wcslog.js", () => {
    expect(NAVER_WCS_SRC).toBe("https://wcs.naver.net/wcslog.js");
  });

  test("컴포넌트 — 클라이언트 · next/script afterInteractive · 환경변수 없으면 null · 원장을 import 하지 않는다", () => {
    const raw = read("components/analytics/NaverWcs.tsx");
    const code = codeOf("components/analytics/NaverWcs.tsx");
    expect(raw).toMatch(/^"use client";/);
    expect(code).toMatch(/from "next\/script"/);
    expect(code).toMatch(/strategy="afterInteractive"/);
    expect(code).toMatch(/src=\{NAVER_WCS_SRC\}/);
    expect(code).toMatch(/usePathname/);
    expect(code).not.toMatch(/legal\/disclosures/);
    expect(code).toMatch(/if \(!wa\) return null/);
  });

  test("컴포넌트는 매 이동마다 컨트롤러 pageview 를 부르고, 신호는 기존 방문 통계 판정(readAnalyticsSignals)을 재사용한다", () => {
    const code = codeOf("components/analytics/NaverWcs.tsx");
    expect(code).toMatch(/readAnalyticsSignals/);
    expect(code).toMatch(/createNaverWcsController/);
    expect(code).toMatch(/\.pageview\(\s*pathname\s*\)/);
    expect(code).toMatch(/ANALYTICS_OPTOUT_EVENT/);
    expect(codeOf("lib/analytics/naver-wcs.ts")).toMatch(/analyticsRefused|shouldLoadAnalytics/);
  });

  test("공개 로케일 레이아웃에만 있다 — 시행일은 원장 상수를 서버가 prop 으로 내린다", () => {
    const layout = codeOf("app/[locale]/layout.tsx");
    expect(layout).toMatch(/<NaverWcs\b/);
    expect(layout).toMatch(/wa=\{naverWaFromEnv\(\)\}/);
    expect(layout).not.toContain("process.env"); // 레이아웃은 env 를 직접 읽지 않는다(tests/canonical.test.ts)
    expect(codeOf("lib/analytics/naver-wcs.ts")).toMatch(/process\.env\.NEXT_PUBLIC_NAVER_WA/);
    expect(layout).toMatch(/effectiveFrom=\{PRIVACY_POLICY_REVISION\.effectiveDate\}/);
    const users = walk("app")
      .concat(walk("components"))
      .filter((f) => /\.tsx?$/.test(f) && f !== "components/analytics/NaverWcs.tsx")
      .filter((f) => /<NaverWcs\b/.test(codeOf(f)));
    expect(users).toEqual(["app/[locale]/layout.tsx"]);
    for (const f of walk("app/admin").filter((x) => /\.tsx?$/.test(x))) {
      expect(codeOf(f), f).not.toMatch(/NaverWcs|naver-wcs|trackNaverLead/);
    }
  });

  test("전환 호출은 접수 성공 경로(onDone, setDone(true) 직후) 한 곳뿐이다", () => {
    const code = codeOf("components/quote/QuickQuoteModal.tsx");
    expect(code.match(/trackNaverLead\(/g)).toHaveLength(1);
    expect(code).toMatch(/setDone\(true\);\s*trackNaverLead\(\);/);
    const users = walk("app")
      .concat(walk("components"), walk("lib"), walk("actions"))
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith("lib/analytics/naver-wcs.ts"))
      .filter((f) => /trackNaverLead\(/.test(codeOf(f)));
    expect(users).toEqual(["components/quote/QuickQuoteModal.tsx"]);
  });

  test("전환 호출에 인자가 없다 — 이름·전화 등을 넘길 길이 없다", () => {
    expect(codeOf("components/quote/QuickQuoteModal.tsx")).not.toMatch(/trackNaverLead\([^)]/);
    expect(codeOf("lib/analytics/naver-wcs.ts")).toMatch(/trans\(\{ type: "lead" \}\)/);
  });
});
