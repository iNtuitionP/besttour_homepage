import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * 0006_trip_return_check — 편도·편도(oneway_oneway)에 return_at 허용.
 *
 * 0001 의 reservations_round_trip_return_ck 는 `(trip_type = 'round') = (return_at is not null)` 로
 * 왕복에만 귀가 일시를 허용했다. 목업 wizard-b 는 편도·편도에서 두 번째 운행일을 받는다.
 * 여기서는 SQL 텍스트를 잠근다 — 실제 제약 동작은 CI db-test(로컬 스택 db reset)가 검증한다.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const UP = readFileSync(path.join(ROOT, "supabase/migrations/0006_trip_return_check.sql"), "utf8");
const DOWN = readFileSync(path.join(ROOT, "supabase/rollbacks/0006_trip_return_check.down.sql"), "utf8");

describe("0006_trip_return_check.sql", () => {
  test("기존 제약을 지우고 같은 이름으로 다시 건다 (이름 유지 — 롤백·문서 참조 안정)", () => {
    expect(UP).toMatch(/drop constraint if exists reservations_round_trip_return_ck/);
    expect(UP).toMatch(/add constraint reservations_round_trip_return_ck check/);
  });

  test("세 갈래: round 필수 · oneway_oneway 허용 · oneway 금지", () => {
    expect(UP).toMatch(/trip_type = 'round'\s+and return_at is not null/);
    expect(UP).toMatch(/trip_type = 'oneway_oneway'\)/);
    expect(UP).toMatch(/trip_type = 'oneway'\s+and return_at is null/);
  });

  test("oneway_oneway 에 return_at 을 강제하지 않는다 (허용이지 필수 아님)", () => {
    // 'oneway_oneway' 갈래에 `and return_at is not null` 이 붙어 있으면 강제가 된다 — 브리프 결정과 어긋난다
    expect(UP).not.toMatch(/trip_type = 'oneway_oneway'\s+and return_at is not null/);
  });

  test("0001 의 return_at > depart_at 컬럼 CHECK 는 건드리지 않는다 (SQL 본문 기준 — 주석 제외)", () => {
    // 주석에는 "유지된다"고 설명하려고 그 문구가 나온다. 실제 SQL 문장에만 없어야 한다.
    const sqlOnly = UP.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sqlOnly).not.toMatch(/return_at > depart_at/);
    expect(sqlOnly).not.toMatch(/drop constraint.*return_at_check/i);
    expect(sqlOnly).not.toMatch(/alter column return_at/i);
  });
});

describe("0006_trip_return_check.down.sql", () => {
  test("롤백은 migrations/ 밖에 있고 0001 원문 CHECK 로 복원한다", () => {
    expect(DOWN).toMatch(/check \(\(trip_type = 'round'\) = \(return_at is not null\)\)/);
  });

  test("좁히는 롤백이므로 위반될 행이 있으면 가드가 멈춘다 — 조용히 지우지 않는다", () => {
    expect(DOWN).toMatch(/trip_type = 'oneway_oneway' and return_at is not null/);
    expect(DOWN).toMatch(/raise exception/);
    expect(DOWN).not.toMatch(/delete from reservations/);
    expect(DOWN).not.toMatch(/update reservations set return_at/);
  });

  test("트랜잭션 안에서 실행된다", () => {
    expect(DOWN.trim().startsWith("--") || DOWN.includes("begin;")).toBe(true);
    expect(DOWN).toMatch(/\bbegin;/);
    expect(DOWN).toMatch(/\bcommit;/);
  });
});
