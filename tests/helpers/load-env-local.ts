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

// =============================================================================
// DB 쓰기 가드 (P1-3) — 원격은 라이브 DB 이고 reservations 는 고객 개인정보 테이블이다.
// =============================================================================

/** 로컬 Supabase 스택의 호스트명 — `supabase status` 가 내는 127.0.0.1, 개발자가 적는 localhost, 컨테이너 네트워크 안의 kong. */
const LOCAL_STACK_HOSTS = new Set(["127.0.0.1", "localhost", "kong"]);

function describeHost(url: string | undefined): string {
  if (!url) return "미설정";
  try {
    return new URL(url).hostname || "(호스트 없음)";
  } catch {
    return "(URL 파싱 불가)";
  }
}

/**
 * URL 의 호스트명이 로컬 스택인가. 부분 문자열이 아니라 URL 파서의 hostname 으로 판정한다 —
 * `https://localhost.example.com`, `https://x.supabase.co/?u=localhost` 같은 위장을 로컬로 보지 않는다.
 * 파싱 불가·빈 값은 false (모르면 원격으로 취급한다).
 */
export function isLocalStackUrl(url: string | undefined): boolean {
  if (!url) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return LOCAL_STACK_HOSTS.has(hostname.toLowerCase());
}

/** .env.local 을 읽은 뒤 NEXT_PUBLIC_SUPABASE_URL 이 로컬 스택인가. */
export function isLocalStack(): boolean {
  loadDotEnvLocal();
  return isLocalStackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export interface DbWriteGate {
  allowed: boolean;
  /** 닫혔으면 왜 닫혔는지 — skip 로그에 그대로 남긴다. */
  reason: string;
}

export interface DbWriteGateEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  REQUIRE_DB_TESTS?: string;
}

/**
 * DB 를 변경하는 테스트(insert/delete)의 실행 조건: 로컬 스택 URL **그리고** REQUIRE_DB_TESTS=1.
 * 원격(.env.local 의 라이브 DB)에는 REQUIRE_DB_TESTS=1 이어도 절대 열리지 않는다.
 * `env` 를 넘기면 그 값으로만 판정한다(가드 자체를 테스트하기 위해) — 생략하면 .env.local 을 읽은 process.env.
 */
export function dbWriteGate(env?: DbWriteGateEnv): DbWriteGate {
  let source: DbWriteGateEnv;
  if (env) {
    source = env;
  } else {
    loadDotEnvLocal();
    source = process.env as DbWriteGateEnv;
  }
  const url = source.NEXT_PUBLIC_SUPABASE_URL;
  if (!isLocalStackUrl(url)) {
    return {
      allowed: false,
      reason:
        `NEXT_PUBLIC_SUPABASE_URL 의 호스트(${describeHost(url)})가 로컬 스택(127.0.0.1/localhost/kong)이 아니다 — ` +
        "원격 DB 에는 쓰기 테스트를 하지 않는다",
    };
  }
  if (source.REQUIRE_DB_TESTS !== "1") {
    return {
      allowed: false,
      reason: "REQUIRE_DB_TESTS=1 이 아니다 — 로컬 스택이어도 명시적으로 켜야 DB 를 변경한다",
    };
  }
  return { allowed: true, reason: "로컬 스택 + REQUIRE_DB_TESTS=1" };
}
