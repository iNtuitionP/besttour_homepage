/**
 * 네이버 프리미엄 로그 분석(wcslog.js) — 언제 불러오고 언제 보내는가 (OF3-H · 요구사항 §9).
 *
 * 처리방침(원장 PRIVACY_POLICY_REVISION.cookiesAddendum)이 고지하는 것을 이 모듈이 참으로 만든다:
 *   "관리자 화면에서는 동작하지 않으며, '방문 통계 거부'를 선택하시거나 브라우저의 추적 거부(Do Not Track·GPC) 설정을 켜시면 불러오지 않고,
 *    이미 불러온 뒤에 거부하시면 그때부터 보내지 않습니다. … 이름·전화번호 등 신청하신 내용은 네이버 주식회사에 보내지 않습니다."
 *
 * 규칙 (판정은 전부 인자로 받은 값만 본다 — vitest(node)가 그대로 돌린다. 브라우저 전역을 읽는 것은 기본 인자뿐이다):
 *   1. 게이트(naverWcsAllowed) — 아래 중 하나라도 걸리면 **스크립트를 불러오지 않는다**:
 *        · 환경변수 NEXT_PUBLIC_NAVER_WA 가 비었다(서버 레이아웃이 prop 으로 내린다 — 비면 컴포넌트가 아무것도 렌더하지 않는다)
 *        · 시행 전 — KST 오늘 < 개정 시행일(처리방침이 '자동 수집 장치' 개정을 공지한 날 뒤에야 수집을 시작한다). 비교는 lib/kst.ts isKstDateOnOrAfter —
 *          처리방침 표시·동의 버전과 같은 비교다(lib/privacy-revision.ts). 시행일 문자열은 클라이언트 번들에 원장이 들어가지 않도록 서버가 prop 으로 내린다.
 *        · 방문 통계 거부 판정(lib/analytics/before-send.ts analyticsRefused — 거부 표시·저장소 읽기 실패·이번 방문 메모리 표시·DNT·GPC) — **기존 판정 그대로 재사용**
 *        · 관리자 경로 — 관리자 레이아웃(app/admin/**)에는 애초에 두지 않지만 한 번 더 막는다
 *   2. 페이지뷰 — 컨트롤러가 경로 이동마다 **거부를 다시 읽은 뒤**에야 wcs_do() 를 부른다(리뷰 F11 — 로드 뒤 거부하면 그때부터 안 보냄).
 *      첫 호출만 `wcs_add = { wa }` → `wcs.inflow()` → `wcs_do()`, 이후는 `wcs_do()` 만. 같은 경로를 연달아 세지 않는다(개발 모드 이중 효과 포함).
 *   3. 전환 — trackNaverLead: 견적 모달의 접수 성공 한 곳에서 부른다. 호출 순간 게이트를 다시 평가하고 `wcs.trans({ type: "lead" })` 만 보낸다 —
 *      이름·전화 등 어떤 필드도 넘기지 않는다(인자 없는 함수라 넘길 길이 없다).
 * wcs 호출이 던져도 화면을 깨지 않는다(삼킨다) — 분석이 접수 완료 화면을 막으면 안 된다.
 *
 * 원장을 import 하지 않는다 — 클라이언트 컴포넌트(components/analytics/NaverWcs.tsx · QuickQuoteModal)가 쓰므로 번들에 법정 문안이 딸려 가지 않게.
 */
import { analyticsRefused, isAdminPath, readAnalyticsSignals, type AnalyticsSignals } from "./before-send";
import { isKstDateOnOrAfter } from "../kst";

/** 네이버 공통 분석 스크립트 — next/script 가 afterInteractive 로 불러온다. */
export const NAVER_WCS_SRC = "https://wcs.naver.net/wcslog.js";

/** wcslog.js 가 불러진 뒤 창에 생기는 것 중 이 모듈이 쓰는 부분(테스트가 대역을 넘긴다). */
export interface NaverWindow {
  wcs?: {
    inflow: () => void;
    trans: (payload: { type: string }) => void;
  };
  /** wcslog.js 가 만드는 전역 함수(= wcs.pageview). 이 이름 그대로 공개된다. */
  wcs_do?: () => void;
  /** 우리가 `{ wa }` 로 채운다. */
  wcs_add?: Record<string, string>;
  location?: { pathname: string };
}

/**
 * 네이버 분석 사이트 식별값(NEXT_PUBLIC_NAVER_WA) — 비었거나 없으면 undefined(= 아무것도 하지 않는다). 공백은 떼어 낸다.
 * 레이아웃이 env 를 직접 읽지 않게 여기 한 곳에서 읽는다(tests/canonical.test.ts — 레이아웃은 env 를 직접 읽지 않는다). `process.env.NEXT_PUBLIC_*` 는 빌드 때 굳는다.
 */
export function naverWaFromEnv(): string | undefined {
  const value = process.env.NEXT_PUBLIC_NAVER_WA?.trim();
  return value ? value : undefined;
}

export interface NaverGateInput {
  /** NEXT_PUBLIC_NAVER_WA — 비었거나 없으면 아무것도 하지 않는다. */
  wa: string | null | undefined;
  /** 개정 시행일(KST `YYYY-MM-DD`) — 서버가 PRIVACY_POLICY_REVISION.effectiveDate 를 내린다. */
  effectiveFrom: string;
  now: Date;
  signals: AnalyticsSignals;
  /** 있으면 관리자 경로를 막는다. */
  pathname?: string | null;
}

/** 스크립트를 불러오거나 무엇이든 보내도 되는가. */
export function naverWcsAllowed(input: NaverGateInput): boolean {
  if (typeof input.wa !== "string" || input.wa.trim() === "") return false;
  if (!isKstDateOnOrAfter(input.effectiveFrom, input.now)) return false;
  if (analyticsRefused(input.signals)) return false;
  if (input.pathname && isAdminPath(input.pathname)) return false;
  return true;
}

export interface NaverControllerDeps {
  win: NaverWindow;
  wa: string | null | undefined;
  effectiveFrom: string;
  now: () => Date;
  /** 호출하는 순간의 거부 신호 — 이전에 읽은 값을 믿지 않는다. */
  readSignals: () => AnalyticsSignals;
}

export interface NaverWcsController {
  /** 경로 이동(또는 첫 진입)마다 부른다. 실제로 wcs_do 를 불렀으면 true. */
  pageview: (pathname: string) => boolean;
}

export function createNaverWcsController(deps: NaverControllerDeps): NaverWcsController {
  let inflowDone = false;
  let lastPath: string | null = null;
  return {
    pageview(pathname) {
      if (lastPath === pathname) return false;
      // 거부를 **지금** 다시 읽는다 — 로드 뒤에 거부했으면 이 이동부터 보내지 않는다(리뷰 F11).
      if (!naverWcsAllowed({ wa: deps.wa, effectiveFrom: deps.effectiveFrom, now: deps.now(), signals: deps.readSignals(), pathname })) return false;
      const { win } = deps;
      // 스크립트가 아직 안 불러졌으면 기록하지 않는다 — 불러진 뒤 같은 경로로 다시 부르면 그때가 첫 번째다.
      if (!win.wcs || typeof win.wcs_do !== "function") return false;
      try {
        win.wcs_add = { wa: (deps.wa as string).trim() };
        if (!inflowDone) {
          win.wcs.inflow();
          inflowDone = true;
        }
        win.wcs_do();
        lastPath = pathname;
        return true;
      } catch {
        return false;
      }
    },
  };
}

export interface NaverWcsConfig {
  wa: string;
  effectiveFrom: string;
}

let config: NaverWcsConfig | null = null;

/** NaverWcs 컴포넌트가 마운트 때 설정하고 언마운트 때 null 로 되돌린다 — 설정이 없으면 전환도 보내지 않는다(환경변수 없음 · 컴포넌트 없음). */
export function configureNaverWcs(next: NaverWcsConfig | null): void {
  config = next;
}

export interface NaverLeadDeps {
  win?: NaverWindow;
  signals?: () => AnalyticsSignals;
  now?: () => Date;
  pathname?: () => string | undefined;
}

/**
 * 견적 접수 성공 전환 — `wcs.trans({ type: "lead" })` 한 번. 호출 순간 게이트(환경변수 · 시행일 · 거부 · 관리자)와 `window.wcs` 존재를 모두 다시 확인한다.
 * 보냈으면 true. 실패·검증 오류 경로에서는 부르지 않는다(호출부 한 곳 — QuickQuoteModal 의 접수 성공).
 */
export function trackNaverLead(deps: NaverLeadDeps = {}): boolean {
  if (!config) return false;
  const win = deps.win ?? (typeof window === "undefined" ? undefined : (window as unknown as NaverWindow));
  if (!win) return false;
  const pathname = deps.pathname ? deps.pathname() : win.location?.pathname;
  const allowed = naverWcsAllowed({
    wa: config.wa,
    effectiveFrom: config.effectiveFrom,
    now: (deps.now ?? (() => new Date()))(),
    signals: (deps.signals ?? (() => readAnalyticsSignals()))(),
    pathname,
  });
  if (!allowed) return false;
  if (!win.wcs || typeof win.wcs.trans !== "function") return false;
  try {
    if (!win.wcs_add?.wa) win.wcs_add = { wa: config.wa.trim() };
    win.wcs.trans({ type: "lead" });
    return true;
  } catch {
    return false;
  }
}
