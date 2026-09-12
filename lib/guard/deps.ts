/**
 * 운영 deps — process.env 를 읽는 유일한 곳 (P3-1). 서버 전용.
 *
 * `server-only` 를 import 해 클라이언트 번들에 섞이면 빌드가 깨지게 한다(lib/supabase/server.ts 선례).
 * ./index.ts 는 이 파일을 re-export 하지 않는다 — 순수 모듈은 어디서든 import 할 수 있어야 하고, 이 파일은 서버 액션(P3-3)만 부른다.
 *
 * 원칙
 *   - 빠진 설정은 throw 다. 잘못된 기본값으로 조용히 돌지 않는다(fail-closed). 호출자(서버 액션)는 이 throw 를 infra 로 다룬다.
 *   - 우회 스위치 없음. 여기서 읽는 env 는 tests/guard.test.ts 가 허용 목록으로 잠근다.
 *   - 운영(VERCEL_ENV=production)에서 Cloudflare 더미 secret(1x/2x/3x…AA)은 거부한다 — 더미 통과키가 운영에 남으면 모든 봇이 통과한다.
 *     프리뷰·개발은 더미 키를 허용한다(위젯 테스트용 — 문서 공개 키).
 *   - Ratelimit 인스턴스는 접속정보별로 모듈 스코프에 캐시한다(Upstash 권장 — ephemeral cache 가 호출 간 유지된다).
 */
import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { RATE_LIMITS, RATE_LIMIT_TIMEOUT_MS } from "./rateLimit";
import { TURNSTILE_ACTION, TURNSTILE_TIMEOUT_MS } from "./turnstile";
import type { GuardDeps, IpBucket, RateLimiterSet, RateWindow } from "./types";

/** HMAC 키·해시 salt 로 쓰이므로 최소 32자(예: `openssl rand -hex 32` = 64자). */
export const GUARD_SECRET_MIN_LENGTH = 32;

/** Cloudflare 문서의 테스트용 secret 3종(항상 통과·항상 실패·token already spent). */
const DUMMY_TURNSTILE_SECRET = /^[123]x0{31}AA$/;

/**
 * rate limit 카운터의 이름공간 (P6-3a). reserve = 접수(P3-3 runGuards) · check = 예약확인(lib/reservation-check/guards.ts).
 * Redis 키 prefix 가 갈리므로 예약확인 시도가 접수 한도를 먹지 않고, 접수가 예약확인 한도를 먹지 않는다. 한도 수치(RATE_LIMITS)는 같다.
 */
export type RateLimitScope = "reserve" | "check";

const redisCache = new Map<string, Redis>();
const limiterCache = new Map<string, RateLimiterSet>();

function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

/** Redis 키 prefix — `guard:<scope>:<bucket>:<window>`. 접수는 P3-1 이래 `guard:reserve:*` 그대로다(카운터가 옮겨가지 않는다). */
export function rateLimitPrefix(scope: RateLimitScope, bucket: IpBucket, window: RateWindow): string {
  return `guard:${scope}:${bucket}:${window}`;
}

function makeLimiter(redis: Redis, scope: RateLimitScope, bucket: IpBucket, window: RateWindow): Ratelimit {
  const cfg = RATE_LIMITS[bucket][window];
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.max, cfg.window),
    prefix: rateLimitPrefix(scope, bucket, window),
    analytics: false,
    // Upstash 자체 timeout 은 fail-open(reason:"timeout" 으로 success:true) — checkRateLimit 이 그 reason 을 infra 로 뒤집는다.
    timeout: RATE_LIMIT_TIMEOUT_MS,
  });
}

function redisFor(url: string, token: string): Redis {
  const key = `${url}\n${token}`;
  const hit = redisCache.get(key);
  if (hit) return hit;
  const redis = new Redis({ url, token });
  redisCache.set(key, redis);
  return redis;
}

/** 접속정보 × scope 별로 Ratelimit 4개(known/unknown × short/long)를 만들고 모듈 스코프에 캐시한다. Redis 클라이언트는 접속정보별 하나를 공유한다. */
export function limitersFor(url: string, token: string, scope: RateLimitScope): RateLimiterSet {
  const cacheKey = `${scope}\n${url}\n${token}`;
  const hit = limiterCache.get(cacheKey);
  if (hit) return hit;
  const redis = redisFor(url, token);
  const set: RateLimiterSet = {
    known: { short: makeLimiter(redis, scope, "known", "short"), long: makeLimiter(redis, scope, "known", "long") },
    unknown: { short: makeLimiter(redis, scope, "unknown", "short"), long: makeLimiter(redis, scope, "unknown", "long") },
  };
  limiterCache.set(cacheKey, set);
  return set;
}

function upstashEnv(caller: string): { url: string; token: string } {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (url.length === 0) throw new Error(`${caller}: UPSTASH_REDIS_REST_URL 이 설정되지 않았다`);
  if (token.length === 0) throw new Error(`${caller}: UPSTASH_REDIS_REST_TOKEN 이 설정되지 않았다`);
  return { url, token };
}

/**
 * 폼 토큰(타임트랩) 서명용 시크릿만 필요할 때 — 렌더(P3-4 /quote 서버 컴포넌트)가 부른다.
 * defaultGuardDeps 와 달리 Turnstile·Upstash·허용 호스트 env 를 요구하지 않는다 — 렌더는 토큰만 만들면 되고,
 * 그 env 들은 제출(서버액션)에서 검사된다. 없거나 짧으면 throw(fail-closed) — 호출자는 잡아서 formToken:null 로 내리고
 * 제출을 닫는다(페이지가 500 이 되지 않게). defaultGuardDeps 도 같은 검사를 이 함수로 한다(동작 동일).
 */
export function guardSecret(): string {
  const secret = process.env.GUARD_SECRET ?? "";
  if (secret.length < GUARD_SECRET_MIN_LENGTH) {
    throw new Error(`guardSecret: GUARD_SECRET 이 없거나 ${GUARD_SECRET_MIN_LENGTH}자 미만이다`);
  }
  return secret;
}

export function defaultGuardDeps(): GuardDeps {
  const secret = guardSecret();

  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY ?? "";
  if (turnstileSecret.length === 0) throw new Error("defaultGuardDeps: TURNSTILE_SECRET_KEY 가 설정되지 않았다");
  if (process.env.VERCEL_ENV === "production" && DUMMY_TURNSTILE_SECRET.test(turnstileSecret)) {
    throw new Error("defaultGuardDeps: 운영 환경에 Cloudflare 테스트용 TURNSTILE_SECRET_KEY 가 들어 있다 — 실키로 교체해야 한다");
  }

  const allowedHosts = parseAllowedHosts(process.env.GUARD_ALLOWED_HOSTS);
  if (allowedHosts.length === 0) throw new Error("defaultGuardDeps: GUARD_ALLOWED_HOSTS 가 비어 있다 (쉼표 구분 호스트 목록)");

  const { url, token } = upstashEnv("defaultGuardDeps");

  return {
    now: () => new Date(),
    secret,
    turnstile: {
      fetch: (input, init) => globalThis.fetch(input, init),
      secret: turnstileSecret,
      allowedHosts,
      action: TURNSTILE_ACTION,
      timeoutMs: TURNSTILE_TIMEOUT_MS,
    },
    rateLimit: {
      limiters: limitersFor(url, token, "reserve"),
      timeoutMs: RATE_LIMIT_TIMEOUT_MS,
    },
  };
}

/** 예약확인 조각 가드(lib/reservation-check/guards.ts runCheckGuards)가 받는 deps — Turnstile·타임트랩이 없다. */
export type CheckGuardDeps = Pick<GuardDeps, "now" | "secret" | "rateLimit">;

/**
 * 예약확인(P6-3a) 전용 deps — GUARD_SECRET + Upstash 2종만 요구한다. Turnstile secret·허용 호스트는 읽지 않는다(예약확인은 Turnstile 을 쓰지 않는다 — 컨트롤러 결정).
 * GUARD_SECRET 이 필요한 이유: rate limit 키는 sha256(secret + IP) 다(ipKey.ts) — secret 없는 해시는 IPv4 전 공간을 역산할 수 있어 hashIpKey 가 throw 한다.
 * 빠진 설정은 throw(fail-closed) — 호출자(actions/reservation-check.ts)는 infra 로 다룬다. limiter prefix 는 `guard:check:*` 로 접수(`guard:reserve:*`)와 분리된다.
 */
export function checkGuardDeps(): CheckGuardDeps {
  const secret = guardSecret();
  const { url, token } = upstashEnv("checkGuardDeps");
  return {
    now: () => new Date(),
    secret,
    rateLimit: {
      limiters: limitersFor(url, token, "check"),
      timeoutMs: RATE_LIMIT_TIMEOUT_MS,
    },
  };
}
