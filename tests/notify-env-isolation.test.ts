/**
 * P4-7 수정 라운드 2 · 리뷰 P1-1 — **테스트가 진짜 발송을 할 수 없다**는 것을 잠근다.
 *
 * 세 겹: ① setupFiles 가 발송 env 를 빈 문자열로 고정 ② loadDotEnvLocal 이 그 키들을 `.env.local` 에서 읽지 않음
 * ③ lib/notify/deps.ts 가 NODE_ENV=test 에서 명시적 opt-in 없이는 즉시 발송을 켜지 않음.
 * 이 파일은 셋을 각각 따로 단언한다(하나가 풀려도 나머지가 막는다는 것을 보이려고).
 * 실제 발송 0 · DB 0 — 임시 파일 하나를 OS 임시 폴더에 썼다 지운다(vitest 는 저장소에서 돈다).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { inlineNotifyEnabled } from "@/lib/notify/deps";

import { isLocalStackUrl, loadDotEnvLocal } from "./helpers/load-env-local";
import { INLINE_TEST_OPT_IN, SCRUBBED_NOTIFY_ENV, scrubRemoteServiceRole } from "./helpers/notify-env";

const saved = Object.fromEntries(SCRUBBED_NOTIFY_ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of SCRUBBED_NOTIFY_ENV) process.env[k] = saved[k];
  delete (globalThis as Record<symbol, unknown>)[INLINE_TEST_OPT_IN];
});

describe("① setupFiles — 발송 env 는 테스트 시작 시 빈 문자열이다", () => {
  test.each([...SCRUBBED_NOTIFY_ENV])("%s === '' (undefined 가 아니다 — loadDotEnvLocal 이 채우지 못한다)", (key) => {
    expect(saved[key]).toBe("");
  });

  test("목록에 즉시 발송 스위치 · 문자 키 3종 · 메일 키 2종 · 사장님 수신처 2종이 다 있다", () => {
    for (const k of ["NOTIFY_INLINE", "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "SMS_SENDER", "RESEND_API_KEY", "MAIL_FROM", "OWNER_PHONE", "OWNER_EMAIL"]) {
      expect(SCRUBBED_NOTIFY_ENV, k).toContain(k);
    }
  });
});

describe("② loadDotEnvLocal — 발송 env 는 .env.local 에 있어도 읽지 않는다", () => {
  test("delete 된 상태에서 가짜 .env.local 을 읽어도 발송 키는 되살아나지 않고, 다른 키는 읽힌다", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "p47-envlocal-"));
    const file = path.join(dir, ".env.local");
    try {
      writeFileSync(
        file,
        ["NOTIFY_INLINE=1", "SOLAPI_API_KEY=FAKEKEY", "SOLAPI_API_SECRET=FAKESECRET", "SMS_SENDER=15660000", "RESEND_API_KEY=re_fake", "MAIL_FROM=a@b.test", "OWNER_EMAIL=o@b.test", "P47_PROBE_KEY=ok", ""].join("\n"),
      );
      for (const k of SCRUBBED_NOTIFY_ENV) delete process.env[k];
      delete process.env.P47_PROBE_KEY;
      loadDotEnvLocal(file);
      for (const k of SCRUBBED_NOTIFY_ENV) expect(process.env[k], k).toBeUndefined();
      expect(process.env.P47_PROBE_KEY).toBe("ok");
    } finally {
      delete process.env.P47_PROBE_KEY;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// ④ 수정 라운드 3 · 리뷰 P1-A — 원격(운영) service role 키를 테스트 프로세스가 들고 있지 못하게
// =============================================================================
describe("④ 원격 URL 과 짝인 service role 키는 테스트 프로세스에 들어오지 않는다", () => {
  const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of KEYS) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  });

  test("setup 판정 — URL 이 원격이면 키를 비우고(\"\"), 로컬(127.0.0.1·localhost·kong)이면 그대로 둔다 · URL 이 없으면 키를 버린다", () => {
    const remote: Record<string, string | undefined> = { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "prod-secret" };
    scrubRemoteServiceRole(remote);
    expect(remote.SUPABASE_SERVICE_ROLE_KEY).toBe("");
    for (const url of ["http://127.0.0.1:54321", "http://localhost:54321", "http://kong:8000"]) {
      const local: Record<string, string | undefined> = { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: "local-demo" };
      scrubRemoteServiceRole(local);
      expect(local.SUPABASE_SERVICE_ROLE_KEY, url).toBe("local-demo");
    }
    // URL 이 아직 없으면 떠돌던 키를 버린다(undefined) — 로더가 파일에서 URL 과 **짝으로** 읽은 뒤 다시 판정한다
    const noUrl: Record<string, string | undefined> = { SUPABASE_SERVICE_ROLE_KEY: "stray" };
    scrubRemoteServiceRole(noUrl);
    expect(noUrl.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  test("🔴 이빨 — 운영처럼 흉내 낸 URL 로 이 프로세스에 setup 판정과 로더를 차례로 걸면 service role 키가 비어 있다", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "p47-envlocal-remote-"));
    const file = path.join(dir, ".env.local");
    try {
      writeFileSync(file, ["NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co", "SUPABASE_SERVICE_ROLE_KEY=prod-secret-from-file", ""].join("\n"));
      // (가) 셸이 둘 다 넘긴 경우
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "prod-secret-from-shell";
      scrubRemoteServiceRole(process.env);
      loadDotEnvLocal(file);
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toBe("");
      // (나) 아무것도 없이 시작해 로더가 파일에서 원격 URL 을 채운 경우 — 짝인 키는 채우지 않는다
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      loadDotEnvLocal(file);
      expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abcdefgh.supabase.co");
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toBe("");
      // (다) 셸이 로컬 URL 없이 키만 넘기고, 파일이 원격 URL 을 채운 경우 — 이미 들고 있던 키도 비운다
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = "stray-from-shell";
      loadDotEnvLocal(file);
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * P4-7b · 재검토 P2-R3-1 — URL 과 키는 **같은 출처에서만** 짝으로 받는다.
   * 셸이 로컬 URL 만 주고 키를 주지 않으면, 예전 로더는 `.env.local` 의 운영 키로 빈칸을 채웠고 URL 이 로컬이라 끝의 판정도 그 키를 남겼다.
   */
  test("🔴 이빨 — 셸이 로컬 URL 만 주고 키를 안 주면, 파일에 운영 쌍이 있어도 키는 비어 있다(셸 URL 이면 파일 키를 읽지 않는다)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "p47b-envlocal-mixed-"));
    const file = path.join(dir, ".env.local");
    try {
      writeFileSync(file, ["NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co", "SUPABASE_SERVICE_ROLE_KEY=prod-secret-from-file", ""].join("\n"));
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      scrubRemoteServiceRole(process.env);
      loadDotEnvLocal(file);
      expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toBe("");
      // 셸이 로컬 쌍을 둘 다 줬으면 그 쌍이 그대로 남는다(파일이 덮지 않는다)
      process.env.SUPABASE_SERVICE_ROLE_KEY = "local-demo-from-shell";
      loadDotEnvLocal(file);
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("local-demo-from-shell");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("파일이 URL 을 줬으면 키도 파일 것만 — 셸에 떠돌던 키는 파일의 로컬 URL 과 짝지어지지 않는다", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "p47b-envlocal-filepair-"));
    const file = path.join(dir, ".env.local");
    try {
      writeFileSync(file, ["NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321", ""].join("\n"));
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = "stray-from-shell";
      loadDotEnvLocal(file);
      expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("로컬 스택 짝은 그대로 읽는다 — DB 테스트(로컬 스택)가 깨지지 않는다", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "p47-envlocal-local-"));
    const file = path.join(dir, ".env.local");
    try {
      writeFileSync(file, ["NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321", "SUPABASE_SERVICE_ROLE_KEY=local-demo-key", ""].join("\n"));
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      loadDotEnvLocal(file);
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe("local-demo-key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("이 테스트 프로세스 자체 — URL 이 로컬 스택이 아니면 service role 키가 비어 있다(로컬 스택이면 이 단언은 해당 없음)", () => {
    loadDotEnvLocal();
    if (!isLocalStackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) expect(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toBe("");
    else expect(isLocalStackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)).toBe(true);
  });
});

describe("③ deps.ts — 테스트 프로세스에서는(VITEST 또는 NODE_ENV=test) opt-in 없이 즉시 발송을 켜지 않는다", () => {
  test("🔴 셸이 NODE_ENV=development 를 넘겨도(vitest 는 셸 값을 존중한다) VITEST 가 켜져 있으면 false (수정 라운드 3 · P1-A)", () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NOTIFY_INLINE = "1";
    env.SOLAPI_API_KEY = "FAKEKEY";
    try {
      env.NODE_ENV = "development";
      expect(env.VITEST, "vitest 는 워커에 VITEST 를 항상 세운다 — 이 가드의 전제").toBeTruthy();
      expect(inlineNotifyEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = prev;
    }
  });

  test("기본 실행에서는 NODE_ENV=test 다 — 단 셸이 넘기면 vitest 는 그 값을 쓴다(위 테스트가 그 경우를 막는다)", () => {
    // 셸의 NODE_ENV 가 없을 때만 "test" 다. 전량 실행을 NODE_ENV=development 로 돌리는 경우(수정 라운드 3 검증)를 위해 조건부로 단언한다.
    if (process.env.NODE_ENV !== "development") expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.VITEST).toBeTruthy();
  });

  test("NOTIFY_INLINE=1 + 가짜 키여도 opt-in 이 없으면 false", () => {
    process.env.NOTIFY_INLINE = "1";
    process.env.SOLAPI_API_KEY = "FAKEKEY";
    process.env.SOLAPI_API_SECRET = "FAKESECRET";
    process.env.SMS_SENDER = "15660000";
    expect(inlineNotifyEnabled()).toBe(false);
  });

  test("opt-in 이 있어도 NOTIFY_INLINE 이 '1' 이 아니면 false · 둘 다 있을 때만 true", () => {
    (globalThis as Record<symbol, unknown>)[INLINE_TEST_OPT_IN] = true;
    process.env.NOTIFY_INLINE = "";
    expect(inlineNotifyEnabled()).toBe(false);
    process.env.NOTIFY_INLINE = "1";
    expect(inlineNotifyEnabled()).toBe(true);
  });
});
