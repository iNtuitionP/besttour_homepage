/**
 * 자체 방문자 통계(OF2-C) — 순수 규칙: 무엇을 세는가 · 방문자 값(vid) · 클라이언트 비콘.
 *
 * 처리방침(원장 PRIVACY_POLICY_SECTIONS.siteStats)이 고지하는 것을 이 모듈이 참으로 만든다:
 *   · "접속 IP 주소와 브라우저 정보를 그날에만 쓰이는 일회용 값으로 바꾸어 사용하며, IP 주소 원문은 저장하지 않습니다"
 *       → visitorId = sha256(GUARD_SECRET + KST 날짜 + IP + UA) 앞 32자. 날짜가 들어가므로 내일의 값으로 오늘의 사람을 알아볼 수 없다.
 *   · "방문 통계 거부 … 추적 거부(DNT·GPC) 설정을 켜시면 이 집계에도 포함되지 않습니다"
 *       → 클라이언트는 거부 신호(저장 표시 · DNT · GPC · 저장소 읽기 실패)가 하나라도 있으면 비콘을 보내지 않는다.
 *         판정은 lib/analytics/before-send.ts 의 analyticsRefused 를 **그대로** 쓴다(Vercel 통계와 같은 결정 — 다른 규칙을 만들지 않는다).
 *         서버는 한 번 더 DNT·Sec-GPC 요청 헤더를 본다(browserSendsRefusal).
 *
 * 세지 않는 것: 관리자 경로 · /api · /_next · 검색 로봇·미리보기·점검 도구(UA) · UA 없는 요청.
 * 이 파일은 전역을 읽지 않는다(브라우저 전역은 sendViewBeacon 의 deps 로 받는다) — vitest(node)가 그대로 돈다.
 * 클라이언트 번들(SiteAnalytics)이 import 하므로 node 모듈을 쓰지 않는다 — 방문자 값(vid)은 서버 전용 ./visitor-id.ts 에 있다.
 */
import { analyticsRefused, isAdminPath, type AnalyticsSignals } from "@/lib/analytics/before-send";

/** 비콘이 가는 같은 출처 경로. */
export const SITE_VIEW_ENDPOINT = "/api/stats/view";
/** 비콘 본문 상한(바이트에 준하는 문자 수) — 경로 하나만 싣는다. */
export const SITE_VIEW_MAX_BODY = 1024;
/** 경로 상한 — 이보다 길면 정상 페이지가 아니다. */
const MAX_PATH_LENGTH = 512;

const LOCALE_PREFIX = /^\/(?:ko|en)(?=\/|$)/i;

function decodeSafely(p: string): string | null {
  try {
    return decodeURIComponent(p);
  } catch {
    return null;
  }
}

/**
 * 세어도 되는 경로인가 — 공개 페이지(로케일 트리)만. 관리자(before-send 와 같은 규칙: 로케일 접두사·대소문자·퍼센트 인코딩·`/administrator` 까지) ·
 * /api · /_next 는 아니다. 문자열이 아니거나 `/` 로 시작하지 않거나 너무 길거나 디코딩할 수 없으면 아니다(모르는 것은 세지 않는다).
 */
export function isCountablePath(pathname: unknown): boolean {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.length > MAX_PATH_LENGTH) return false;
  if (isAdminPath(pathname)) return false;
  const decoded = decodeSafely(pathname);
  if (decoded === null) return false;
  const bare = decoded.toLowerCase().replace(LOCALE_PREFIX, "");
  return !(/^\/api(?:\/|$)/.test(bare) || bare.startsWith("/_next") || bare.startsWith("/_vercel"));
}

/** 봇·미리보기·점검 도구 UA — 사람의 방문이 아니다. UA 가 없어도 센다고 보지 않는다. */
const BOT_UA =
  /bot\b|bot[/ ;)_-]|crawl|spider|slurp|yeti|daum|mediapartners|bingpreview|facebookexternalhit|facebot|embedly|quora link|pinterest|whatsapp|telegram|discord|slack|kakaotalk-scrap|headless|phantomjs|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|statuscake|datadog|newrelic|curl\/|wget\/|python-requests|python-urllib|aiohttp|httpx|go-http-client|java\/|okhttp\/|libwww|apache-httpclient|node-fetch|axios\/|undici|scrapy|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|vercel-/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== "string" || userAgent.trim() === "") return true;
  return BOT_UA.test(userAgent);
}

interface HeaderReader {
  get(name: string): string | null;
}

/** 요청 헤더의 거부 신호 — 브라우저가 보내는 `DNT: 1` · `Sec-GPC: 1`. 클라이언트 판정을 서버에서 한 번 더 본다. */
export function browserSendsRefusal(headers: HeaderReader): boolean {
  return headers.get("dnt")?.trim() === "1" || headers.get("sec-gpc")?.trim() === "1";
}

/** 이 브라우저가 이 경로에서 비콘을 보내도 되는가 — 거부 신호가 없고 세어도 되는 경로일 때만. */
export function shouldSendViewBeacon(signals: AnalyticsSignals, pathname: string): boolean {
  if (analyticsRefused(signals)) return false;
  return isCountablePath(pathname);
}

export interface ViewBeaconDeps {
  /** 지금 읽은 거부 신호(호출하는 순간의 값 — 이전에 읽은 값을 믿지 않는다). */
  signals: AnalyticsSignals;
  /** 실제 전송. 브라우저에서는 browserBeaconSender(). */
  send: (url: string, body: string) => boolean | void;
}

/** 비콘 본문 = 경로 하나. 쿼리·해시는 지운다(`/quote/done?code=…` 의 접수번호가 새지 않게). */
export function sendViewBeacon(pathname: string, deps: ViewBeaconDeps): boolean {
  if (!shouldSendViewBeacon(deps.signals, pathname)) return false;
  const clean = pathname.split(/[?#]/, 1)[0];
  deps.send(SITE_VIEW_ENDPOINT, JSON.stringify({ path: clean }));
  return true;
}

/** 브라우저 전송 — sendBeacon(페이지를 떠나도 끝까지 간다) · 없으면 keepalive fetch. 실패는 삼킨다(통계가 화면을 깨면 안 된다). */
export function browserBeaconSender(): (url: string, body: string) => boolean {
  return (url, body) => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        return navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      }
      void fetch(url, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain;charset=UTF-8" } }).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  };
}
