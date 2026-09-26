import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { isLocalStackUrl } from "./local-url";
import { SCRUBBED_NOTIFY_ENV, scrubRemoteServiceRole } from "./notify-env";

export { isLocalStackUrl };

/** `.env.local` 에서 **절대 읽어 오지 않는** 키 — 실제 발송으로 이어질 수 있다(P4-7 수정 라운드 2 · 리뷰 P1-1, ./notify-env.ts). */
const NEVER_LOAD = new Set<string>(SCRUBBED_NOTIFY_ENV);

/**
 * vitest(node 환경)는 .env.local을 자동으로 process.env에 로드하지 않는다.
 * dotenv 등 새 의존성을 추가하지 않고 최소한의 파서로 필요한 값을 읽어들인다
 * (이미 설정된 process.env 값은 덮어쓰지 않음). schema.test.ts / places.test.ts 공용.
 *
 * `.env.local` 은 개발자의 **운영** 접속 정보다. 발송 관련 키(NEVER_LOAD)는 그 파일에 있어도 읽지 않는다 —
 * 테스트가 `runAfter` 를 즉시 실행하는 순간 운영 대기 행을 실제로 보낼 수 있기 때문이다.
 * `envPath` 는 이 규칙 자체를 테스트하려고 연 인자다(기본은 저장소 루트의 .env.local).
 *
 * 🔴 **service role 키는 로컬 스택 URL 과 짝일 때만 남는다** (P4-7 수정 라운드 3 · 리뷰 P1-A). 읽기가 끝난 뒤
 * `NEXT_PUBLIC_SUPABASE_URL` 이 로컬(127.0.0.1·localhost·kong)이 아니면 `SUPABASE_SERVICE_ROLE_KEY` 를 채우지 않고,
 * 이미 들고 있었어도 빈 문자열로 만든다 — 테스트 프로세스가 **운영 service role 키를 아예 들고 있지 못하게.**
 * 원격 URL 에 대한 DB 테스트는 원래 `dbWriteGate()`·`hasServiceRole` 로 skip 이므로 잃는 것이 없다.
 */
export function loadDotEnvLocal(envPath: string = path.resolve(import.meta.dirname, "..", "..", ".env.local")): void {
  // 🔴 URL 과 service role 키는 **같은 출처에서만** 짝으로 받는다 (P4-7b · 재검토 P2-R3-1).
  //   · 셸(또는 앞선 코드)이 URL 을 이미 줬으면 → 파일의 키는 읽지 않는다(셸 키만).
  //     예전에는 셸이 로컬 URL 만 주고 키를 안 주면 파일의 **운영 키**가 채워지고, URL 이 로컬이라 끝의 판정도 그 키를 남겼다.
  //   · 파일이 URL 을 채우면 → 키도 파일 것만 쓴다. 셸에 떠돌던 키는 버린다(파일의 URL 과 짝지어지지 않게).
  let fileServiceRole: string | undefined;
  let urlFromFile = false;
  if (existsSync(envPath)) {
    const contents = readFileSync(envPath, "utf-8");
    for (const rawLine of contents.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (NEVER_LOAD.has(key)) continue;
      if (key === SERVICE_ROLE_KEY) {
        fileServiceRole = value;
        continue; // 짝 판정 뒤에 넣는다(아래)
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
        if (key === URL_KEY) urlFromFile = true;
      }
    }
  }
  if (urlFromFile) {
    // URL 이 파일에서 왔다 → 키도 파일 것만(없으면 없음).
    if (fileServiceRole === undefined) delete process.env[SERVICE_ROLE_KEY];
    else process.env[SERVICE_ROLE_KEY] = fileServiceRole;
  }
  // 그 밖(셸이 URL 을 줬거나, URL 이 어디에도 없다)에는 파일 키를 넣지 않는다 — 셸이 준 키(있으면)만 남는다.
  scrubRemoteServiceRole(process.env);
}

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const SERVICE_ROLE_KEY = "SUPABASE_SERVICE_ROLE_KEY";

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

function describeHost(url: string | undefined): string {
  if (!url) return "미설정";
  try {
    return new URL(url).hostname || "(호스트 없음)";
  } catch {
    return "(URL 파싱 불가)";
  }
}

// isLocalStackUrl 은 ./local-url.ts 에 있다(위에서 다시 내보낸다) — setup(notify-env.ts)과 이 로더가 같은 판정을 쓴다.

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
