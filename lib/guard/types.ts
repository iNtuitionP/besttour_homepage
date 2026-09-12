/**
 * 공개 뮤테이션 방어 4종의 공용 타입 (플랜 v4 P3-1 · CLAUDE.md §3).
 *
 * CLAUDE.md §3: "공개 뮤테이션은 반드시 zod 검증 + Upstash RateLimit + Cloudflare Turnstile + 허니팟 전부 통과 후 처리한다."
 * 이 디렉터리는 lib 순수 모듈이다 — 서버 액션 지시어 없음, DB 없음. 네트워크·시계는 전부 deps 로 주입받고,
 * 환경변수는 deps.ts(defaultGuardDeps, server-only) 한 곳에서만 읽는다.
 */
import type { ReservationInput } from "../types";

/**
 * 거부 사유.
 *   validation — zod 실패(형식 위반)
 *   bot        — 허니팟·타임트랩(사람이 낼 수 없는 신호)
 *   turnstile  — Cloudflare 가 사람임을 확인해 주지 않음
 *   ratelimit  — 검증된 사람이지만 한도 초과
 *   infra      — Turnstile·Upstash 네트워크 오류·타임아웃. fail-closed: 방어가 꺼진 채 접수받지 않는다
 */
export type GuardReason = "validation" | "bot" | "turnstile" | "ratelimit" | "infra";

export type GuardFailure = {
  ok: false;
  reason: GuardReason;
  /** 진단용 소량 데이터(코드·에러코드·창 이름). IP·secret·입력값을 넣지 않는다. */
  detail?: unknown;
  /** true 면 호출자는 실패를 알리지 않고 가짜 성공을 돌려준다(허니팟). */
  silent?: boolean;
};

export type GuardResult = { ok: true } | GuardFailure;

/** Next `headers()`(ReadonlyHeaders)·표준 Headers 둘 다 만족하는 최소 형태. */
export interface HeadersLike {
  get(name: string): string | null;
}

export type IpBucket = "known" | "unknown";
export type RateWindow = "short" | "long";

/** `@upstash/ratelimit` Ratelimit 인스턴스가 만족하는 최소 형태 — 테스트는 이 형태의 mock 을 주입한다. */
export interface RateLimiterLike {
  limit(identifier: string): Promise<RateLimitResponseLike>;
}

export interface RateLimitResponseLike {
  success: boolean;
  /** Upstash: "timeout"(fail-open 응답) · "cacheBlock" · "denyList". timeout 은 infra 로 뒤집는다. */
  reason?: string;
  limit?: number;
  remaining?: number;
  /** 창이 리셋되는 epoch ms. */
  reset?: number;
  pending?: Promise<unknown>;
}

/** 버킷(known/unknown) × 창(10분/1시간) = Ratelimit 인스턴스 4개. */
export type RateLimiterSet = Record<IpBucket, Record<RateWindow, RateLimiterLike>>;

/** `globalThis.fetch` 가 그대로 들어간다. 테스트는 mock 을 준다. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TurnstileDeps {
  fetch: FetchLike;
  /** TURNSTILE_SECRET_KEY. */
  secret: string;
  /** siteverify 응답 hostname 허용 목록(소문자). GUARD_ALLOWED_HOSTS. */
  allowedHosts: readonly string[];
  /** 위젯 data-action 과 비교할 값. 운영은 항상 TURNSTILE_ACTION('reserve'). null 은 비교 생략 — Cloudflare 더미 키 응답에 action 이 없어 라이브 스모크에서만 쓴다. */
  action: string | null;
  timeoutMs: number;
}

export interface RateLimitDeps {
  limiters: RateLimiterSet;
  /** limit() 한 번의 상한(ms). 넘기면 infra. */
  timeoutMs: number;
}

export interface GuardDeps {
  now: () => Date;
  /** GUARD_SECRET — 타임트랩 HMAC 과 IP 키 해시에 쓴다. */
  secret: string;
  turnstile: TurnstileDeps;
  rateLimit: RateLimitDeps;
}

export interface GuardContext {
  headers: HeadersLike;
  /** issueFormToken 이 폼 렌더 시 내려준 서명 토큰. 없으면 bot. */
  formToken: string | null | undefined;
  /** Turnstile 위젯이 준 토큰. 없으면 네트워크 없이 turnstile 거부. */
  turnstileToken: string | null | undefined;
  /** 숨은 필드들(`website` 등). 하나라도 채워지면 조용한 성공. */
  honeypot: Record<string, unknown>;
}

/**
 * runGuards 결과.
 *   ok·silent:false — 전부 통과. `input` 은 zod 가 파싱한 ReservationInput(기본값 적용). 호출자가 저장한다.
 *   ok·silent:true  — 허니팟. `input` 이 없다 — 저장할 것이 없다. 호출자는 가짜 성공을 돌려준다.
 *   ok:false        — 거부. reason 별 사용자 메시지는 호출자(UI) 몫.
 */
export type GuardOutcome = { ok: true; silent: false; input: ReservationInput } | { ok: true; silent: true } | GuardFailure;
