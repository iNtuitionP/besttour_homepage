/**
 * P5-22 수정 라운드 — 로컬 스택의 일시적 끊김에 대한 정리 재시도(tests/helpers/transient.ts) 계약.
 *
 * 전량 실행에서 tests/withdrawal-consent.test.ts §4 의 afterAll 정리(REST DELETE)가 `TypeError: fetch failed`
 * (cause `SocketError: other side closed` · UND_ERR_SOCKET)로 두 번 던졌다(구현자 전량 1회 · 리뷰어 전량 1회). 그때마다 통지 잠금이 새서
 * 다른 10파일이 420초를 기다리다 실패했다 — 잠금 누수는 db-lock 의 aroundAll(finally)이 막고(tests/db-lock.test.ts §4),
 * 정리 자체는 **다시 해도 같은 결과인 호출**(DELETE · GET)만 몇 번 더 해서 살린다. 네트워크도 DB 도 쓰지 않는다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { isTransientNetworkError, isTransientStatus, retryTransient } from "./helpers/transient";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");

/** undici 가 던지는 모양 그대로 — TypeError("fetch failed") + cause. */
function fetchFailed(cause: { code?: string; message?: string }): TypeError {
  const e = new TypeError("fetch failed");
  Object.defineProperty(e, "cause", { value: Object.assign(new Error(cause.message ?? "x"), cause) });
  return e;
}

describe("1. 일시적 끊김 판정", () => {
  test("🔴 소켓 끊김(other side closed · UND_ERR_SOCKET) · 연결 거부 · 리셋은 다시 해 볼 만하다", () => {
    expect(isTransientNetworkError(fetchFailed({ code: "UND_ERR_SOCKET", message: "other side closed" }))).toBe(true);
    expect(isTransientNetworkError(fetchFailed({ message: "other side closed" }))).toBe(true);
    expect(isTransientNetworkError(fetchFailed({ code: "ECONNRESET" }))).toBe(true);
    expect(isTransientNetworkError(fetchFailed({ code: "ECONNREFUSED" }))).toBe(true);
  });

  test("그 밖은 아니다 — 주소 오류 · 다른 종류의 오류 · 단언 실패(재시도로 덮지 않는다)", () => {
    expect(isTransientNetworkError(fetchFailed({ code: "ENOTFOUND" }))).toBe(false);
    expect(isTransientNetworkError(new TypeError("x is not a function"))).toBe(false);
    expect(isTransientNetworkError(new Error("fetch failed"))).toBe(false);
    expect(isTransientNetworkError("fetch failed")).toBe(false);
  });

  test("게이트웨이 일시 오류(502 · 503 · 504)만 다시 해 볼 만한 응답이다", () => {
    for (const s of [502, 503, 504]) expect(isTransientStatus(s), String(s)).toBe(true);
    for (const s of [200, 204, 400, 401, 404, 409, 500]) expect(isTransientStatus(s), String(s)).toBe(false);
  });
});

describe("2. 재시도 — 처음 한 번 + 두 번 더 · 사이 300ms · 600ms", () => {
  const recorder = () => {
    const waits: number[] = [];
    return { waits, sleep: async (ms: number) => void waits.push(ms) };
  };

  test("🔴 두 번 끊겨도 세 번째에 되면 그 값 · 기다린 간격은 300 · 600", async () => {
    const r = recorder();
    let calls = 0;
    const value = await retryTransient(
      async () => {
        calls++;
        if (calls < 3) throw fetchFailed({ code: "UND_ERR_SOCKET", message: "other side closed" });
        return "ok";
      },
      { sleep: r.sleep },
    );
    expect(value).toBe("ok");
    expect(calls).toBe(3);
    expect(r.waits).toEqual([300, 600]);
  });

  test("세 번 모두 끊기면 마지막 오류를 그대로 던진다 · 일시적이 아닌 오류는 곧바로 던진다", async () => {
    const r = recorder();
    let calls = 0;
    await expect(
      retryTransient(
        async () => {
          calls++;
          throw fetchFailed({ code: "UND_ERR_SOCKET", message: "other side closed" });
        },
        { sleep: r.sleep },
      ),
    ).rejects.toThrow(/fetch failed/);
    expect(calls).toBe(3);
    let once = 0;
    await expect(
      retryTransient(
        async () => {
          once++;
          throw new Error("assertion-like failure");
        },
        { sleep: r.sleep },
      ),
    ).rejects.toThrow(/assertion-like/);
    expect(once).toBe(1);
  });

  test("응답으로 판정 — 502 면 다시 · 되면 그 응답 · 끝내 502 면 마지막 응답을 돌려준다(던지지 않는다 — 단언이 본다)", async () => {
    const r = recorder();
    const seq = [502, 200];
    const got = await retryTransient(async () => ({ status: seq.shift() ?? 0 }), { sleep: r.sleep, retryResult: (v) => isTransientStatus(v.status) });
    expect(got.status).toBe(200);
    const always = await retryTransient(async () => ({ status: 503 }), { sleep: r.sleep, retryResult: (v) => isTransientStatus(v.status) });
    expect(always.status).toBe(503);
  });
});

describe("3. 쓰는 곳 — withdrawal-consent §4 의 정리(DELETE · GET)는 재시도를 거친다 · 삽입(POST)은 거치지 않는다", () => {
  test("🔴 정적 — afterEach·afterAll 의 정리는 cleanup(= retryTransient + 502/503/504) · 삽입은 그대로 rest", () => {
    const src = stripComments(readFileSync(path.join(ROOT, "tests/withdrawal-consent.test.ts"), "utf8").replace(/\r\n/g, "\n"), "withdrawal-consent.test.ts");
    expect(src).toMatch(/const cleanup = \(method: "DELETE" \| "GET", q: string\) => retryTransient\(\(\) => rest\(method, q\), \{ retryResult: \(r\) => isTransientStatus\(r\.status\) \}\);/);
    const afterEachBody = /afterEach\(async \(\) => \{([\s\S]*?)\n {2}\}\);/.exec(src)?.[1] ?? "";
    expect(afterEachBody).toMatch(/await cleanup\("DELETE", /);
    const afterAllBody = /afterAll\(async \(\) => \{([\s\S]*?)\n {2}\}\);/.exec(src)?.[1] ?? "";
    expect(afterAllBody).toMatch(/await cleanup\("DELETE", /);
    expect(afterAllBody).toMatch(/await cleanup\("GET", /);
    expect(afterAllBody).not.toMatch(/await rest\(/);
    // 삽입은 재시도하지 않는다(두 번 하면 뜻이 바뀐다)
    expect(src).toMatch(/const res = await rest\("POST", "\/reservations", r, "return=representation"\);/);
  });
});
