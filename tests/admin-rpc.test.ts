/**
 * 가드 거부 판정의 경계 (P5-16 · GPT astra P2 · lib/admin/adminRpc.ts).
 *
 * 42501 은 두 경로에서 온다 — definer 함수의 `is_admin()` 가드가 막은 것(→ "바뀐 행 0" 으로 삼킨다)과
 * EXECUTE 가 없어 함수가 아예 돌지 않은 것(→ 배포 사고, 던진다). 둘은 문구로만 갈린다.
 * 처음 판은 문구가 **포함**되기만 하면 가드 거부로 봤다. 그러면 가드 문구를 품은 다른 42501 이
 * 조용히 "행이 없다" 로 바뀐다. 이제 **부른 함수 이름까지 한 글자도 같을 때만** 가드 거부다.
 */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ADMIN_GUARD_MESSAGE, isAdminGuardDenial } from "@/lib/admin/adminRpc";

const guard = (fn: string) => ({ code: "42501", message: `${fn}: ${ADMIN_GUARD_MESSAGE}` });

describe("isAdminGuardDenial — 부른 함수의 가드 문구와 정확히 같을 때만", () => {
  test("부른 함수의 가드 문구 그대로 → 가드 거부", () => {
    expect(isAdminGuardDenial(guard("admin_update_notice"), "admin_update_notice")).toBe(true);
  });

  test("다른 함수의 가드 문구 → 가드 거부가 아니다(던져야 한다)", () => {
    expect(isAdminGuardDenial(guard("admin_delete_popup"), "admin_update_notice")).toBe(false);
  });

  test("가드 문구를 품었지만 앞뒤에 다른 글자가 붙은 42501 → 가드 거부가 아니다", () => {
    const wrapped = { code: "42501", message: `permission denied: admin_update_notice: ${ADMIN_GUARD_MESSAGE} (retry)` };
    expect(isAdminGuardDenial(wrapped, "admin_update_notice")).toBe(false);
  });

  test("EXECUTE 거부(같은 42501, 다른 문구) → 가드 거부가 아니다", () => {
    const exec = { code: "42501", message: "permission denied for function admin_update_notice" };
    expect(isAdminGuardDenial(exec, "admin_update_notice")).toBe(false);
  });

  test("문구는 같아도 코드가 42501 이 아니면 → 가드 거부가 아니다", () => {
    const other = { code: "P0001", message: `admin_update_notice: ${ADMIN_GUARD_MESSAGE}` };
    expect(isAdminGuardDenial(other, "admin_update_notice")).toBe(false);
  });

  test("오류가 없으면 → false", () => {
    expect(isAdminGuardDenial(null, "admin_update_notice")).toBe(false);
    expect(isAdminGuardDenial(undefined, "admin_update_notice")).toBe(false);
  });
});
