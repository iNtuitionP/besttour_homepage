import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * vitest(node 환경)는 .env.local을 자동으로 process.env에 로드하지 않는다.
 * dotenv 등 새 의존성을 추가하지 않고 최소한의 파서로 필요한 값을 읽어들인다
 * (이미 설정된 process.env 값은 덮어쓰지 않음). schema.test.ts / places.test.ts 공용.
 */
export function loadDotEnvLocal(): void {
  const envPath = path.resolve(import.meta.dirname, "..", "..", ".env.local");
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

/**
 * DB 스모크에 필요한 접속 정보. URL + service role 둘 다 있어야 실행한다
 * (없으면 조용히 skip — CI 는 schema.test.ts 의 REQUIRE_DB_TESTS 가드가 skip 을 막는다).
 */
export function dbSmokeEnv(): {
  hasServiceRole: boolean;
  restRoot: string;
  serviceRoleKey: string;
  anonKey: string | undefined;
} {
  loadDotEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return {
    hasServiceRole: Boolean(url && serviceRoleKey),
    restRoot: `${url}/rest/v1`,
    serviceRoleKey,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
  };
}
