/**
 * 방문 통계(Vercel Web Analytics) — 전송 직전 필터 · 거부 신호 판정 (P1-7 브리프 (3) · 수정 라운드 2).
 *
 * 처리방침(원장 PRIVACY_POLICY_SECTIONS.cookies · VISITOR_STATS_TRANSFER)이 고지하는 것을 이 모듈이 참으로 만든다:
 *   "회사는 관리자 화면 주소를 보내지 않고, 주소 뒤에 붙는 매개변수(검색어·접수번호 등)는 지운 뒤 보냅니다.
 *    방문 통계는 … '방문 통계 거부' 버튼이나 브라우저의 추적 거부(Do Not Track·GPC) 설정으로 거부하실 수 있으며,
 *    거부 표시는 브라우저 저장소(localStorage)에 남습니다."
 *
 * 1. 거부 신호(R2) — 거부 표시(localStorage `bestour:analytics-optout` = "1") · `navigator.doNotTrack` "1"(옛 Firefox "yes") ·
 *    `navigator.globalPrivacyControl === true` 중 하나라도 있으면:
 *      · SiteAnalytics 가 `<Analytics>` 를 **렌더하지 않는다** — 스크립트 자체를 불러오지 않는다(shouldLoadAnalytics).
 *      · 이미 불러온 뒤 거부해도 beforeSend 가 그때의 신호를 다시 읽어 null 을 돌려준다(이중 안전 — liveAnalyticsBeforeSend).
 *    저장소를 **읽을 수 없으면 거부로 본다** — 거부했는지 모르는 채 보내지 않는다.
 *    저장소에 **쓰지 못해도** 이번 방문 동안은 거부다(R3 [P2-C] — 메모리 표시 `sessionAnalyticsOptOut`). 버튼이 "저장할 수 없습니다" 라고
 *    말하면서 실제로는 계속 보내던 것이 astra 재검토의 지적이었다. 표시와 동작은 `readAnalyticsSignals` 한 곳에서 함께 나온다.
 * 2. 관리자 경로(`/admin`, 로케일 접두사가 붙은 `/ko/admin`·`/en/admin` 포함 — 첫 경로 세그먼트가 `admin` 으로 시작)는 **보내지 않는다**(null).
 *    관리자 레이아웃에는 애초에 Analytics 를 넣지 않았지만(app/admin/** — tests/analytics.test.ts), 필터에서 한 번 더 막는다.
 *    대소문자·퍼센트 인코딩(`/%61dmin`)으로 비켜 가지 못하게 디코딩·소문자로 판정한다. 판정은 보수적이다 — `/administrator` 도 막힌다.
 * 3. 그 밖의 주소는 **쿼리 문자열과 해시를 지운** 주소로 보낸다. `/quote/done?code=…` 에 접수번호가, 위저드 프리필(`?origin=&pax=`)과
 *    단계(`?step=`)에 입력값이 실린다. (Referer 로 새는 경로는 /quote/done 의 no-referrer 메타가 막는다 — R2 [P2-7].)
 * 4. 해석할 수 없는 주소는 보내지 않는다 — 모르는 것을 흘리지 않는다.
 * 이벤트의 다른 필드는 그대로 두고 url 만 바꾼 **새 객체**를 돌려준다(입력을 바꾸지 않는다). 커스텀 이벤트는 쓰지 않는다.
 *
 * 판정 함수는 전부 인자로 받은 값만 본다 — vitest(node)가 그대로 돌린다. 브라우저 전역을 읽는 것은 read·live 두 함수뿐이고,
 * 그것도 전역을 인자로 넘겨 테스트할 수 있다. Vercel 쪽 동작(쿠키·IP·하루 초기화)은 이 모듈이 보증하지 않는다(고지도 "밝히고 있습니다").
 */

/** 거부 표시를 남기는 localStorage 키. 값 "1" = 거부. */
export const ANALYTICS_OPTOUT_KEY = "bestour:analytics-optout";
/** 같은 탭 안에서 거부/허용이 바뀌었음을 알리는 window 이벤트 이름(SiteAnalytics 가 듣는다). */
export const ANALYTICS_OPTOUT_EVENT = "bestour:analytics-optout-change";

/**
 * **이번 방문(메모리) 거부 표시** — R3 [P2-C].
 * 저장소에 쓰지 못하는 브라우저(사파리 옛 사생활 모드·용량 초과·차단)에서도 버튼을 누른 효과가 **실제로** 나야 한다.
 * 옛 판은 `ok:false` 만 돌려주고 수집을 계속했다 — 버튼은 "저장할 수 없습니다" 라고 하면서 막지 않았고, 그것은 고지와 달랐다.
 * 이 표시는 탭을 닫으면 사라진다(그래서 "이번 방문"). 저장이 되는 브라우저에서는 저장소 값이 다음 방문까지 남는다.
 *
 * ⚠️ **한계**(R4 [P2-E] astra 재현 — 고지가 이 사실을 말한다): 저장이 막힌 브라우저에서는 이 표시가 **그 문서에만** 있다.
 * 같은 순간 열려 있는 **다른 탭**과 **새로고침 뒤의 그 탭**은 다시 수집한다. 구조적으로 막을 수 없어(저장소가 유일한 공유 수단이다)
 * 원장 `VISITOR_STATS_TRANSFER.refusal` 과 자동 수집 장치 절이 "그때는 브라우저의 추적 거부 설정을 함께 켜 달라" 고 적는다.
 */
let sessionOptOut = false;

/** 이번 방문 거부 표시를 읽는다(테스트·컴포넌트 판정용). */
export function sessionAnalyticsOptOut(): boolean {
  return sessionOptOut;
}

/** 이번 방문 거부 표시를 세우거나 내린다. setAnalyticsOptOut 이 먼저 부르고, 테스트가 블록마다 되돌린다. */
export function setSessionAnalyticsOptOut(value: boolean): void {
  sessionOptOut = value;
}

export interface AnalyticsSignals {
  /** 거부 표시 — 저장소 "1" · 저장소를 읽을 수 없음 · 이번 방문 메모리 표시 중 하나라도. */
  optedOut: boolean;
  doNotTrack: string | null | undefined;
  globalPrivacyControl: boolean | undefined;
}

/** 브라우저 설정(추적 거부)만 본다 — 버튼이 "이미 거부 중" 을 보여 줄 근거(R3 [P2-C]). 사이트 버튼으로 되돌릴 수 없다. */
export function browserRefused(s: AnalyticsSignals): boolean {
  return s.doNotTrack === "1" || s.doNotTrack === "yes" || s.globalPrivacyControl === true;
}

/** 하나라도 거부면 true. */
export function analyticsRefused(s: AnalyticsSignals): boolean {
  return s.optedOut || browserRefused(s);
}

/** `<Analytics>` 를 렌더(스크립트를 불러옴)해도 되는가. */
export function shouldLoadAnalytics(s: AnalyticsSignals): boolean {
  return !analyticsRefused(s);
}

interface ReadableStorage {
  getItem(key: string): string | null;
}
interface SignalSource {
  localStorage?: ReadableStorage;
  navigator?: { doNotTrack?: string | null; globalPrivacyControl?: boolean };
}

/** 브라우저 전역(또는 테스트가 넘긴 대역)에서 거부 신호를 읽는다. 저장소가 없거나 읽기가 던지면 거부로 본다. */
export function readAnalyticsSignals(source: SignalSource = globalThis as unknown as SignalSource): AnalyticsSignals {
  let optedOut: boolean;
  try {
    const storage = source.localStorage;
    optedOut = storage ? storage.getItem(ANALYTICS_OPTOUT_KEY) === "1" : true;
  } catch {
    optedOut = true;
  }
  // 저장에 실패한 브라우저에서도 이번 방문 동안은 거부다(R3 [P2-C]).
  if (sessionOptOut) optedOut = true;
  const nav = source.navigator ?? {};
  return {
    optedOut,
    doNotTrack: typeof nav.doNotTrack === "string" ? nav.doNotTrack : null,
    globalPrivacyControl: nav.globalPrivacyControl === true,
  };
}

interface WritableStorage extends ReadableStorage {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface OptOutDeps {
  localStorage?: WritableStorage;
  notify?: (eventName: string) => void;
}

/**
 * 거부(true)는 키를 쓰고, 허용(false)은 키를 지운다.
 *
 * **저장보다 먼저 이번 방문 표시를 바꾼다**(R3 [P2-C]) — 저장이 실패해도 그 브라우저에서는 이번 방문 동안 수집이 멈춘다.
 * 돌려주는 `ok` 는 "다음 방문까지 남도록 **저장**했는가" 다. false 면 호출부는 조용히 삼키지 말고
 * "저장하지 못했지만 이번 방문 동안은 보내지 않는다" 를 보여 준다(LEGAL_LABELS.analyticsOptOut.storageFailed).
 * 알림은 저장 성공 여부와 무관하게 쏜다 — 같은 탭의 SiteAnalytics 가 다시 판정해야 하기 때문이다.
 *
 * 허용(false)으로 되돌릴 때 저장소의 "1" 을 지우지 못하면, 판정은 그 저장소 값 때문에 여전히 "거부" 다 —
 * 그래서 화면 표시도 거부로 남는다(readAnalyticsSignals 한 곳에서 표시와 동작이 함께 나온다).
 */
export function setAnalyticsOptOut(optOut: boolean, deps: OptOutDeps = defaultOptOutDeps()): { ok: boolean } {
  setSessionAnalyticsOptOut(optOut);
  let ok = false;
  try {
    const storage = deps.localStorage;
    if (storage) {
      if (optOut) storage.setItem(ANALYTICS_OPTOUT_KEY, "1");
      else storage.removeItem(ANALYTICS_OPTOUT_KEY);
      ok = true;
    }
  } catch {
    ok = false;
  }
  // R4 [P2-E] — **실패는 거부 쪽으로 넘어진다.** 허용으로 되돌리는 데 실패했으면 이번 방문 표시를 거부로 되돌린다:
  //   저장소가 비어 있는 브라우저에서는 그러지 않으면 수집이 재개되는데 화면은 "이번 방문 동안 보내지 않습니다" 를 보여 준다(astra 재현 ③).
  if (!optOut && !ok) setSessionAnalyticsOptOut(true);
  deps.notify?.(ANALYTICS_OPTOUT_EVENT);
  return { ok };
}

function defaultOptOutDeps(): OptOutDeps {
  const g = globalThis as unknown as { localStorage?: WritableStorage; dispatchEvent?: (e: Event) => boolean };
  let storage: WritableStorage | undefined;
  try {
    storage = g.localStorage;
  } catch {
    storage = undefined;
  }
  return {
    localStorage: storage,
    notify: (name) => {
      if (typeof g.dispatchEvent === "function" && typeof Event === "function") g.dispatchEvent(new Event(name));
    },
  };
}

const LOCALE_PREFIX = /^\/(?:ko|en)(?=\/|$)/i;
const RELATIVE_BASE = "http://relative.invalid";

function decodeSafely(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/** 관리자 경로인가 — 로케일 접두사를 떼고 첫 세그먼트가 admin 으로 시작하면 참. 디코딩할 수 없으면 참(보내지 않는 쪽). */
function isAdminPath(pathname: string): boolean {
  const decoded = decodeSafely(pathname);
  if (decoded === null) return true;
  const path = decoded.toLowerCase().replace(LOCALE_PREFIX, "");
  return path.startsWith("/admin");
}

/**
 * 전송 직전 필터. `signals` 를 주면 거부 신호가 있을 때 null(이중 안전). 신호 없이 부르면 주소 규칙만 적용한다.
 */
export function analyticsBeforeSend<T extends { url: string }>(event: T, signals?: AnalyticsSignals): T | null {
  if (signals && analyticsRefused(signals)) return null;

  const raw = event.url;
  if (typeof raw !== "string" || raw.trim() === "") return null;

  let absolute = true;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    try {
      parsed = new URL(raw, RELATIVE_BASE);
      absolute = false;
    } catch {
      return null;
    }
  }

  if (isAdminPath(parsed.pathname)) return null;

  parsed.search = "";
  parsed.hash = "";
  const url = absolute ? parsed.toString() : parsed.pathname;
  return { ...event, url };
}

/** `<Analytics beforeSend>` 에 넘기는 함수 — 보낼 때마다 그 순간의 거부 신호를 다시 읽는다(버튼을 누른 즉시 효과). */
export function liveAnalyticsBeforeSend<T extends { url: string }>(event: T): T | null {
  return analyticsBeforeSend(event, readAnalyticsSignals());
}
