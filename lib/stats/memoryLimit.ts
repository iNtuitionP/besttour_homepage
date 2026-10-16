/**
 * 방문 통계 비콘의 한도 — 프로세스 메모리 안에서만 센다(OF2-C).
 *
 * 왜 Upstash 를 쓰지 않나: 방문자마다 해외(도쿄) 서버로 키를 보내게 되면 처리방침 siteStats 문단의 "국내 데이터베이스에만 저장"과
 * 해외이전 고지가 어긋난다. 이 한도는 봇의 폭주(통계 부풀리기·DB 쓰기 폭주)만 막으면 되므로 서버리스 인스턴스별 메모리 계수로 충분하다.
 * 인스턴스가 여럿이면 한도는 인스턴스마다 따로 적용된다 — 느슨해질 뿐 막혀서 생기는 피해는 없다. 키는 호출자가 이미 해시한 값이다(IP 원문 아님).
 */
import type { GuardResult, IpBucket } from "@/lib/guard/types";

export type MemoryLimits = Record<IpBucket, { max: number; windowMs: number }>;

export const STATS_MEMORY_LIMITS: MemoryLimits = {
  known: { max: 60, windowMs: 10 * 60_000 },
  unknown: { max: 20, windowMs: 10 * 60_000 },
};

export type MemoryLimiter = ((key: string, bucket: IpBucket) => Promise<GuardResult>) & { size: () => number };

export function createMemoryLimiter(limits: MemoryLimits, now: () => number = Date.now, maxKeys = 5000): MemoryLimiter {
  const hits = new Map<string, number[]>();

  const prune = (t: number) => {
    if (hits.size <= maxKeys) return;
    const longest = Math.max(limits.known.windowMs, limits.unknown.windowMs);
    for (const [k, list] of hits) {
      if (list.length === 0 || t - list[list.length - 1] > longest) hits.delete(k);
    }
    // 그래도 넘치면 가장 오래전에 들어온 키부터 비운다(Map 은 삽입 순서를 지킨다).
    for (const k of hits.keys()) {
      if (hits.size <= maxKeys) break;
      hits.delete(k);
    }
  };

  const fn = async (key: string, bucket: IpBucket): Promise<GuardResult> => {
    const t = now();
    const { max, windowMs } = limits[bucket];
    const id = `${bucket}:${key}`;
    const recent = (hits.get(id) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) {
      hits.set(id, recent);
      return { ok: false, reason: "ratelimit", detail: { window: "memory" } };
    }
    recent.push(t);
    hits.set(id, recent);
    prune(t);
    return { ok: true };
  };

  return Object.assign(fn, { size: () => hits.size });
}
