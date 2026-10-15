/**
 * OF2-C — 자체 방문자 통계 (마이그레이션 0027 · /api/stats/view · 관리자 그래프) — 순수 로직·핸들러·화면 테스트.
 * DB 쪽(권한·집계·삭제)은 tests/site-stats-db.test.ts 가 로컬 스택에서 증명한다.
 *
 * 구성
 *   1. 경로·봇·방문자 값(vid) — IP 원문이 들어가지 않는다 · 같은 사람은 같은 날 같은 값 · 날짜가 바뀌면 다른 값
 *   2. 클라이언트 비콘 — 거부(저장 표시 · DNT · GPC · 저장소 읽기 실패)면 보내지 않는다 · 관리자·/api 경로는 보내지 않는다
 *   3. 핸들러 — 봇·거부 헤더·관리자 경로·한도 초과는 세지 않는다 · 정상은 vid 만 DB 함수에 넘긴다 · 실패는 조용히 204 · 로그에 IP 없음
 *   4. 처리방침 문구 ↔ 구현 — 원장(siteStats)이 말한 네 가지가 실제 구현과 한 줄씩 맞는다(IP 원문 비저장 · 사흘 내 삭제 · 국내 DB 저장 · 거부 시 미집계)
 *   5. 관리자 화면 — 카드 6장 · 30일 선 그래프 둘(인라인 SVG) · 값 읽기 · 문구는 ko.json 에서만 · 새 패키지 없음
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PRIVACY_POLICY_SECTIONS } from "@/lib/legal/disclosures";
import { ANALYTICS_OPTOUT_KEY, readAnalyticsSignals, type AnalyticsSignals } from "@/lib/analytics/before-send";
import { handleSiteView, type SiteViewDeps } from "@/lib/stats/handler";
import { isBotUserAgent, isCountablePath, sendViewBeacon, shouldSendViewBeacon } from "@/lib/stats/site-view";
import { VISITOR_ID_LENGTH, visitorId } from "@/lib/stats/visitor-id";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** 주석을 지운 소스 — 구현이 "IP 를 쓴다" 는 것을 주석의 언급과 혼동하지 않는다. 제거기는 저장소의 하나뿐인 헬퍼다(tests/helpers/strip-comments.ts). */
function code(rel: string): string {
  return stripComments(read(rel), rel);
}

const SECRET = "s".repeat(40);
const IP = "203.0.113.77";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

const OK_SIGNALS: AnalyticsSignals = { optedOut: false, doNotTrack: null, globalPrivacyControl: false };

// =============================================================================
// 1. 경로 · 봇 · 방문자 값
// =============================================================================
describe("1. 집계 대상 · 방문자 값", () => {
  test("공개 페이지만 센다 — 관리자(로케일 접두사·대소문자·퍼센트 인코딩 포함)·/api·/_next·이상한 값은 센다고 보지 않는다", () => {
    // 'admin' 으로 **시작**하는 첫 세그먼트(/administrator)는 before-send 와 같은 보수적 규칙으로 막힌다(아래 목록)
    for (const p of ["/", "/ko", "/ko/quote", "/en/gallery/some-post", "/guide"]) expect(isCountablePath(p), p).toBe(true);
    for (const p of [
      "/admin",
      "/admin/stats",
      "/ko/admin",
      "/EN/Admin/reservations",
      "/%61dmin",
      "/%61dmin/stats",
      "/administrator",
      "/api/stats/view",
      "/API/cron/purge",
      "/ko/api/x",
      "/_next/static/x.js",
      "",
      "no-leading-slash",
      "/%E0%A4%A",
      "/" + "a".repeat(600),
    ]) {
      expect(isCountablePath(p), JSON.stringify(p)).toBe(false);
    }
    expect(isCountablePath(undefined)).toBe(false);
    expect(isCountablePath(42)).toBe(false);
  });

  test("봇 UA 는 센다고 보지 않는다 — 검색 로봇·미리보기·점검 도구·UA 없음", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; Yeti/1.1; +http://naver.me/spd)",
      "Mozilla/5.0 (compatible; Daum/4.1; +http://cs.daum.net/faq/15/4118.html)",
      "Mozilla/5.0 (compatible; YandexBot/3.0)",
      "facebookexternalhit/1.1",
      "Twitterbot/1.0",
      "Slackbot-LinkExpanding 1.0",
      "kakaotalk-scrap/1.0",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0 Safari/537.36",
      "Mozilla/5.0 (compatible; UptimeRobot/2.0)",
      "curl/8.4.0",
      "Wget/1.21",
      "python-requests/2.31",
      "Go-http-client/2.0",
      "node-fetch/1.0",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0)",
      "Lighthouse",
      "",
    ]) {
      expect(isBotUserAgent(ua), JSON.stringify(ua)).toBe(true);
    }
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent(undefined)).toBe(true);
    for (const ua of [
      UA,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.0)",
    ]) {
      expect(isBotUserAgent(ua), ua).toBe(false);
    }
  });

  test("vid = sha256(secret + KST날짜 + IP + UA) 앞 32자 — IP·UA 원문이 담기지 않는다", () => {
    const vid = visitorId({ secret: SECRET, kstDate: "2031-03-05", ip: IP, userAgent: UA });
    expect(vid).toMatch(/^[0-9a-f]{32}$/);
    expect(vid).toHaveLength(VISITOR_ID_LENGTH);
    expect(vid).not.toContain(IP);
    expect(vid).not.toContain(IP.replace(/\./g, ""));
    // 같은 사람 · 같은 날 → 같은 값(하루 한 번만 센다)
    expect(visitorId({ secret: SECRET, kstDate: "2031-03-05", ip: IP, userAgent: UA })).toBe(vid);
    // 날짜가 바뀌면 다른 값(내일의 값으로 오늘의 사람을 알아볼 수 없다) · IP·UA·secret 이 다르면 다른 값
    expect(visitorId({ secret: SECRET, kstDate: "2031-03-06", ip: IP, userAgent: UA })).not.toBe(vid);
    expect(visitorId({ secret: SECRET, kstDate: "2031-03-05", ip: "203.0.113.78", userAgent: UA })).not.toBe(vid);
    expect(visitorId({ secret: SECRET, kstDate: "2031-03-05", ip: IP, userAgent: UA + " x" })).not.toBe(vid);
    expect(visitorId({ secret: "t".repeat(40), kstDate: "2031-03-05", ip: IP, userAgent: UA })).not.toBe(vid);
  });

  test("secret 이 비면 던진다 — secret 없는 해시는 IPv4 전체 공간에서 되짚을 수 있다", () => {
    expect(() => visitorId({ secret: "", kstDate: "2031-03-05", ip: IP, userAgent: UA })).toThrow(/GUARD_SECRET/);
    expect(() => visitorId({ secret: SECRET, kstDate: "03/05/2031", ip: IP, userAgent: UA })).toThrow(/날짜/);
  });
});

// =============================================================================
// 2. 클라이언트 비콘 — 거부 시 보내지 않는다
// =============================================================================
describe("2. 클라이언트 비콘 (lib/stats/site-view.ts)", () => {
  test("거부 표시 · DNT(1·yes) · GPC 중 하나라도 있으면 보내지 않는다", () => {
    expect(shouldSendViewBeacon(OK_SIGNALS, "/ko")).toBe(true);
    expect(shouldSendViewBeacon({ ...OK_SIGNALS, optedOut: true }, "/ko")).toBe(false);
    expect(shouldSendViewBeacon({ ...OK_SIGNALS, doNotTrack: "1" }, "/ko")).toBe(false);
    expect(shouldSendViewBeacon({ ...OK_SIGNALS, doNotTrack: "yes" }, "/ko")).toBe(false);
    expect(shouldSendViewBeacon({ ...OK_SIGNALS, globalPrivacyControl: true }, "/ko")).toBe(false);
    // DNT "0" 은 거부가 아니다(before-send 와 같은 판정)
    expect(shouldSendViewBeacon({ ...OK_SIGNALS, doNotTrack: "0" }, "/ko")).toBe(true);
  });

  test("방문 통계 거부와 **같은 판정**이다 — lib/analytics/before-send.ts 의 analyticsRefused 를 그대로 쓴다(다른 규칙을 새로 만들지 않았다)", () => {
    const src = code("lib/stats/site-view.ts");
    expect(src).toMatch(/import\s*\{[^}]*\banalyticsRefused\b[^}]*\}\s*from\s*"@\/lib\/analytics\/before-send"/);
    expect(src).toMatch(/analyticsRefused\(/);
  });

  test("거부 신호가 실제 브라우저 값에서 읽힌다 — 저장 표시 · 저장소를 읽을 수 없음 · navigator.doNotTrack · globalPrivacyControl", () => {
    const storage = (v: string | null) => ({ getItem: (k: string) => (k === ANALYTICS_OPTOUT_KEY ? v : null) });
    expect(shouldSendViewBeacon(readAnalyticsSignals({ localStorage: storage(null), navigator: {} }), "/ko")).toBe(true);
    expect(shouldSendViewBeacon(readAnalyticsSignals({ localStorage: storage("1"), navigator: {} }), "/ko")).toBe(false);
    expect(shouldSendViewBeacon(readAnalyticsSignals({ localStorage: storage(null), navigator: { doNotTrack: "1" } }), "/ko")).toBe(false);
    expect(shouldSendViewBeacon(readAnalyticsSignals({ localStorage: storage(null), navigator: { globalPrivacyControl: true } }), "/ko")).toBe(false);
    // 저장소를 읽을 수 없으면 거부로 본다(거부했는지 모르는 채 세지 않는다)
    expect(shouldSendViewBeacon(readAnalyticsSignals({ navigator: {} }), "/ko")).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); } };
    expect(shouldSendViewBeacon(readAnalyticsSignals({ localStorage: broken, navigator: {} }), "/ko")).toBe(false);
  });

  test("관리자·/api 경로는 거부 신호가 없어도 보내지 않는다", () => {
    expect(shouldSendViewBeacon(OK_SIGNALS, "/admin/stats")).toBe(false);
    expect(shouldSendViewBeacon(OK_SIGNALS, "/ko/admin")).toBe(false);
    expect(shouldSendViewBeacon(OK_SIGNALS, "/api/x")).toBe(false);
  });

  test("sendViewBeacon — 거부면 전송 함수를 부르지 않는다 · 허용이면 경로(쿼리·해시 없이)만 한 번 보낸다", () => {
    const send = vi.fn(() => true);
    expect(sendViewBeacon("/ko/quote", { signals: { ...OK_SIGNALS, optedOut: true }, send })).toBe(false);
    expect(sendViewBeacon("/ko/quote", { signals: { ...OK_SIGNALS, doNotTrack: "1" }, send })).toBe(false);
    expect(sendViewBeacon("/ko/quote", { signals: { ...OK_SIGNALS, globalPrivacyControl: true }, send })).toBe(false);
    expect(sendViewBeacon("/admin", { signals: OK_SIGNALS, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();

    expect(sendViewBeacon("/ko/quote/done?code=AB12CD#x", { signals: OK_SIGNALS, send })).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, body] = send.mock.calls[0] as unknown as [string, string];
    expect(url).toBe("/api/stats/view");
    expect(JSON.parse(body)).toEqual({ path: "/ko/quote/done" }); // 접수번호(쿼리)가 새지 않는다
  });

  test("SiteAnalytics 는 **지금 읽은 신호**로만 비콘을 보낸다 — 렌더 허용 상태를 믿고 보내지 않는다(거부 직후에도 막힌다)", () => {
    const src = code("components/analytics/SiteAnalytics.tsx");
    expect(src).toMatch(/sendViewBeacon\(/);
    expect(src).toMatch(/signals:\s*readAnalyticsSignals\(\)/);
    expect(src).toMatch(/usePathname\(/);
    // 서버 렌더·첫 화면에서는 보내지 않는다 — useEffect 안에서만
    expect(src).not.toMatch(/sendBeacon/); // 직접 호출 없음: 전송은 site-view.ts 의 한 곳
  });
});

// =============================================================================
// 3. 핸들러
// =============================================================================
interface Harness {
  deps: SiteViewDeps;
  recorded: string[];
  rate: ReturnType<typeof vi.fn>;
}
function harness(over: Partial<SiteViewDeps> = {}): Harness {
  const recorded: string[] = [];
  const rate = vi.fn(async () => ({ ok: true as const }));
  const deps: SiteViewDeps = {
    now: () => new Date("2031-03-05T01:00:00Z"), // KST 10:00
    secret: () => SECRET,
    checkRate: rate as unknown as SiteViewDeps["checkRate"],
    record: async (vid) => {
      recorded.push(vid);
    },
    ...over,
  };
  return { deps, recorded, rate };
}
function req(over: { headers?: Record<string, string>; body?: unknown; rawBody?: string } = {}): Request {
  const headers: Record<string, string> = { "x-forwarded-for": IP, "user-agent": UA, "content-type": "text/plain;charset=UTF-8", ...over.headers };
  const body = over.rawBody ?? JSON.stringify(over.body ?? { path: "/ko/quote" });
  return new Request("http://localhost/api/stats/view", { method: "POST", headers, body });
}

describe("3. 핸들러 (lib/stats/handler.ts)", () => {
  afterEach(() => vi.restoreAllMocks());

  test("정상 방문 — 204 · DB 함수에는 vid(32자 hex) 하나만 넘긴다 · IP·UA 원문은 넘기지 않는다", async () => {
    const h = harness();
    const res = await handleSiteView(req(), h.deps);
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(h.recorded[0]).toBe(visitorId({ secret: SECRET, kstDate: "2031-03-05", ip: IP, userAgent: UA }));
    expect(JSON.stringify(h.recorded)).not.toContain(IP);
    // 한도 확인에 쓴 키도 IP 원문이 아니다(해시)
    const rateKey = (h.rate.mock.calls[0] as unknown[])[0] as string;
    expect(rateKey).toMatch(/^[0-9a-f]{16}$/);
    expect(rateKey).not.toContain(IP);
  });

  test("KST 날짜로 vid 를 만든다 — UTC 15:00(= KST 다음 날 00:00)부터 다른 값", async () => {
    const before = harness({ now: () => new Date("2031-03-05T14:59:59Z") });
    const after = harness({ now: () => new Date("2031-03-05T15:00:00Z") });
    await handleSiteView(req(), before.deps);
    await handleSiteView(req(), after.deps);
    expect(before.recorded[0]).toBe(visitorId({ secret: SECRET, kstDate: "2031-03-05", ip: IP, userAgent: UA }));
    expect(after.recorded[0]).toBe(visitorId({ secret: SECRET, kstDate: "2031-03-06", ip: IP, userAgent: UA }));
  });

  test("세지 않는 요청 — 봇 UA · UA 없음 · DNT · Sec-GPC · 관리자 경로 · /api 경로 · 깨진 본문 · 큰 본문 (모두 조용히 204, 기록 0)", async () => {
    const cases: [string, Request][] = [
      ["봇", req({ headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } })],
      ["UA 없음", req({ headers: { "user-agent": "" } })],
      ["DNT", req({ headers: { dnt: "1" } })],
      ["Sec-GPC", req({ headers: { "sec-gpc": "1" } })],
      ["관리자 경로", req({ body: { path: "/admin/stats" } })],
      ["로케일 관리자 경로", req({ body: { path: "/ko/admin" } })],
      ["api 경로", req({ body: { path: "/api/cron/purge" } })],
      ["경로 없음", req({ body: {} })],
      ["깨진 JSON", req({ rawBody: "{not json" })],
      ["배열 본문", req({ rawBody: "[1,2]" })],
      ["큰 본문", req({ rawBody: JSON.stringify({ path: "/ko", pad: "x".repeat(5000) }) })],
    ];
    for (const [name, r] of cases) {
      const h = harness();
      const res = await handleSiteView(r, h.deps);
      expect(res.status, name).toBe(204);
      expect(h.recorded, name).toEqual([]);
    }
  });

  test("DNT: 0 · Sec-GPC: 0 은 거부가 아니다 — 센다", async () => {
    const h = harness();
    await handleSiteView(req({ headers: { dnt: "0", "sec-gpc": "0" } }), h.deps);
    expect(h.recorded).toHaveLength(1);
  });

  test("IP 한도 초과(ratelimit)는 세지 않는다 · Redis 장애(infra)는 세기를 멈추지 않는다(통계는 보안 경계가 아니다)", async () => {
    const limited = harness({ checkRate: async () => ({ ok: false, reason: "ratelimit", detail: {} }) as never });
    expect((await handleSiteView(req(), limited.deps)).status).toBe(204);
    expect(limited.recorded).toEqual([]);

    const down = harness({ checkRate: async () => ({ ok: false, reason: "infra", detail: {} }) as never });
    expect((await handleSiteView(req(), down.deps)).status).toBe(204);
    expect(down.recorded).toHaveLength(1);

    const throws = harness({
      checkRate: async () => {
        throw new Error("upstash down");
      },
    });
    expect((await handleSiteView(req(), throws.deps)).status).toBe(204);
    expect(throws.recorded).toHaveLength(1);
  });

  test("IP 헤더가 없으면 'unknown' 버킷으로 센다 · secret 이 없거나 DB 가 실패하면 조용히 204(세지 않는다) — 로그에 IP 도 vid 도 없다", async () => {
    const logs: string[] = [];
    for (const m of ["error", "warn", "log", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));

    const noIp = harness();
    await handleSiteView(req({ headers: { "x-forwarded-for": "" } }), noIp.deps);
    expect(noIp.recorded).toHaveLength(1);
    expect((noIp.rate.mock.calls[0] as unknown[])[1]).toBe("unknown");

    const noSecret = harness({
      secret: () => {
        throw new Error("GUARD_SECRET 없음");
      },
    });
    expect((await handleSiteView(req(), noSecret.deps)).status).toBe(204);
    expect(noSecret.recorded).toEqual([]);

    const dbDown = harness({
      record: async () => {
        throw new Error(`insert failed for ${IP} ${UA}`);
      },
    });
    expect((await handleSiteView(req(), dbDown.deps)).status).toBe(204);

    const everything = logs.join("\n");
    expect(everything).not.toContain(IP);
    expect(everything).not.toContain(UA);
    expect(everything).not.toMatch(/[0-9a-f]{32}/);
  });
});

// =============================================================================
// 4. 처리방침 ↔ 구현 — 원장(siteStats)이 말한 것이 코드와 맞는다
// =============================================================================
describe("4. 처리방침 문구 ↔ 구현 일치 (원장 PRIVACY_POLICY_SECTIONS.siteStats)", () => {
  const policy = (PRIVACY_POLICY_SECTIONS.find((s) => s.key === "siteStats") as { body: string }).body;
  const migration = read("supabase/migrations/0027_site_stats.sql");
  const migrationCode = stripComments(migration, "supabase/migrations/0027_site_stats.sql");
  const HANDLER_FILES = ["app/api/stats/view/route.ts", "lib/stats/handler.ts", "lib/stats/site-view.ts", "lib/stats/visitor-id.ts"] as const;

  test("원장이 이 네 가지를 실제로 말하고 있다(문구가 바뀌면 이 테스트가 먼저 빨개진다)", () => {
    expect(policy).toContain("IP 주소 원문은 저장하지 않습니다");
    expect(policy).toContain("사흘 안에 삭제");
    expect(policy).toContain("국내(서울) 데이터베이스에 저장");
    expect(policy).toMatch(/방문 통계 거부.*추적 거부.*포함되지 않습니다/);
  });

  test("① IP 원문을 저장하지 않는다 — 표에 IP 칸이 없고, DB 함수는 vid 만 받고, 핸들러는 IP 를 어디에도 넘기지 않는다", () => {
    // 표 두 개의 칸 전부(칸 이름으로 IP·UA·주소류가 없다)
    const tables = [...migrationCode.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\)\s*;/g)];
    expect(tables.map((t) => t[1]).sort()).toEqual(["site_stats_daily", "site_visitors_seen"]);
    for (const [, name, body] of tables) {
      const cols = body
        .split("\n")
        .map((l) => l.trim().match(/^(\w+)\s+(date|integer|bigint|text)\b/)?.[1])
        .filter(Boolean);
      expect(cols, name).not.toContain("ip");
      expect(cols.join(","), name).not.toMatch(/ip|addr|agent|ua\b|host|referer|path|url/i);
    }
    expect(migrationCode).toMatch(/create (?:or replace )?function record_site_view\(p_vid text\)/);
    // vid 모양 검사 — IP(점이 있는 값)는 이 함수에 들어올 수 없다
    expect(migrationCode).toMatch(/p_vid !~ '\^\[0-9a-f\]\{32\}\$'/);

    // 핸들러: DB 로 가는 호출은 record(vid) 하나 · IP 변수는 해시 입력과 한도 키에만 쓴다
    const h = code("lib/stats/handler.ts");
    expect(h).toMatch(/record\(vid\)/);
    expect(h).not.toMatch(/record\([^)]*\bip\b/i);
    expect(h).not.toMatch(/console\.\w+\([^)]*\b(ip|ua|userAgent|vid)\b/i);
    const route = code("app/api/stats/view/route.ts");
    expect(route).not.toMatch(/console\.\w+\([^)]*\b(ip|headers)\b/i);
    expect(route).not.toMatch(/\.insert\(|\.from\(/); // 표를 직접 만지지 않는다 — definer 함수 하나만(rpc)
    expect(route).toMatch(/\.rpc\(\s*"record_site_view"\s*,\s*\{\s*p_vid:\s*vid\s*\}/);
  });

  test("② 일회용 값은 사흘 안에 지운다 — 보관 한도(오늘·어제만 남김)가 3일 미만이고, 첫 방문 때와 매일 크론 두 곳에서 지운다", () => {
    // 삭제 조건: day < 오늘(KST) - 1 → 남는 것은 오늘·어제뿐 = 최대 보관 2일 남짓(< 3일)
    const keep = migrationCode.match(/delete from site_visitors_seen\s+where day < \(?\s*[^;]*?-\s*(\d+)\s*\)?;/g);
    expect(keep, "삭제문이 최소 두 군데(record · purge)").not.toBeNull();
    expect((keep as string[]).length).toBeGreaterThanOrEqual(2);
    for (const stmt of keep as string[]) {
      const n = Number(stmt.match(/-\s*(\d+)\s*\)?;$/)?.[1]);
      expect(n, stmt).toBeLessThanOrEqual(1);
    }
    expect(migrationCode).toMatch(/create (?:or replace )?function purge_site_visitors_seen\(\)/);
    // 매일 크론이 부른다(방문이 끊겨도 지워진다)
    const cron = code("app/api/cron/purge/route.ts");
    expect(cron).toMatch(/purge_site_visitors_seen/);
    // 집계 표(날짜별 숫자)는 지우지 않는다 — "날짜별 숫자만 남긴다"
    expect(migrationCode).not.toMatch(/delete from site_stats_daily/);
  });

  test("③ 집계는 국내(서울) DB 에만 저장한다 — 값이 흐르는 곳은 Supabase 서비스 클라이언트 하나뿐이다(제3자 전송·외부 호출 없음)", () => {
    for (const f of HANDLER_FILES) {
      const src = code(f);
      // 서버 쪽 파일은 어디로도 요청하지 않는다. 브라우저 쪽(site-view)의 keepalive fetch 는 같은 출처 경로(SITE_VIEW_ENDPOINT)로만 간다.
      if (f === "lib/stats/site-view.ts") expect(src.match(/\bfetch\(([^,)]*)/g)).toEqual(["fetch(url"]);
      else expect(src, f).not.toMatch(/\bfetch\(/);
      expect(src, f).not.toMatch(/https?:\/\//);
      expect(src, f).not.toMatch(/@vercel\/analytics|\btrack\(|gtag|sendBeacon\(.*https?:/);
      expect(src, f).not.toMatch(/Upstash|Redis|redis/); // 방문자 값(vid)은 Redis 로 가지 않는다(한도 키는 IP 해시 · deps.ts 의 별도 scope)
    }
    const route = code("app/api/stats/view/route.ts");
    expect(route).toMatch(/createServiceClient\(\)/);
    // 한도 확인에 쓰는 키는 vid 가 아니라 IP 해시다 — vid 가 외부로 나가지 않는다
    const h = code("lib/stats/handler.ts");
    expect(h).toMatch(/checkRate\(\s*rate\.key\s*,\s*rate\.bucket\s*\)/);
    expect(h).not.toMatch(/checkRate\([^)]*vid/);
    // 원장도 Supabase 를 서울 리전(국내)으로 적고 있다 — 이 문장의 근거
    const ledger = read("lib/legal/disclosures.ts");
    expect(ledger).toMatch(/name: "Supabase Inc\."[^}]*location: "대한민국\(서울 리전\)"/);
  });

  test("④ 거부하면 세지 않는다 — 클라이언트는 거부 신호에서 비콘을 보내지 않고(§2), 서버는 DNT·Sec-GPC 헤더가 오면 세지 않는다(§3)", () => {
    const h = code("lib/stats/handler.ts");
    expect(h).toMatch(/browserSendsRefusal\(/);
    const sv = code("lib/stats/site-view.ts");
    expect(sv).toMatch(/analyticsRefused\(/);
    expect(sv).toMatch(/["']dnt["']/i);
    expect(sv).toMatch(/["']sec-gpc["']/i);
    // 거부 버튼(처리방침)과 같은 저장 키를 읽는다 — 다른 키를 새로 만들지 않았다
    expect(code("lib/analytics/before-send.ts")).toContain(ANALYTICS_OPTOUT_KEY);
  });
});

// =============================================================================
// 5. 관리자 화면
// =============================================================================
import { SITE_STATS_DAYS, assertSiteStatsShape, chartLayout, summarizeSiteStats, type SiteStats } from "@/lib/admin/siteStats";
import { SiteStatsChart, type SiteStatsChartLabels } from "@/components/admin/SiteStatsChart";

function sampleStats(n = 30, today = "2031-03-30"): SiteStats {
  const end = Date.parse(`${today}T00:00:00Z`);
  const days = Array.from({ length: n }, (_, i) => {
    const d = new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const views = (i % 7) * 11 + 3;
    return { day: d, views, visitors: Math.min(views, (i % 5) * 3 + 1) }; // 방문자 ≤ 조회수 (DB check 제약과 같다)
  });
  return { today, days, total_views: 1234, total_visitors: 567 };
}
const LABELS: SiteStatsChartLabels = {
  chartLabel: "최근 30일 조회수·방문자 그래프",
  views: "조회수",
  visitors: "방문자",
  date: "{m}월 {d}일",
  tip: "{date} · 조회수 {views} · 방문자 {visitors}",
};

describe("5. 관리자 방문자 통계 화면", () => {
  test("DB 결과 모양 검사 — 어긋나면 던진다(그래프가 거짓 숫자를 그리지 않게)", () => {
    const ok = sampleStats();
    expect(assertSiteStatsShape(ok)).toEqual(ok);
    for (const bad of [null, {}, { ...ok, days: "x" }, { ...ok, total_views: -1 }, { ...ok, days: [{ day: "2031-03-01", views: 1 }] }, { ...ok, today: "3/30" }, { ...ok, days: [] }]) {
      expect(() => assertSiteStatsShape(bad), JSON.stringify(bad).slice(0, 60)).toThrow();
    }
  });

  test("카드 숫자 — 오늘·어제·누적(조회수·방문자) 이 DB 가 준 값 그대로다 · 하루치뿐이면 어제는 0", () => {
    const s = sampleStats();
    const t = s.days[s.days.length - 1];
    const y = s.days[s.days.length - 2];
    expect(summarizeSiteStats(s)).toEqual({
      views: { today: t.views, yesterday: y.views, total: 1234 },
      visitors: { today: t.visitors, yesterday: y.visitors, total: 567 },
    });
    const one = sampleStats(1);
    expect(summarizeSiteStats(one).views.yesterday).toBe(0);
  });

  test("그래프 배치 — 30점 · 두 선이 같은 눈금 · 왼쪽→오른쪽 날짜순 · 값이 클수록 위(y 작음) · 전부 0이어도 나눗셈이 터지지 않는다", () => {
    const s = sampleStats();
    expect(SITE_STATS_DAYS).toBe(30);
    const g = chartLayout(s.days, { width: 640, height: 220 });
    expect(g.points).toHaveLength(30);
    expect(g.views.split(" ")).toHaveLength(30);
    expect(g.visitors.split(" ")).toHaveLength(30);
    const xs = g.points.map((p) => p.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const hi = g.points.reduce((m, p, i) => (s.days[i].views > s.days[m].views ? i : m), 0);
    const lo = g.points.reduce((m, p, i) => (s.days[i].views < s.days[m].views ? i : m), 0);
    expect(g.points[hi].viewsY).toBeLessThan(g.points[lo].viewsY);
    // 같은 눈금 — 방문자 ≤ 조회수 이므로 방문자 점이 조회수 점보다 아래(y 가 같거나 크다)
    for (const p of g.points) expect(p.visitorsY).toBeGreaterThanOrEqual(p.viewsY);
    expect(g.ticks.length).toBeGreaterThanOrEqual(2);
    const zero = chartLayout(sampleStats().days.map((d) => ({ ...d, views: 0, visitors: 0 })), { width: 640, height: 220 });
    for (const p of zero.points) {
      expect(Number.isFinite(p.viewsY)).toBe(true);
      expect(Number.isFinite(p.x)).toBe(true);
    }
  });

  test("차트 렌더 — 인라인 SVG · 선 둘 · 30개 값 읽기 칸(점/막대) · 날짜 축 · 새 패키지 없음", () => {
    const s = sampleStats();
    const html = renderToStaticMarkup(createElement(SiteStatsChart, { days: s.days, labels: LABELS }) as ReactElement);
    expect(html).toContain("<svg");
    expect((html.match(/<polyline/g) ?? []).length).toBe(2);
    expect((html.match(/data-day="/g) ?? []).length).toBe(30);
    expect(html).toContain('role="img"');
    expect(html).toContain(LABELS.chartLabel);
    // 값 읽기: 모든 칸이 접근 가능한 이름으로 값을 말한다(마우스 올림·탭·키보드)
    const first = s.days[0];
    const dd = `${Number(first.day.slice(5, 7))}월 ${Number(first.day.slice(8, 10))}일`;
    expect(html).toContain(`${dd} · 조회수 ${first.views} · 방문자 ${first.visitors}`);
    // 날짜 축 — 처음·끝 날짜가 있다
    expect(html).toContain(">3/1<");
    expect(html).toContain(">3/30<");
    // 범례
    expect(html).toContain(LABELS.views);
    expect(html).toContain(LABELS.visitors);
    // 색은 역할 토큰뿐 — HEX·rgb 직접 값이 없다
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> };
    const all = Object.keys({ ...pkg.dependencies, ...(pkg.devDependencies ?? {}) });
    expect(all.filter((n) => /chart|d3|recharts|victory|visx|nivo|plotly|echarts|uplot/i.test(n))).toEqual([]);
  });

  test("차트 컴포넌트는 클라이언트 컴포넌트이고 값 읽기 상태(hover·tap·focus)를 가진다", () => {
    const src = read("components/admin/SiteStatsChart.tsx");
    expect(src.startsWith('"use client"')).toBe(true);
    expect(src).toMatch(/onPointerEnter|onMouseEnter/);
    expect(src).toMatch(/onClick|onPointerDown/);
    expect(src).toMatch(/onFocus/);
  });

  test("화면 문구는 ko.json 에서만 — 설명은 한 줄(집계 시작일)뿐, 컴포넌트에 한글 리터럴이 없다", () => {
    const ko = JSON.parse(read("messages/ko.json")) as { admin: { stats: { siteStats: Record<string, string> } } };
    const t = ko.admin.stats.siteStats;
    for (const k of ["title", "views", "visitors", "today", "yesterday", "total", "chartLabel", "tip", "launchNote", "error"]) expect(t[k], k).toBeTruthy();
    // 자리표시자가 든 틀(date·tip)은 값 없이 t() 로 부르면 next-intl 이 FORMATTING_ERROR 를 낸다 — 패널은 raw 로 넘기고, 틀은 차트가 아는 자리표시자만 쓴다
    const panel = code("components/admin/SiteStatsPanel.tsx");
    expect(panel).toMatch(/date:\s*String\(t\.raw\("date"\)\)/);
    expect(panel).toMatch(/tip:\s*String\(t\.raw\("tip"\)\)/);
    expect(panel).not.toMatch(/\bt\("(date|tip)"\)/);
    expect([...t.date.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()).toEqual(["d", "m"]);
    expect([...t.tip.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()).toEqual(["date", "views", "visitors"]);
    // 설명 문구는 한 줄 — "집계 시작" 안내 하나만 있다(거부자 제외·IP 처리 같은 설명은 화면에 쓰지 않는다)
    const notes = Object.keys(t).filter((k) => /note/i.test(k));
    expect(notes).toEqual(["launchNote"]);
    expect(t.launchNote.length).toBeLessThanOrEqual(40);
    expect(t.launchNote).not.toMatch(/IP|거부|해시|일회용/);
    // (lib 의 오류 메시지는 개발자용 Korean 문구가 저장소 관례라 대상이 아니다 — 화면에 그려지는 컴포넌트만 본다)
    for (const f of ["components/admin/SiteStatsChart.tsx", "components/admin/SiteStatsPanel.tsx"]) {
      const src = code(f);
      expect(src.match(/[가-힣]/g), `${f} 에 한글 리터럴`).toBeNull();
    }
  });

  test("패널은 관리자 세션 클라이언트로만 읽는다 — 서비스 롤 금지 · 통계 페이지가 패널을 그린다 · 읽기 함수 첫 줄이 requireAdmin 을 거친 화면 안에 있다", () => {
    const lib = code("lib/admin/siteStatsQuery.ts");
    expect(lib).toMatch(/\.rpc\(SITE_STATS_RPC\b/);
    expect(code("lib/admin/siteStats.ts")).toMatch(/SITE_STATS_RPC = "admin_site_stats"/);
    expect(lib).toMatch(/createSsrClient\(/);
    expect(lib).not.toMatch(/createServiceClient|SERVICE_ROLE/);
    const page = code("app/admin/(protected)/stats/page.tsx");
    expect(page).toMatch(/<SiteStatsPanel\b/);
    expect(page.indexOf("await requireAdmin()")).toBeGreaterThan(-1);
    expect(page.indexOf("await requireAdmin()")).toBeLessThan(page.indexOf("<SiteStatsPanel"));
  });
});
