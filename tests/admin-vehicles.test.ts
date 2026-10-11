/**
 * 차량 관리 (OWNER-FEEDBACK T4-1 · 사장님 요청 15 · 결정 9·11 · 마이그레이션 0024).
 *
 *   1. 순수 입력 검증(lib/admin/vehicleInput.ts) — 사진 경로는 0024 CHECK 와 같은 두 형식만 · 영문 설명 칸 없음 · 정원 1~60.
 *   2. 소스 규약 — 마이그레이션의 revoke/grant(service_role 포함) · 자기검증 · 롤백 · 서버액션 첫 문장 requireAdmin ·
 *      공개 화면이 코드에 차종별 사진·문구를 두지 않는다.
 *   3. DB 실증(로컬 스택 + REQUIRE_DB_TESTS=1) — 만들기·고치기·순서·숨기기·지우기, 접수 기록이 있으면 'locked'·'referenced',
 *      명단 밖 세션은 가드, anon 은 EXECUTE 거부. 임시 차량을 만들고 지우므로 `withVehiclesLock()` 안에서 돈다(CLAUDE.md §7).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => undefined }) }));

import {
  buildVehicleImagePath,
  isVehicleImagePath,
  parseVehicleForm,
  parseVehicleId,
  VEHICLE_FIELDS,
  VehicleReorderInput,
} from "@/lib/admin/vehicleInput";
import {
  deleteVehicleRow,
  insertVehicle,
  listAdminVehicles,
  reorderVehicleRows,
  setVehicleActive,
  updateVehicleRow,
  type AdminVehicleRow,
} from "@/lib/admin/vehicles";

import { withVehiclesLock } from "./helpers/db-lock";
import { expectFunctionPrivilegeDenied, expectRaisedDenied, expectTablePrivilegeDenied } from "./helpers/expect-denied";
import { dbSmokeEnv, dbWriteGate } from "./helpers/load-env-local";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");
const UUID = "0b8f0c5e-1d2a-4c3b-9e4f-5a6b7c8d9e0f";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}
const VALID = { nameKo: "45인승 관광버스", nameEn: "45-seat Coach", capacity: "45", descriptionKo: "설명", imagePath: "/hero/bus-01.jpg", active: "on" };

// =============================================================================
// 1. 입력 검증
// =============================================================================
describe("1. 입력 검증 (lib/admin/vehicleInput.ts)", () => {
  test("사진 경로 — 0024 CHECK 와 같은 두 형식만", () => {
    expect(isVehicleImagePath(`gallery/vehicles/${UUID}-1600.webp`)).toBe(true);
    expect(isVehicleImagePath("/hero/bus-06.jpg")).toBe(true);
    for (const bad of ["https://x.test/a.jpg", "/hero/bus-07.jpg", `gallery/popups/${UUID}-1600.webp`, "gallery/vehicles/../x-1600.webp", `gallery/vehicles/${UUID.toUpperCase()}-1600.webp`]) {
      expect(isVehicleImagePath(bad), bad).toBe(false);
    }
    expect(buildVehicleImagePath(UUID).imagePath).toBe(`gallery/vehicles/${UUID}-1600.webp`);
    expect(() => buildVehicleImagePath("not-a-uuid")).toThrow();
  });

  test("폼 — 정상 값 · 빈 설명/사진은 null · 정원 범위 · 영문 이름 필수", () => {
    const ok = parseVehicleForm(form(VALID));
    expect(ok).toEqual({ ok: true, value: { nameKo: "45인승 관광버스", nameEn: "45-seat Coach", capacity: 45, descriptionKo: "설명", imagePath: "/hero/bus-01.jpg", active: true } });
    const empty = parseVehicleForm(form({ ...VALID, descriptionKo: "  ", imagePath: "", active: "" }));
    expect(empty.ok && empty.value).toMatchObject({ descriptionKo: null, imagePath: null, active: false });
    for (const [field, value] of [["capacity", "61"], ["capacity", "0"], ["capacity", "4.5"], ["nameEn", " "], ["descriptionKo", "가".repeat(301)], ["imagePath", "https://x.test/a.jpg"]] as const) {
      const r = parseVehicleForm(form({ ...VALID, [field]: value }));
      expect(r.ok, `${field}=${value}`).toBe(false);
      if (!r.ok) expect(r.result.fieldErrors?.[field], field).toBe(true);
    }
  });

  test("영문 설명 칸은 없다 (결정 11)", () => {
    expect(Object.keys(VEHICLE_FIELDS)).not.toContain("descriptionEn");
    expect(read("supabase/migrations/0024_vehicles_admin.sql")).not.toMatch(/add column[^;]*description_en/i);
  });

  test("id·순서 입력", () => {
    expect(parseVehicleId("12")).toBe(12);
    expect(parseVehicleId("0")).toBeNull();
    expect(parseVehicleId("1e3")).toBeNull();
    expect(VehicleReorderInput.safeParse([]).success).toBe(false);
    expect(VehicleReorderInput.safeParse([1, 2]).success).toBe(true);
  });
});

// =============================================================================
// 2. 소스 규약
// =============================================================================
describe("2. 소스 규약", () => {
  const mig = read("supabase/migrations/0024_vehicles_admin.sql");
  const SIGS = [
    "admin_create_vehicle(text, text, integer, text, text, boolean)",
    "admin_update_vehicle(integer, text, text, integer, text, text)",
    "admin_set_vehicle_active(integer, boolean)",
    "admin_delete_vehicle(integer)",
    "admin_reorder_vehicles(integer[])",
  ];

  test("함수 다섯 — 같은 파일에서 public·anon·service_role 회수 + authenticated 에만 EXECUTE", () => {
    for (const sig of SIGS) {
      expect(mig, sig).toContain(`revoke all on function ${sig} from public, anon, service_role;`);
      expect(mig, sig).toContain(`grant execute on function ${sig} to authenticated;`);
    }
  });

  test("첫 문장 is_admin() 가드 · 삭제는 23503 → referenced · 자기검증은 acldefault 로 권한 종류를 연다", () => {
    const fns = mig.split(/create or replace function /).slice(1);
    expect(fns).toHaveLength(5);
    for (const f of fns) expect(f, f.slice(0, 40)).toMatch(/\bbegin\s+if not is_admin\(\) then\s+raise exception/);
    expect(mig).toMatch(/exception when foreign_key_violation then\s+return 'referenced'/);
    expect(mig).toMatch(/aclexplode\(acldefault\('r'/);
    expect(mig).toMatch(/has_column_privilege\('anon'/);
  });

  test("롤백은 함수 다섯을 지우고 칸 두 개를 지운다 — 배포 순서(코드 먼저 되돌림)를 적는다", () => {
    const down = read("supabase/rollbacks/0024_vehicles_admin.down.sql");
    for (const sig of SIGS) expect(down).toContain(`drop function if exists ${sig};`);
    expect(down).toMatch(/drop column if exists image_path/);
    expect(down).toMatch(/drop column if exists description_ko/);
    expect(down).toMatch(/코드를 먼저/);
  });

  test("서버액션 — export 마다 첫 문장 requireAdmin", () => {
    const src = stripComments(read("actions/admin/vehicle.ts"), "vehicle.ts");
    const names = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(["createVehicle", "deleteVehicle", "reorderVehicles", "toggleVehicleActive", "updateVehicle"]);
    for (const n of names) expect(src, n).toMatch(new RegExp(`export async function ${n}\\([^)]*\\)[^{]*\\{\\s*await requireAdmin\\(\\);`));
  });

  test("공개 화면은 사진·설명을 DB 에서 읽는다 — 코드에 차종별 사진·문구가 없고 영문 화면은 설명을 숨긴다", () => {
    const fleet = stripComments(read("components/home/FleetSection.tsx"), "FleetSection.tsx");
    expect(fleet).not.toMatch(/FLEET_IMAGES|bus-0\d\.jpg|t\.raw\("lines"\)/);
    expect(fleet).toMatch(/v\.imagePath/);
    expect(fleet).toMatch(/locale === "en" \? null : \(v\.descriptionKo/);
    for (const loc of ["ko", "en"]) {
      const m = JSON.parse(read(`messages/${loc}.json`)) as { home: { fleet: Record<string, unknown> } };
      expect(m.home.fleet.lines, `${loc} home.fleet.lines 가 남았다`).toBeUndefined();
    }
  });

  test("관리자 화면 — 목록·새 차량·고치기 세 화면 모두 첫 문장 requireAdmin · 탭은 ready", async () => {
    for (const rel of ["app/admin/(protected)/fleet/page.tsx", "app/admin/(protected)/fleet/new/page.tsx", "app/admin/(protected)/fleet/[id]/page.tsx"]) {
      expect(stripComments(read(rel), rel), rel).toMatch(/export default async function \w+\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/);
    }
    const { ADMIN_TABS } = await import("@/components/admin/tabs");
    expect(ADMIN_TABS.find((t) => t.key === "fleet")).toMatchObject({ href: "/admin/fleet", ready: true, group: "site" });
  });
});

// =============================================================================
// 3. DB 실증 — 로컬 스택 + REQUIRE_DB_TESTS=1 에서만
// =============================================================================
const gate = dbWriteGate();
const env = dbSmokeEnv();

describe.skipIf(!gate.allowed || !env.hasServiceRole)("3. DB — 0024 차량 함수 실증 (로컬 스택)", { timeout: 120_000 }, () => {
  // 임시 차량을 만들고 지우고 순서를 바꿨다 되돌린다 — vehicles 전체를 세는 블록(schema·queries)과 줄 세운다.
  withVehiclesLock();

  const baseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceHeaders = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
  const PASSWORD = `t41-${randomUUID()}`;
  const emailFor = (who: string) => `t41-${RUN}-${who}@example.test`;

  type Res = { status: number; body: unknown };
  async function call(method: string, url: string, hdrs: Record<string, string>, json?: unknown, prefer?: string): Promise<Res> {
    const res = await fetch(url, { method, headers: prefer ? { ...hdrs, Prefer: prefer } : hdrs, body: json === undefined ? undefined : JSON.stringify(json) });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // 문자열 그대로
    }
    return { status: res.status, body };
  }
  const rest = (method: string, p: string, json?: unknown, prefer?: string) => call(method, `${env.restRoot}${p}`, serviceHeaders, json, prefer);
  const asUser = (token: string, method: string, p: string, json?: unknown) =>
    call(method, `${env.restRoot}${p}`, { apikey: env.anonKey as string, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, json);
  const asAnon = (method: string, p: string, json?: unknown) => call(method, `${env.restRoot}${p}`, { apikey: env.anonKey as string, "Content-Type": "application/json" }, json);

  let adminId = "";
  let plainId = "";
  let adminToken = "";
  let plainToken = "";
  let created: AdminVehicleRow | null = null;
  let reservationId: string | null = null;
  const NAME = `T41-${RUN}`;

  async function createUser(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/admin/users`, serviceHeaders, { email, password: PASSWORD, email_confirm: true });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBeLessThan(300);
    return (r.body as { id: string }).id;
  }
  async function signIn(email: string): Promise<string> {
    const r = await call("POST", `${baseUrl()}/auth/v1/token?grant_type=password`, { apikey: env.anonKey as string, "Content-Type": "application/json" }, { email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    return (r.body as { access_token: string }).access_token;
  }
  async function adminClient() {
    const { createClient } = await import("@supabase/supabase-js");
    return createClient(baseUrl(), env.anonKey as string, {
      global: { headers: { Authorization: `Bearer ${adminToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as never;
  }
  const values = (over: Partial<Record<string, unknown>> = {}) => ({
    nameKo: NAME, nameEn: `T41 ${RUN}`, capacity: 20, descriptionKo: "검증용 차량", imagePath: `gallery/vehicles/${UUID}-1600.webp`, active: false, ...over,
  }) as Parameters<typeof insertVehicle>[0];

  test("준비 — 관리자 1명 · 일반 로그인 1명", async () => {
    adminId = await createUser(emailFor("admin"));
    plainId = await createUser(emailFor("plain"));
    adminToken = await signIn(emailFor("admin"));
    plainToken = await signIn(emailFor("plain"));
    const add = await rest("POST", "/admin_users", { user_id: adminId, email: emailFor("admin"), note: "T4-1 test" });
    expect(add.status, JSON.stringify(add.body).slice(0, 300)).toBeLessThan(300);
  });

  test("만들기 — 맨 뒤에 들어가고, 숨김이면 anon 에게 안 보이고 관리자에게는 보인다", async () => {
    const db = await adminClient();
    expect(await insertVehicle(values(), db)).toBe(true);
    const rows = await listAdminVehicles(db);
    created = rows.find((r) => r.name_ko === NAME) ?? null;
    expect(created, "만든 차량이 관리자 목록에 없다").not.toBeNull();
    expect(rows[rows.length - 1].id, "새 차량은 맨 뒤 순서다").toBe(created?.id);
    expect(created).toMatchObject({ active: false, capacity: 20, image_path: `gallery/vehicles/${UUID}-1600.webp` });
    expect(created?.slug).toMatch(/^v-[0-9a-f]{8}$/);
    const anon = await asAnon("GET", `/vehicles?select=id&id=eq.${created?.id}`);
    expect(anon.body, "숨긴 차량이 anon 에게 보인다").toEqual([]);
  });

  test("CHECK — 허용 밖 사진 경로·301자 설명은 DB 가 거부한다 (앱 검증을 거치지 않은 호출도)", async () => {
    const bad = await asUser(adminToken, "POST", "/rpc/admin_create_vehicle", {
      p_name_ko: NAME, p_name_en: "x", p_capacity: 1, p_description_ko: null, p_image_path: "https://evil.test/a.jpg", p_active: false,
    });
    expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    expect((bad.body as { code?: string }).code).toBe("23514");
    const long = await asUser(adminToken, "POST", "/rpc/admin_update_vehicle", {
      p_id: created?.id, p_name_ko: NAME, p_name_en: "x", p_capacity: 20, p_description_ko: "가".repeat(301), p_image_path: null,
    });
    expect((long.body as { code?: string }).code).toBe("23514");
  });

  test("고치기·숨기기·순서 — 접수 기록이 없으면 이름·정원도 바뀐다 · 순서는 원자적으로 저장되고 되돌린다", async () => {
    const db = await adminClient();
    const id = (created as AdminVehicleRow).id;
    expect(await updateVehicleRow(id, values({ capacity: 21, descriptionKo: null, imagePath: "/hero/bus-02.jpg" }), db)).toBe("changed");
    expect(await setVehicleActive(id, true, db)).toBe(true);
    const anon = await asAnon("GET", `/vehicles?select=capacity,description_ko,image_path&id=eq.${id}`);
    expect(anon.body).toEqual([{ capacity: 21, description_ko: null, image_path: "/hero/bus-02.jpg" }]);
    expect(await setVehicleActive(id, false, db)).toBe(true);

    const before = (await listAdminVehicles(db)).map((r) => r.id);
    const reversed = [...before].reverse();
    expect(await reorderVehicleRows(reversed, db)).toBe(true);
    expect((await listAdminVehicles(db)).map((r) => r.id)).toEqual(reversed);
    // 빠짐·중복은 22023 으로 거부되고 아무것도 바뀌지 않는다
    await expect(reorderVehicleRows(reversed.slice(1), db)).rejects.toThrow(/22023/);
    await expect(reorderVehicleRows([reversed[0], ...reversed], db)).rejects.toThrow(/22023/);
    expect((await listAdminVehicles(db)).map((r) => r.id)).toEqual(reversed);
    expect(await reorderVehicleRows(before, db)).toBe(true);
    const seed = await rest("GET", "/vehicles?select=slug,sort&slug=in.(bus45,bus35,limo28,bus25,bus16)&order=sort.asc");
    expect((seed.body as { sort: number }[]).map((r) => r.sort), "시드 5행 순서가 1..5 로 돌아오지 않았다").toEqual([1, 2, 3, 4, 5]);
  });

  test("접수 기록이 있으면 이름·정원은 'locked'(아무것도 안 씀) · 설명·사진은 바뀐다 · 지우기는 'referenced'", async () => {
    const db = await adminClient();
    const v = created as AdminVehicleRow;
    const now = new Date().toISOString();
    const r = await rest(
      "POST",
      "/reservations",
      {
        public_code: `T41${RUN.slice(0, 5).toUpperCase()}`, status: "new", name: "차량픽스처", phone: "+821000000000", intake: "wizard",
        vehicle_slug: v.slug, purpose_code: "workshop", origin_code: "SEL", destination_code: "PUS", waypoint_codes: [], trip_type: "oneway",
        depart_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), return_at: null, nights: 0, bus_count: 1, locale: "ko",
        privacy_consent_at: now, privacy_policy_version: "2026-09-11", marketing_consent_at: null,
        retention_until: new Date(Date.now() + 900 * 86_400_000).toISOString(), withdrawal_consent_at: now,
      },
      "return=representation",
    );
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
    reservationId = (r.body as { id: string }[])[0].id;

    expect(await updateVehicleRow(v.id, values({ nameKo: `${NAME}-바뀜`, capacity: 21, imagePath: "/hero/bus-02.jpg", descriptionKo: "x" }), db)).toBe("locked");
    expect(await updateVehicleRow(v.id, values({ capacity: 22, imagePath: "/hero/bus-02.jpg", descriptionKo: "x" }), db)).toBe("locked");
    const still = await rest("GET", `/vehicles?select=name_ko,capacity,description_ko&id=eq.${v.id}`);
    expect(still.body, "'locked' 인데 무언가 썼다").toEqual([{ name_ko: NAME, capacity: 21, description_ko: null }]);
    expect(await updateVehicleRow(v.id, values({ capacity: 21, descriptionKo: "접수 뒤 고친 설명", imagePath: null }), db)).toBe("changed");
    expect(await deleteVehicleRow(v.id, db)).toBe("referenced");
    const exists = await rest("GET", `/vehicles?select=id&id=eq.${v.id}`);
    expect((exists.body as unknown[]).length, "'referenced' 인데 지워졌다").toBe(1);
  });

  test("명단 밖 세션은 가드(42501 + 문구), anon 은 EXECUTE 거부, 표 직접 쓰기는 GRANT 층 거부", async () => {
    const id = (created as AdminVehicleRow).id;
    expectRaisedDenied(await asUser(plainToken, "POST", "/rpc/admin_set_vehicle_active", { p_id: id, p_active: true }), "admin_set_vehicle_active: 관리자 명단에 없는 호출자다", "명단 밖 set_active");
    expectRaisedDenied(await asUser(plainToken, "POST", "/rpc/admin_delete_vehicle", { p_id: id }), "admin_delete_vehicle: 관리자 명단에 없는 호출자다", "명단 밖 delete");
    expectFunctionPrivilegeDenied(await asAnon("POST", "/rpc/admin_reorder_vehicles", { p_ids: [id] }), "admin_reorder_vehicles", "anon reorder");
    expectFunctionPrivilegeDenied(
      await asAnon("POST", "/rpc/admin_create_vehicle", { p_name_ko: "x", p_name_en: "x", p_capacity: 1, p_description_ko: null, p_image_path: null, p_active: true }),
      "admin_create_vehicle",
      "anon create",
    );
    expectTablePrivilegeDenied(await asUser(adminToken, "PATCH", `/vehicles?id=eq.${id}`, { capacity: 1 }), "vehicles", "관리자 세션의 vehicles 직접 PATCH");
  });

  test("정리 — 접수·차량·사용자를 지우고 시드 5행만 남긴다", async () => {
    const db = await adminClient();
    if (reservationId) await rest("DELETE", `/reservations?id=eq.${reservationId}`);
    if (created) expect(await deleteVehicleRow(created.id, db)).toBe("changed");
    await rest("DELETE", `/admin_users?user_id=eq.${adminId}`);
    for (const id of [adminId, plainId]) if (id) await call("DELETE", `${baseUrl()}/auth/v1/admin/users/${id}`, serviceHeaders);
    const all = await rest("GET", "/vehicles?select=slug");
    expect((all.body as unknown[]).length, "임시 차량이 남았다").toBe(5);
  });
});
