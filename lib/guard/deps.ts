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

const limiterCache = new Map<string, RateLimiterSet>();

function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

function makeLimiter(redis: Redis, bucket: IpBucket, window: RateWindow): Ratelimit {
  const cfg = RATE_LIMITS[bucket][window];
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.max, cfg.window),
    prefix: `guard:reserve:${bucket}:${window}`,
    analytics: false,
    // Upstash 자체 timeout 은 fail-open(reason:"timeout" 으로 success:true) — checkRateLimit 이 그 reason 을 infra 로 뒤집는다.
    timeout: RATE_LIMIT_TIMEOUT_MS,
  });
}

function limitersFor(url: string, token: string): RateLimiterSet {
  const cacheKey = `${url}\n${token}`;
  const hit = limiterCache.get(cacheKey);
  if (hit) return hit;
  const redis = new Redis({ url, token });
  const set: RateLimiterSet = {
    known: { short: makeLimiter(redis, "known", "short"), long: makeLimiter(redis, "known", "long") },
    unknown: { short: makeLimiter(redis, "unknown", "short"), long: makeLimiter(redis, "unknown", "long") },
  };
  limiterCache.set(cacheKey, set);
  return set;
}

export function defaultGuardDeps(): GuardDeps {
  const secret = process.env.GUARD_SECRET ?? "";
  if (secret.length < GUARD_SECRET_MIN_LENGTH) {
    throw new Error(`defaultGuardDeps: GUARD_SECRET 이 없거나 ${GUARD_SECRET_MIN_LENGTH}자 미만이다`);
  }

  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY ?? "";
  if (turnstileSecret.length === 0) throw new Error("defaultGuardDeps: TURNSTILE_SECRET_KEY 가 설정되지 않았다");
  if (process.env.VERCEL_ENV === "production" && DUMMY_TURNSTILE_SECRET.test(turnstileSecret)) {
    throw new Error("defaultGuardDeps: 운영 환경에 Cloudflare 테스트용 TURNSTILE_SECRET_KEY 가 들어 있다 — 실키로 교체해야 한다");
  }

  const allowedHosts = parseAllowedHosts(process.env.GUARD_ALLOWED_HOSTS);
  if (allowedHosts.length === 0) throw new Error("defaultGuardDeps: GUARD_ALLOWED_HOSTS 가 비어 있다 (쉼표 구분 호스트 목록)");

  const url = process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (url.length === 0) throw new Error("defaultGuardDeps: UPSTASH_REDIS_REST_URL 이 설정되지 않았다");
  if (token.length === 0) throw new Error("defaultGuardDeps: UPSTASH_REDIS_REST_TOKEN 이 설정되지 않았다");

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
      limiters: limitersFor(url, token),
      timeoutMs: RATE_LIMIT_TIMEOUT_MS,
    },
  };
}
