/**
 * P1-7 (3) + 수정 라운드 2 — 방문 통계(Vercel Web Analytics) 계약.
 *
 * R2(사용자 결정 "거부 버튼 + 별도 고지"): 거부 표시(localStorage `bestour:analytics-optout`)·Do Not Track·GPC 중 하나라도 있으면
 * `<Analytics>` 를 렌더하지 않고(스크립트를 불러오지 않는다) beforeSend 도 null 을 돌려준다(이중 안전). 거부 버튼은 /privacy 의
 * 방문 통계 국외이전 항목 바로 아래. /quote/done 은 no-referrer(접수번호가 Referer 로 새지 않게).
 *
 * 무엇을 잠그는가
 *   1. `beforeSend` 순수 함수 — `/admin` 으로 시작하는 주소는 보내지 않고(null), 그 밖에는 쿼리 문자열·해시를 전부 지운 주소로 보낸다.
 *      `/quote/done?code=…` 에 접수번호가, `/reservation/check` 등에 검색어가 실릴 수 있다 — 처리방침(원장 PRIVACY_POLICY_SECTIONS.cookies)이
 *      "관리자 화면 주소와 주소 뒤에 붙는 매개변수(검색어·접수번호 등)는 수집하지 않습니다" 라고 고지한다. 이 함수가 그 고지를 참으로 만든다.
 *   2. 배치 — 공개 로케일 레이아웃(app/[locale]/layout.tsx)에만 넣고, 관리자 레이아웃(app/admin/**)에는 넣지 않는다.
 *   3. 커스텀 이벤트 0 — `track(` 호출이 저장소에 없다(이번 범위 밖).
 *   4. 새 패키지는 `@vercel/analytics` 하나.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

import {
  ANALYTICS_OPTOUT_EVENT,
  ANALYTICS_OPTOUT_KEY,
  analyticsBeforeSend,
  browserRefused,
  liveAnalyticsBeforeSend,
  readAnalyticsSignals,
  sessionAnalyticsOptOut,
  setAnalyticsOptOut,
  setSessionAnalyticsOptOut,
  shouldLoadAnalytics,
  type AnalyticsSignals,
} from "@/lib/analytics/before-send";
import { ledgerUi } from "@/lib/i18n/ledger-ui";
import { PRIVACY_POLICY_SECTIONS } from "@/lib/legal/disclosures";

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

const pv = (url: string) => ({ type: "pageview" as const, url });

describe("1. analyticsBeforeSend — /admin 은 보내지 않고, 쿼리·해시는 지운다", () => {
  test.for([
    ["https://bestour.co.kr/admin"],
    ["https://bestour.co.kr/admin/"],
    ["https://bestour.co.kr/admin/reservations"],
    ["https://bestour.co.kr/admin/reservations/11111111-1111-4111-8111-111111111111?status=new"],
    ["https://bestour.co.kr/admin/login#x"],
    ["http://localhost:3000/admin/notices"],
    // 로케일 접두사를 붙인 주소도 관리자 경로로 본다(/ko/admin 은 미들웨어가 /admin 으로 보낸다 · /en/admin 은 404 지만 보낼 이유가 없다)
    ["https://bestour.co.kr/ko/admin/reservations"],
    ["https://bestour.co.kr/en/admin"],
    // 대소문자·인코딩으로 우회하지 못한다
    ["https://bestour.co.kr/ADMIN/reservations"],
    ["https://bestour.co.kr/%61dmin/reservations"],
  ] as const)("%s → null", ([url]) => {
    expect(analyticsBeforeSend(pv(url))).toBeNull();
  });

  test("쿼리 문자열을 지운다 — /quote/done?code=… 의 접수번호가 나가지 않는다", () => {
    expect(analyticsBeforeSend(pv("https://bestour.co.kr/quote/done?code=ABCDEFGH"))).toEqual(pv("https://bestour.co.kr/quote/done"));
    expect(analyticsBeforeSend(pv("https://bestour.co.kr/en/quote/done?code=ABCDEFGH&x=1"))).toEqual(pv("https://bestour.co.kr/en/quote/done"));
  });

  test("해시를 지운다", () => {
    expect(analyticsBeforeSend(pv("https://bestour.co.kr/about#location"))).toEqual(pv("https://bestour.co.kr/about"));
    expect(analyticsBeforeSend(pv("https://bestour.co.kr/quote?step=3&vehicle=bus45#top"))).toEqual(pv("https://bestour.co.kr/quote"));
  });

  test("그 밖의 경로는 그대로 보존한다", () => {
    for (const url of [
      "https://bestour.co.kr/",
      "https://bestour.co.kr/en",
      "https://bestour.co.kr/fleet",
      "https://bestour.co.kr/en/reservation/check",
      "https://bestour.co.kr/gallery/some-album",
      "http://localhost:3000/notices/12",
    ]) {
      expect(analyticsBeforeSend(pv(url))).toEqual(pv(url));
    }
  });

  test("'/admin' 으로 시작하는 다른 첫 세그먼트도 보내지 않는다 (브리프: /admin 으로 시작하면 null — 보수적으로)", () => {
    expect(analyticsBeforeSend(pv("https://bestour.co.kr/administrator"))).toBeNull();
  });

  test("이벤트의 다른 필드는 그대로 두고 url 만 바꾼다 (입력 객체를 변경하지 않는다)", () => {
    const input = { type: "event" as const, url: "https://bestour.co.kr/fleet?utm_source=x", extra: 1 };
    const out = analyticsBeforeSend(input);
    expect(out).toEqual({ type: "event", url: "https://bestour.co.kr/fleet", extra: 1 });
    expect(input.url).toBe("https://bestour.co.kr/fleet?utm_source=x");
  });

  test("상대 주소도 같은 규칙 — 경로만 남긴다", () => {
    expect(analyticsBeforeSend(pv("/quote/done?code=ABCDEFGH"))).toEqual(pv("/quote/done"));
    expect(analyticsBeforeSend(pv("/admin/reservations"))).toBeNull();
  });

  test("해석할 수 없는 주소는 보내지 않는다 (null) — 모르는 것을 흘리지 않는다", () => {
    expect(analyticsBeforeSend(pv("http://[::1"))).toBeNull();
    expect(analyticsBeforeSend(pv(""))).toBeNull();
  });
});

describe("2. 배치 — 공개 레이아웃에만, 관리자에는 없다", () => {
  test("app/[locale]/layout.tsx 가 SiteAnalytics 를 렌더한다", () => {
    const code = codeOf("app/[locale]/layout.tsx");
    expect(code).toMatch(/import\s+\{?\s*SiteAnalytics\s*\}?\s+from\s+["']@\/components\/analytics\/SiteAnalytics["']/);
    expect(code).toMatch(/<SiteAnalytics\s*\/>/);
  });

  // R2 — 거부 표시·DNT·GPC 가 있으면 `<Analytics>` 자체를 렌더하지 않는다(스크립트를 불러오지 않는다). 판정은 마운트 뒤 브라우저에서만.
  test("SiteAnalytics — 클라이언트 · 처음엔 렌더하지 않고(allowed=false) 마운트 뒤 신호를 읽어 허용일 때만 <Analytics> · beforeSend 는 실시간 신호 판정", () => {
    const code = codeOf("components/analytics/SiteAnalytics.tsx");
    expect(code).toMatch(/^\s*["']use client["']/m);
    expect(code).toMatch(/from\s+["']@vercel\/analytics\/next["']/);
    expect(code).toMatch(/useState\(false\)/);
    expect(code).toMatch(/shouldLoadAnalytics\(readAnalyticsSignals\(\)\)/);
    expect(code).toMatch(/if\s*\(\s*!allowed\s*\)\s*return null;/);
    expect(code).toMatch(/<Analytics\s+beforeSend=\{liveAnalyticsBeforeSend\}\s*\/>/);
    // 같은 탭의 토글(사용자 지정 이벤트)과 다른 탭의 변경(storage)에 즉시 반응한다
    expect(code).toMatch(/addEventListener\(ANALYTICS_OPTOUT_EVENT/);
    expect(code).toMatch(/addEventListener\(["']storage["']/);
    expect(code).toMatch(/from\s+["']@\/lib\/analytics\/before-send["']/);
  });

  test("관리자 트리(app/admin/**)와 루트 레이아웃에는 Analytics 가 없다", () => {
    for (const f of [...walk("app/admin"), "app/layout.tsx"].filter((x) => /\.tsx?$/.test(x))) {
      const code = codeOf(f);
      expect(/@vercel\/analytics|SiteAnalytics/.test(code), f).toBe(false);
    }
  });

  test("@vercel/analytics 를 import 하는 곳은 SiteAnalytics 한 곳뿐이다", () => {
    const files = ["app", "components", "lib", "actions"].flatMap(walk).filter((x) => /\.tsx?$/.test(x));
    const importers = files.filter((f) => /from\s+["']@vercel\/analytics/.test(codeOf(f)));
    expect(importers).toEqual(["components/analytics/SiteAnalytics.tsx"]);
  });

  test("커스텀 이벤트 0 — track( 호출이 없다", () => {
    const files = ["app", "components", "lib", "actions"].flatMap(walk).filter((x) => /\.tsx?$/.test(x));
    for (const f of files) expect(/\btrack\(/.test(codeOf(f)), f).toBe(false);
  });
});

describe("3. 패키지 · 고지 짝", () => {
  test("package.json 에 @vercel/analytics 가 dependencies 로 있다", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@vercel/analytics"]).toMatch(/^\^?\d+\.\d+\.\d+$/);
  });

  test("처리방침이 방문 통계를 고지한다 — 코드가 하는 일(관리자 주소 제외 · 매개변수 제거 · 거부 수단)을 고지가 말한다", () => {
    const cookies = PRIVACY_POLICY_SECTIONS.find((s) => s.key === "cookies") as { body: string };
    expect(cookies.body).toContain("Vercel Web Analytics");
    expect(cookies.body).toContain("관리자 화면 주소를 보내지 않고");
    expect(cookies.body).toContain("매개변수(검색어·접수번호 등)는 지운 뒤 보냅니다");
    expect(cookies.body).toContain("'방문 통계 거부' 버튼");
    expect(cookies.body).toContain("Do Not Track·GPC");
    // R4 [P2-E] — 저장이 막힌 브라우저의 한계를 고지가 말한다(모듈 변수는 새로고침·다른 탭에서 사라진다)
    expect(cookies.body).toContain("저장이 막혀 있는 브라우저에서는 그 표시가 남지 않아 이번 방문 동안만 적용되므로");
  });

  test("🔴 국외이전 항목의 거부 문구도 같은 사실을 말한다 — '그 브라우저에서는 보내지 않는다' 를 조건 없이 약속하지 않는다", async () => {
    const { VISITOR_STATS_TRANSFER } = await import("@/lib/legal/disclosures");
    expect(VISITOR_STATS_TRANSFER.refusal).toContain("저장이 막혀 있는 브라우저(사생활 보호 모드 등)에서는 이번 방문 동안만 적용되므로");
    expect(VISITOR_STATS_TRANSFER.refusal).toContain("추적 거부(Do Not Track·GPC) 설정을 함께 켜 주시기 바랍니다");
  });
});

// =============================================================================
// 4. 거부 신호 — 거부 표시(localStorage) · Do Not Track · GPC (R2 [사용자 결정])
// =============================================================================
const NO = { optedOut: false, doNotTrack: null, globalPrivacyControl: false } satisfies AnalyticsSignals;

describe("4. 거부 신호 — 하나라도 있으면 불러오지 않고 보내지 않는다", () => {
  // 이번 방문 메모리 표시(R3 [P2-C])는 모듈 상태다 — 블록마다 되돌린다.
  beforeEach(() => setSessionAnalyticsOptOut(false));
  afterAll(() => setSessionAnalyticsOptOut(false));

  test.for([
    ["거부 표시", { ...NO, optedOut: true }],
    ["Do Not Track = '1'", { ...NO, doNotTrack: "1" }],
    ["Do Not Track = 'yes'(옛 Firefox)", { ...NO, doNotTrack: "yes" }],
    ["GPC = true", { ...NO, globalPrivacyControl: true }],
  ] as const)("%s → 불러오지 않음 · beforeSend null", ([, signals]) => {
    expect(shouldLoadAnalytics(signals)).toBe(false);
    expect(analyticsBeforeSend(pv("https://bestour.co.kr/fleet"), signals)).toBeNull();
  });

  test("신호가 없으면 불러오고, beforeSend 는 기존 규칙(/admin · 매개변수)대로", () => {
    expect(shouldLoadAnalytics(NO)).toBe(true);
    expect(analyticsBeforeSend(pv("https://bestour.co.kr/fleet?x=1"), NO)).toEqual(pv("https://bestour.co.kr/fleet"));
    expect(analyticsBeforeSend(pv("https://bestour.co.kr/admin"), NO)).toBeNull();
    expect(shouldLoadAnalytics({ ...NO, doNotTrack: "0" })).toBe(true);
    expect(shouldLoadAnalytics({ ...NO, doNotTrack: "unspecified" })).toBe(true);
  });

  test("readAnalyticsSignals — localStorage 키 · navigator.doNotTrack · navigator.globalPrivacyControl 을 읽는다", () => {
    const storage = (value: string | null) => ({ getItem: (k: string) => (k === ANALYTICS_OPTOUT_KEY ? value : null) });
    expect(readAnalyticsSignals({ localStorage: storage("1"), navigator: {} })).toEqual({ optedOut: true, doNotTrack: null, globalPrivacyControl: false });
    expect(readAnalyticsSignals({ localStorage: storage(null), navigator: { doNotTrack: "1" } })).toEqual({ optedOut: false, doNotTrack: "1", globalPrivacyControl: false });
    expect(readAnalyticsSignals({ localStorage: storage(null), navigator: { globalPrivacyControl: true } })).toEqual({ optedOut: false, doNotTrack: null, globalPrivacyControl: true });
    expect(ANALYTICS_OPTOUT_KEY).toBe("bestour:analytics-optout");
  });

  test("저장소를 읽을 수 없으면 거부로 본다 — 거부했는지 모르는 채 보내지 않는다", () => {
    const throwing = { getItem: () => { throw new Error("SecurityError"); } };
    expect(readAnalyticsSignals({ localStorage: throwing, navigator: {} }).optedOut).toBe(true);
    expect(readAnalyticsSignals({ navigator: {} }).optedOut).toBe(true);
  });

  test("setAnalyticsOptOut — 거부는 키를 쓰고 허용은 지운다 · 알림 이벤트를 쏜다 · 저장 실패는 ok:false 로 알린다(삼키지 않는다)", () => {
    const store = new Map<string, string>();
    const fired: string[] = [];
    const deps = {
      localStorage: { setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), getItem: (k: string) => store.get(k) ?? null },
      notify: (name: string) => void fired.push(name),
    };
    expect(setAnalyticsOptOut(true, deps)).toEqual({ ok: true });
    expect(store.get(ANALYTICS_OPTOUT_KEY)).toBe("1");
    expect(setAnalyticsOptOut(false, deps)).toEqual({ ok: true });
    expect(store.has(ANALYTICS_OPTOUT_KEY)).toBe(false);
    expect(fired).toEqual([ANALYTICS_OPTOUT_EVENT, ANALYTICS_OPTOUT_EVENT]);
    const broken = { ...deps, localStorage: { ...deps.localStorage, setItem: () => { throw new Error("QuotaExceededError"); } } };
    expect(setAnalyticsOptOut(true, broken)).toEqual({ ok: false });
    expect(setAnalyticsOptOut(true, { notify: deps.notify })).toEqual({ ok: false });
  });

  // ---------------------------------------------------------------------------
  // R3 [P2-C] — astra 재현: 저장소는 읽히는데 setItem 이 던지면 옛 구현은 ok:false 만 돌려주고 수집을 계속했다.
  //             버튼이 "저장할 수 없습니다" 라고 말하면서 실제로는 막지 않는 것은 고지와 다르다.
  // ---------------------------------------------------------------------------
  test("🔴 저장에 실패해도 **이번 방문 동안은 실제로 멈춘다** — 메모리 표시 → 미렌더 · beforeSend null", () => {
    const store = new Map<string, string>();
    const fired: string[] = [];
    const readable = { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) };
    const broken = {
      localStorage: { ...readable, setItem: () => { throw new Error("QuotaExceededError"); } },
      notify: (name: string) => void fired.push(name),
    };
    // 거부 전 — 저장소가 비어 있고 신호도 없다
    expect(readAnalyticsSignals({ localStorage: readable, navigator: {} }).optedOut).toBe(false);
    expect(sessionAnalyticsOptOut()).toBe(false);

    expect(setAnalyticsOptOut(true, broken)).toEqual({ ok: false });

    // 저장은 실패했지만(키 없음) 이번 방문 동안의 판정은 "거부" 다
    expect(store.has(ANALYTICS_OPTOUT_KEY)).toBe(false);
    expect(sessionAnalyticsOptOut()).toBe(true);
    const after = readAnalyticsSignals({ localStorage: readable, navigator: {} });
    expect(after.optedOut).toBe(true);
    expect(shouldLoadAnalytics(after)).toBe(false);
    expect(liveAnalyticsBeforeSend(pv("https://bestour.co.kr/fleet"))).toBeNull();
    // 같은 탭의 SiteAnalytics 가 다시 판정하도록 알림도 나간다(저장 성공 여부와 무관)
    expect(fired).toEqual([ANALYTICS_OPTOUT_EVENT]);

    // 다시 허용하면 메모리 표시도 함께 내려간다
    expect(setAnalyticsOptOut(false, broken)).toEqual({ ok: true });
    expect(sessionAnalyticsOptOut()).toBe(false);
    expect(readAnalyticsSignals({ localStorage: readable, navigator: {} }).optedOut).toBe(false);
  });

  test("🔴 저장소에 거부 표시가 남아 있으면 '다시 허용' 이 실패해도 판정은 거부 그대로다 — 표시와 동작이 어긋나지 않는다", () => {
    const store = new Map<string, string>([[ANALYTICS_OPTOUT_KEY, "1"]]);
    const stuck = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: () => { throw new Error("SecurityError"); },
      },
    };
    expect(setAnalyticsOptOut(false, stuck)).toEqual({ ok: false });
    const signals = readAnalyticsSignals({ localStorage: stuck.localStorage, navigator: {} });
    expect(signals.optedOut).toBe(true);
    expect(shouldLoadAnalytics(signals)).toBe(false);
  });

  // R4 [P2-E] — astra 재현 ③: 저장소가 **비어 있는데**(거부는 메모리 표시뿐) '다시 허용' 의 삭제까지 실패하면,
  //   옛 판은 메모리 표시를 먼저 내려 **수집이 재개**되는데 화면은 "이번 방문 동안 보내지 않습니다" 를 보여 줬다.
  //   실패하면 **거부 상태를 유지**한다 — 표시와 동작이 갈라지지 않는 쪽으로 넘어진다.
  test("🔴 저장이 막힌 브라우저에서 '다시 허용' 이 실패하면 거부 상태를 유지한다 (실패는 거부 쪽으로 넘어진다)", () => {
    const empty = new Map<string, string>();
    const broken = {
      localStorage: {
        getItem: (k: string) => empty.get(k) ?? null,
        setItem: () => { throw new Error("QuotaExceededError"); },
        removeItem: () => { throw new Error("QuotaExceededError"); },
      },
    };
    expect(setAnalyticsOptOut(true, broken)).toEqual({ ok: false });
    expect(sessionAnalyticsOptOut()).toBe(true);
    // 다시 허용 — 삭제도 실패한다
    expect(setAnalyticsOptOut(false, broken)).toEqual({ ok: false });
    expect(sessionAnalyticsOptOut(), "허용이 저장되지 않았으면 거부를 유지한다").toBe(true);
    const signals = readAnalyticsSignals({ localStorage: broken.localStorage, navigator: {} });
    expect(signals.optedOut).toBe(true);
    expect(shouldLoadAnalytics(signals)).toBe(false);
    expect(liveAnalyticsBeforeSend(pv("https://bestour.co.kr/fleet"))).toBeNull();
  });

  test("browserRefused — DNT·GPC 만 본다(버튼이 '이미 거부 중' 을 보여 줄 근거)", () => {
    expect(browserRefused(NO)).toBe(false);
    expect(browserRefused({ ...NO, optedOut: true })).toBe(false);
    expect(browserRefused({ ...NO, doNotTrack: "1" })).toBe(true);
    expect(browserRefused({ ...NO, doNotTrack: "yes" })).toBe(true);
    expect(browserRefused({ ...NO, globalPrivacyControl: true })).toBe(true);
  });
});

// =============================================================================
// 5. 거부 버튼 — /privacy 의 방문 통계 국외이전 항목 바로 아래
// =============================================================================
describe("5. 방문 통계 거부 버튼", () => {
  test("/privacy — 방문 통계 항목(VISITOR_STATS_TRANSFER)까지 한 표, 그 바로 뒤에 버튼, 나머지 항목은 뒤에", () => {
    const code = codeOf("app/[locale]/(legal)/privacy/page.tsx");
    expect(code).toMatch(/OVERSEAS_TRANSFERS\.indexOf\(VISITOR_STATS_TRANSFER\)/);
    expect(code).toMatch(/<AnalyticsOptOut\s+labels=\{ui\.labels\.analyticsOptOut\}\s*\/>/);
    const iFirst = code.indexOf("OVERSEAS_TRANSFERS.slice(0,");
    const iButton = code.indexOf("<AnalyticsOptOut");
    const iRest = code.indexOf("OVERSEAS_TRANSFERS.slice(");
    expect(iFirst).toBeGreaterThan(-1);
    expect(iButton).toBeGreaterThan(iFirst);
    expect(code.indexOf("OVERSEAS_TRANSFERS.slice(", iButton)).toBeGreaterThan(iButton);
    expect(iRest).toBe(iFirst);
  });

  test("버튼 — 클라이언트 · 라벨은 props(원장/en.json) · 한글 리터럴 0 · setAnalyticsOptOut 사용 · 실패 메시지를 role=alert 로 보여 준다", () => {
    const code = codeOf("components/legal/AnalyticsOptOut.tsx");
    expect(code).toMatch(/^\s*["']use client["']/m);
    expect(code).toMatch(/setAnalyticsOptOut\(/);
    expect(code).toMatch(/labels\.optOut/);
    expect(code).toMatch(/labels\.optIn/);
    expect(code).toMatch(/labels\.storageFailed/);
    expect(code).toMatch(/role="alert"/);
    expect(code).toMatch(/data-testid="analytics-optout"/);
    expect(/[가-힣]/.test(code)).toBe(false);
  });

  // R3 [P2-C] — 표시 상태를 저장소 값이 아니라 **판정 함수**에서 가져온다. 그래야 "보이는 것 = 실제로 막는 것" 이다.
  test("🔴 버튼 상태는 readAnalyticsSignals 판정에서 온다 · DNT·GPC 면 '이미 거부 중' · 다른 탭 변경(storage)도 따라간다", () => {
    const code = codeOf("components/legal/AnalyticsOptOut.tsx");
    expect(code).toMatch(/readAnalyticsSignals\(/);
    expect(code).toMatch(/browserRefused\(/);
    expect(code).toMatch(/labels\.browserRefused/);
    expect(code).toMatch(/addEventListener\(\s*ANALYTICS_OPTOUT_EVENT/);
    expect(code).toMatch(/addEventListener\(\s*["']storage["']/);
    // 저장소 값을 직접 읽어 상태를 만들지 않는다(판정 함수 한 곳만 본다)
    expect(code).not.toMatch(/localStorage\.getItem/);
  });

  test("라벨 — ko 는 원장 LEGAL_LABELS.analyticsOptOut, en 은 en.json (네 키)", () => {
    expect(ledgerUi("ko").labels.analyticsOptOut).toEqual({
      optOut: "방문 통계 거부",
      optIn: "방문 통계 다시 허용",
      storageFailed: "설정을 저장하지 못했습니다. 이번 방문 동안에는 이 브라우저에서 방문 통계를 보내지 않습니다.",
      browserRefused: "브라우저의 추적 거부 설정으로 이미 거부 중입니다",
    });
    expect(ledgerUi("en").labels.analyticsOptOut).toEqual({
      optOut: "Opt out of visitor statistics",
      optIn: "Allow visitor statistics again",
      storageFailed: "We couldn't save this setting in this browser. Visitor statistics are not sent for the rest of this visit.",
      browserRefused: "Already opted out by your browser's tracking-refusal setting.",
    });
  });
});

// =============================================================================
// 6. [P2-7] Referer 누출 — /quote/done 은 no-referrer
// =============================================================================
describe("6. /quote/done — referrer: no-referrer", () => {
  test("접수번호가 든 주소가 같은 출처 요청의 Referer 로 새지 않게 no-referrer 메타를 낸다 · 다른 페이지는 그대로", () => {
    expect(codeOf("app/[locale]/(site)/quote/done/page.tsx")).toMatch(/referrer:\s*["']no-referrer["']/);
    for (const f of ["app/[locale]/(site)/quote/page.tsx", "app/[locale]/layout.tsx", "app/layout.tsx"]) {
      expect(/referrer:/.test(codeOf(f)), f).toBe(false);
    }
  });

  const BASE = process.env.EN_BASE_URL;
  test.runIf(Boolean(BASE))("렌더 실측(GET) — /quote/done 에 <meta name=\"referrer\" content=\"no-referrer\"> · /quote 에는 없다", async () => {
    const done = await (await fetch(`${BASE}/quote/done?code=ABCDEFGH`)).text();
    expect(done).toMatch(/<meta name="referrer" content="no-referrer"\s*\/?>/);
    const quote = await (await fetch(`${BASE}/quote`)).text();
    expect(quote).not.toMatch(/<meta name="referrer"/);
  }, 120_000);
});

// =============================================================================
// 7. [R3 P2-D] Referer — 메타만으로는 좁다. 전역 Referrer-Policy 헤더로 경로를 뺀다.
//    beforeSend 는 event.url 만 지운다. 수집 스크립트·수집 요청의 HTTP Referer 에는 원래 주소가 실린다
//    (같은 출처 요청은 기본 정책에서 전체 경로를 보낸다) — 그쪽은 응답 헤더로만 막을 수 있다.
// =============================================================================
describe("7. Referrer-Policy 헤더 — 전역 strict-origin", () => {
  test("next.config.ts 가 모든 경로에 Referrer-Policy: strict-origin 을 낸다", () => {
    const code = codeOf("next.config.ts");
    expect(code).toMatch(/async headers\(\)/);
    expect(code).toMatch(/source:\s*["']\/:path\*["']/);
    expect(code).toMatch(/key:\s*["']Referrer-Policy["']/);
    expect(code).toMatch(/value:\s*["']strict-origin["']/);
    // /quote/done 의 no-referrer 메타는 그대로 둔다(더 좁은 규칙이 이긴다)
    expect(codeOf("app/[locale]/(site)/quote/done/page.tsx")).toMatch(/referrer:\s*["']no-referrer["']/);
  });

  const BASE = process.env.EN_BASE_URL;
  test.runIf(Boolean(BASE))("렌더 실측(GET) — 응답 헤더에 Referrer-Policy: strict-origin 이 실제로 실린다", async () => {
    for (const p of ["/", "/en", "/privacy", "/quote", "/quote/done?code=ABCDEFGH"]) {
      const res = await fetch(`${BASE}${p}`);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("referrer-policy"), p).toBe("strict-origin");
    }
  }, 180_000);
});
