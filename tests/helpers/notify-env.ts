import { afterAll, beforeAll } from "vitest";

import { isLocalStackUrl } from "./local-url";

/**
 * 🔴 원격 URL 과 짝인 service role 키를 비운다 (P4-7 수정 라운드 3 · 리뷰 P1-A — 전역 최후 방어).
 * `NEXT_PUBLIC_SUPABASE_URL` 이 로컬 스택(127.0.0.1·localhost·kong)이 **아니면**(없음 포함) `SUPABASE_SERVICE_ROLE_KEY = ""`.
 * `delete` 가 아니라 `""` 인 이유는 위와 같다: loadDotEnvLocal 은 undefined 만 채운다(그리고 로더도 끝에서 이 함수를 다시 부른다).
 * 이것이 있으면 어떤 가드가 풀려 발송기·서비스 롤 클라이언트가 불려도 **운영 DB 에 인증할 수단이 프로세스 안에 없다.**
 */
export function scrubRemoteServiceRole(env: Record<string, string | undefined>): void {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (url === undefined || url === "") {
    // URL 이 아직 없다(로더가 나중에 채운다) — 셸에 떠돌던 키는 버린다. 로더가 파일에서 **짝으로** 읽은 뒤 끝에서 다시 판정한다.
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    return;
  }
  if (!isLocalStackUrl(url)) env.SUPABASE_SERVICE_ROLE_KEY = "";
}

/**
 * 테스트 프로세스에서 **실제 발송으로 이어질 수 있는 env** (P4-7 수정 라운드 2 · 리뷰 P1-1).
 *
 * 왜 전역인가: tests/helpers/load-env-local.ts 는 `.env.local`(개발자의 **운영 DB** 접속 정보가 든 파일)로 process.env 의
 * 빈칸을 채운다. 거기에 누가 `NOTIFY_INLINE=1` 과 제공자 키를 두면, `runAfter` 를 즉시 실행하는 평범한 단위 테스트
 * (예: admin-reservations 의 확정 테스트)가 운영 대기 행을 reap·claim·**발송**할 수 있었다. 파일마다 막으면 새 파일이 빠져나간다.
 *
 * 그래서 두 겹으로 막는다.
 *   ① vitest setupFiles(tests/helpers/vitest-setup.ts)가 모든 테스트 파일 시작 전에 이 키들을 **빈 문자열**로 만든다.
 *      `delete` 가 아니라 `""` 인 이유: loadDotEnvLocal 은 `undefined` 인 키만 채운다 — 빈 문자열은 "이미 정해진 값" 이라 덮지 않는다.
 *   ② loadDotEnvLocal 자신도 이 키들을 **절대 읽어 오지 않는다**(테스트가 도중에 `delete` 해도 되살아나지 않게).
 *   그리고 앱 쪽 세 번째 겹: lib/notify/deps.ts 는 NODE_ENV=test 에서 명시적 opt-in(아래 allowInlineNotifyInTests) 없이는
 *   즉시 발송을 켜지 않는다.
 *
 * 필요한 테스트는 **자기 안에서 명시적으로** 값을 넣는다(가짜 키·memory sender 만).
 */
export const SCRUBBED_NOTIFY_ENV = [
  "NOTIFY_INLINE",
  "NOTIFY_SENDER",
  "SOLAPI_API_KEY",
  "SOLAPI_API_SECRET",
  "SMS_SENDER",
  "RESEND_API_KEY",
  "MAIL_FROM",
  "OWNER_PHONE",
  "OWNER_EMAIL",
] as const;

/** lib/notify/deps.ts 의 테스트 opt-in 표식과 같은 심볼(Symbol.for 라 모듈 경계를 넘어 같은 값이다). */
export const INLINE_TEST_OPT_IN = Symbol.for("bestour.notify.inlineInTests");

/** 이 describe(또는 파일) 동안만 즉시 발송을 테스트에서 허용한다. 앱 코드는 이 표식을 세우지 않는다. */
export function allowInlineNotifyInTests(): void {
  beforeAll(() => {
    (globalThis as Record<symbol, unknown>)[INLINE_TEST_OPT_IN] = true;
  });
  afterAll(() => {
    delete (globalThis as Record<symbol, unknown>)[INLINE_TEST_OPT_IN];
  });
}
