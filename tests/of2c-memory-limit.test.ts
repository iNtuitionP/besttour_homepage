/**
 * OF2-C — 방문 통계 비콘의 한도는 프로세스 메모리 안에서만 센다(해외 서버 Upstash 를 부르지 않는다).
 * 처리방침 siteStats 문단은 "국내 데이터베이스에만 저장"이라고 적었다 — 방문자마다 해외로 나가는 호출이 있으면 그 문장이 거짓이 된다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { createMemoryLimiter } from "@/lib/stats/memoryLimit";

import { stripComments } from "./helpers/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const code = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), "utf8"), rel);

describe("메모리 한도", () => {
  test("창 안에서 max 를 넘으면 ratelimit, 창이 지나면 다시 통과한다", async () => {
    let now = 0;
    const lim = createMemoryLimiter({ known: { max: 2, windowMs: 1000 }, unknown: { max: 1, windowMs: 1000 } }, () => now);
    expect((await lim("k", "known")).ok).toBe(true);
    expect((await lim("k", "known")).ok).toBe(true);
    const third = await lim("k", "known");
    expect(third.ok).toBe(false);
    expect(!third.ok && third.reason).toBe("ratelimit");
    now = 1001;
    expect((await lim("k", "known")).ok).toBe(true);
  });

  test("키마다 따로 센다 · unknown 버킷은 더 낮은 한도", async () => {
    const lim = createMemoryLimiter({ known: { max: 2, windowMs: 1000 }, unknown: { max: 1, windowMs: 1000 } }, () => 0);
    expect((await lim("a", "unknown")).ok).toBe(true);
    expect((await lim("a", "unknown")).ok).toBe(false);
    expect((await lim("b", "unknown")).ok).toBe(true);
  });

  test("저장 키가 무한히 늘지 않는다(오래된 키를 비운다)", async () => {
    let now = 0;
    const lim = createMemoryLimiter({ known: { max: 1, windowMs: 10 }, unknown: { max: 1, windowMs: 10 } }, () => now, 50);
    for (let i = 0; i < 200; i++) {
      now += 20;
      await lim(`k${i}`, "known");
    }
    expect(lim.size()).toBeLessThanOrEqual(50);
  });
});

describe("방문 통계 경로는 Upstash·가드 한도를 쓰지 않는다", () => {
  test("라우트·핸들러가 guard/rateLimit·statsGuardDeps·upstash 를 import 하지 않는다", () => {
    for (const rel of ["app/api/stats/view/route.ts", "lib/stats/handler.ts", "lib/stats/memoryLimit.ts"]) {
      const src = code(rel);
      expect(src, rel).not.toMatch(/@upstash|statsGuardDeps|limitersFor|checkRateLimit|guard\/rateLimit/);
    }
  });

  test("guard 쪽에 stats 범위가 남아 있지 않다", () => {
    expect(code("lib/guard/deps.ts")).not.toMatch(/statsGuardDeps|"stats"/);
    expect(code("lib/guard/rateLimit.ts")).not.toMatch(/STATS_RATE_LIMITS/);
  });
});
