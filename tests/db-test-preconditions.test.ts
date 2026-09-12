import { describe, expect, test } from "vitest";

import { dbSmokeEnv, dbWriteGate, isLocalStackUrl, loadDotEnvLocal } from "./helpers/load-env-local";

/**
 * DB 테스트 전제 — REQUIRE_DB_TESTS=1 이면 "조용한 skip" 은 실패다 (P3-3 독립 리뷰 N5, 2026-09-13).
 *
 * 다섯 파일(consent·kst-dates·outbox·purge·reservation-action.e2e)이 `describe.skipIf(!gate.allowed || !env.hasServiceRole)` 로
 * DB 실증 블록을 가둔다. 가드는 URL 과 REQUIRE_DB_TESTS 만 보고, 서비스 롤 키 부재는 skipIf 의 두 번째 조건이 **조용히** 삼킨다.
 * CI db-test 잡에서 status export 한 줄이 빠지면 다섯 블록이 전부 skip 인 채 green 이 된다 — P2-1 때 anon 키로 실제 일어났던 일이다.
 * 이 파일은 그 잡에서만(REQUIRE_DB_TESTS=1) 켜져 "접속 정보가 전부 있고 가드가 열렸다" 를 단언한다. tests/home.test.ts:278 의 anon 선례와 같은 취지.
 * 로컬(.env.local 이 원격을 가리킴)에서는 첫 테스트가 skip 이다 — 그것이 정답이다(원격에는 쓰지 않는다).
 */
loadDotEnvLocal();
const required = process.env.REQUIRE_DB_TESTS === "1";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

describe("DB 테스트 전제 (REQUIRE_DB_TESTS=1 일 때만)", () => {
  test.skipIf(!required)("접속 정보가 전부 있고 dbWriteGate 가 열려 있다 — 하나라도 비면 skip 이 아니라 실패", () => {
    expect(isLocalStackUrl(url), `NEXT_PUBLIC_SUPABASE_URL 이 로컬 스택이 아니다: ${url ?? "(없음)"}`).toBe(true);
    const env = dbSmokeEnv();
    expect(env.hasServiceRole, "SUPABASE_SERVICE_ROLE_KEY 가 비어 있다 — db-test 의 status export 를 확인").toBe(true);
    expect(Boolean(env.anonKey), "NEXT_PUBLIC_SUPABASE_ANON_KEY 가 비어 있다 — db-test 의 status export 를 확인").toBe(true);
    const gate = dbWriteGate();
    expect(gate.allowed, gate.reason).toBe(true);
  });
});

describe("dbWriteGate — 순수 판정", () => {
  test("로컬 URL + REQUIRE_DB_TESTS=1 → 열림", () => {
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", REQUIRE_DB_TESTS: "1" }).allowed).toBe(true);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", REQUIRE_DB_TESTS: "1" }).allowed).toBe(true);
  });

  test("원격 URL 은 REQUIRE_DB_TESTS=1 이어도 닫힘 · 로컬이어도 플래그 없으면 닫힘 · URL 없음도 닫힘", () => {
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", REQUIRE_DB_TESTS: "1" }).allowed).toBe(false);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }).allowed).toBe(false);
    expect(dbWriteGate({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", REQUIRE_DB_TESTS: "true" }).allowed).toBe(false);
    expect(dbWriteGate({ REQUIRE_DB_TESTS: "1" }).allowed).toBe(false);
  });

  test("닫힌 이유가 항상 문자열로 온다 (skip 로그가 이유를 찍는다)", () => {
    for (const env of [
      { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", REQUIRE_DB_TESTS: "1" },
      { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
    ]) {
      const gate = dbWriteGate(env);
      expect(gate.allowed).toBe(false);
      expect(gate.reason.length).toBeGreaterThan(10);
    }
  });
});
