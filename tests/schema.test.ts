import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { isAirport, PURPOSES, REGIONS } from "@/lib/codes";
import { ReservationInput } from "@/lib/types";

/**
 * vitest(node 환경)는 .env.local을 자동으로 process.env에 로드하지 않는다.
 * dotenv 등 새 의존성을 추가하지 않고, 이 테스트 파일 안에서만 최소한의
 * 파서로 필요한 값을 읽어들인다(이미 설정된 process.env 값은 덮어쓰지 않음).
 */
function loadDotEnvLocal() {
  const envPath = path.resolve(import.meta.dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;

  const contents = readFileSync(envPath, "utf-8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvLocal();

describe("codes", () => {
  test("REGIONS has exactly 17 entries", () => {
    expect(REGIONS).toHaveLength(17);
  });

  test("PURPOSES has exactly 10 entries", () => {
    expect(PURPOSES).toHaveLength(10);
  });

  test("isAirport identifies ICN only", () => {
    expect(isAirport("ICN")).toBe(true);
    expect(isAirport("SEL")).toBe(false);
  });
});

describe("ReservationInput", () => {
  const validInput = {
    name: "홍길동",
    phone: "010-1234-5678",
    vehicleSlug: "bus45" as const,
    purposeCode: "family" as const,
    originCode: "SEL" as const,
    destinationCode: "BSN" as const,
    waypointCodes: [],
    tripType: "oneway" as const,
    departAtLocal: "2026-09-01T08:00",
    busCount: 1,
    locale: "ko" as const,
    turnstileToken: "test-turnstile-token",
  };

  test("accepts a valid reservation input", () => {
    const result = ReservationInput.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  test("rejects an invalid phone number", () => {
    const result = ReservationInput.safeParse({ ...validInput, phone: "123" });
    expect(result.success).toBe(false);
  });

  test("rejects more than 5 waypoint codes", () => {
    const result = ReservationInput.safeParse({
      ...validInput,
      waypointCodes: ["SEL", "BSN", "INC", "DGU", "GWJ", "DJN"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects busCount over 20", () => {
    const result = ReservationInput.safeParse({ ...validInput, busCount: 21 });
    expect(result.success).toBe(false);
  });

  test("rejects departAtLocal with a trailing Z (UTC suffix)", () => {
    const result = ReservationInput.safeParse({
      ...validInput,
      departAtLocal: "2026-09-01T08:00Z",
    });
    expect(result.success).toBe(false);
  });

  test("rejects when the honeypot field is filled in", () => {
    const result = ReservationInput.safeParse({
      ...validInput,
      website: "http://spam.example",
    });
    expect(result.success).toBe(false);
  });

  test("requires phone or phoneIntl when locale is 'en'", () => {
    const result = ReservationInput.safeParse({
      ...validInput,
      locale: "en",
      phone: undefined,
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// DB 스모크 테스트 — 환경변수가 있으면 반드시 실행한다(없다고 전부 skip 금지).
// =============================================================================
const hasServiceRole = Boolean(
  process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL,
);

describe.skipIf(!hasServiceRole)("DB smoke (requires SUPABASE_SERVICE_ROLE_KEY)", () => {
  const restRoot = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  test("vehicles has 5 seeded rows", async () => {
    const res = await fetch(`${restRoot}/vehicles?select=slug`, { headers });
    expect(res.ok).toBe(true);
    const rows = (await res.json()) as unknown[];
    expect(rows).toHaveLength(5);
  });

  test("showcase_routes has 5 seeded rows with price_from all NULL", async () => {
    const res = await fetch(`${restRoot}/showcase_routes?select=price_from`, { headers });
    expect(res.ok).toBe(true);
    const rows = (await res.json()) as { price_from: number | null }[];
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.price_from).toBeNull();
    }
  });
});
