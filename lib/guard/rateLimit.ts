/**
 * Upstash sliding window rate limit (P3-1 순서 5 — 검증된 사람만 슬롯을 소비한다).
 *
 * 한도: 사람 기준 넉넉하게, 봇 기준 의미 있게 — known(IP 있음) 10분 5건 · 1시간 15건, unknown(IP 없음) 각각 절반.
 * 창은 short(10분) → long(1시간) 순서로 본다. short 가 막으면 long 은 호출하지 않는다 — 막힌 요청은 시간당 카운트를 소비하지 않는다.
 *
 * fail-closed: limit() 이 throw 하거나 timeoutMs 안에 답이 없으면 infra.
 * 주의 — @upstash/ratelimit 의 자체 `timeout` 옵션은 fail-open 이다("allow requests in case of network problems"):
 * 타임아웃 시 success:true 에 reason:"timeout" 을 돌려준다. 여기서 reason 을 보고 infra 로 뒤집는다.
 * 우회 스위치는 없다.
 */
import type { GuardResult, IpBucket, RateLimitDeps, RateLimitResponseLike, RateWindow } from "./types";

/** 창 이름 → Upstash Duration 문자열. */
export type RateWindowDuration = "10 m" | "1 h";

export const RATE_LIMITS = {
  known: {
    short: { max: 5, window: "10 m" },
    long: { max: 15, window: "1 h" },
  },
  unknown: {
    short: { max: 2, window: "10 m" },
    long: { max: 7, window: "1 h" },
  },
} as const satisfies Record<IpBucket, Record<RateWindow, { max: number; window: RateWindowDuration }>>;

export const RATE_LIMIT_TIMEOUT_MS = 5_000;
export const RATE_WINDOWS: readonly RateWindow[] = ["short", "long"];

class RateLimitTimeout extends Error {
  constructor() {
    super("rate limit timeout");
    this.name = "RateLimitTimeout";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RateLimitTimeout()), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const infra = (detail: Record<string, unknown>): GuardResult => ({ ok: false, reason: "infra", detail });

/** key 는 ipKey.ts 의 해시(IP 원문 아님). detail 에 key 를 넣지 않는다. */
export async function checkRateLimit(key: string, bucket: IpBucket, deps: RateLimitDeps): Promise<GuardResult> {
  for (const window of RATE_WINDOWS) {
    let res: RateLimitResponseLike;
    try {
      res = await withTimeout(deps.limiters[bucket][window].limit(key), deps.timeoutMs);
    } catch (err) {
      if (err instanceof RateLimitTimeout) return infra({ code: "timeout", window });
      return infra({ code: "network", window, name: err instanceof Error ? err.name : typeof err });
    }
    if (res.reason === "timeout") return infra({ code: "upstream-timeout", window });
    if (!res.success) {
      return { ok: false, reason: "ratelimit", detail: { window, resetAt: typeof res.reset === "number" ? res.reset : null } };
    }
  }
  return { ok: true };
}
