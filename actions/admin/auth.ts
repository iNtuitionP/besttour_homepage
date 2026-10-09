"use server";
/**
 * 관리자 로그인 링크 요청 — 얇은 래퍼 (플랜 v4 P5-1 · ADR-3 · ADR-4 · actions/reservation-check.ts 와 같은 모양).
 *
 * 순서(싼 것 → 비싼 것, 막히는 쪽으로):
 *   1. 허용 목록이 비면 **로그인 자체가 닫힌다** — Supabase 도 Upstash 도 부르지 않는다(fail-closed)
 *   2. zod — 형식이 틀린 주소는 카운터를 먹지 않는다(존재 여부와 무관한 정보라 invalid 로 알려 준다)
 *   3. 허니팟 — 채워졌으면 sent 와 같은 응답. 봇에게 필드를 들키지 않는다
 *   4. rate limit — 목록 안이든 밖이든 여기서 슬롯을 소비한다. 열거 시도가 공짜가 아니어야 하고,
 *      한도 판정이 주소마다 갈리면 응답 차이로 명단이 새기 때문이다(키는 IP 해시, 주소가 아니다)
 *   5. 허용 목록 밖 — Supabase 를 부르지 않고 **sent 와 같은 응답**. 어느 주소가 관리자인지 알려주지 않는다
 *   6. signInWithOtp(shouldCreateUser:false) — 미리 만들어 둔 사용자만 링크를 받는다. 계정이 새로 생기는 경로가 없다
 *
 * 응답은 5종(lib/auth/adminLogin.ts ADMIN_LOGIN_STATES)뿐이고, Supabase 오류(미등록 사용자·SMTP 실패)는 로그로만 남기고
 * 응답에 싣지 않는다 — 오류를 그대로 돌려주면 "이 주소는 등록돼 있다" 를 알려주는 판별기가 된다.
 * 값이 같아도 **시간이 다르면 구분된다** — 목록 밖은 즉시, 목록 안은 Supabase 왕복만큼 걸린다. 그래서 중립 응답 세 갈래를
 * MIN_LOGIN_RESPONSE_MS 라는 공통 바닥 위에 올린다(독립 리뷰 M2 · 아래 `neutral`).
 *
 * 경계: export 는 이 async 함수 하나(ADR-3 — 'use server' 모듈의 export 는 전부 공개 POST 엔드포인트가 된다).
 * 서비스 롤을 부르지 않는다(ADR-2 · scripts/check-admin-no-service-role.sh 가 grep). 문구는 화면(messages/ko.json admin.*) 몫이다.
 */
import { cookies, headers } from "next/headers";

import {
  ADMIN_CALLBACK_PATH,
  ADMIN_EMAIL_FIELD,
  AdminLoginInput,
  adminEmailAllowlist,
  adminLoginResult,
  isAdminEmailAllowed,
  remainingPadMs,
  type AdminLoginResult,
} from "@/lib/auth/adminLogin";
import { HONEYPOT_FIELD, checkHoneypot, checkRateLimit, clientIpKey } from "@/lib/guard";
import { adminGuardDeps, type AdminGuardDeps } from "@/lib/guard/deps";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { siteOrigin } from "@/lib/site-url";
import { createSsrClient } from "@/lib/supabase/ssr";

/** 이 액션이 남기는 로그 — 주소도, 오류 메시지도 싣지 않는다(둘 다 명단을 드러낼 수 있다). */
interface AdminLoginLogEntry extends StructuredLogEntry {
  name?: string;
  stage?: string;
}
const log = (entry: AdminLoginLogEntry): void => structuredLog(entry);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function requestAdminLoginLink(formData: FormData): Promise<AdminLoginResult> {
  const startedAt = Date.now();

  /**
   * 중립 응답 — 목록 안·목록 밖·허니팟이 **같은 값 같은 시간**으로 돌아온다 (독립 리뷰 M2).
   * 목록 밖은 네트워크를 타지 않아 즉시 끝나므로, 바닥(MIN_LOGIN_RESPONSE_MS)까지 채운 뒤에 돌려준다.
   * closed·invalid·ratelimit·infra 는 채우지 않는다 — 주소의 존재 여부와 무관한 상태라 시간이 새어도 알려 주는 것이 없다.
   */
  const neutral = async (): Promise<AdminLoginResult> => {
    const pad = remainingPadMs(Date.now() - startedAt);
    if (pad > 0) await wait(pad);
    return adminLoginResult("sent");
  };

  // 1. 허용 목록 — 비어 있으면 아무도 링크를 받을 수 없다
  const allow = adminEmailAllowlist();
  if (allow.length === 0) return adminLoginResult("closed");

  // 2. zod
  const parsed = AdminLoginInput.safeParse({ email: formData.get(ADMIN_EMAIL_FIELD) });
  if (!parsed.success) return adminLoginResult("invalid");

  // 3. 허니팟 — 가짜 성공(시간까지 같게)
  if (!checkHoneypot({ [HONEYPOT_FIELD]: formData.get(HONEYPOT_FIELD) }).ok) return neutral();

  // 4. rate limit — 준비 실패(Upstash env 부재)는 infra 로 닫는다
  let requestHeaders: Awaited<ReturnType<typeof headers>>;
  let deps: AdminGuardDeps;
  try {
    requestHeaders = await headers();
    deps = adminGuardDeps();
  } catch (err) {
    log({ level: "error", event: "admin.login_guard_setup_failed", name: err instanceof Error ? err.name : typeof err });
    return adminLoginResult("infra");
  }

  const { key, bucket } = clientIpKey(requestHeaders, deps.secret);
  let rl;
  try {
    rl = await checkRateLimit(key, bucket, deps.rateLimit);
  } catch (err) {
    log({ level: "error", event: "admin.login_ratelimit_failed", stage: "ratelimit", name: err instanceof Error ? err.name : typeof err });
    return adminLoginResult("infra");
  }
  if (!rl.ok) return adminLoginResult(rl.reason === "ratelimit" ? "ratelimit" : "infra");

  // 5. 목록 밖 — 여기서 끝. Supabase 근처에도 가지 않는다
  if (!isAdminEmailAllowed(parsed.data.email, allow)) {
    log({ level: "warn", event: "admin.login_not_allowlisted" });
    return neutral();
  }

  // 6. 매직링크 요청 — 실패해도 응답은 같다
  try {
    const supabase = createSsrClient(await cookies());
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: { shouldCreateUser: false, emailRedirectTo: `${siteOrigin()}${ADMIN_CALLBACK_PATH}` },
    });
    if (error) log({ level: "warn", event: "admin.login_otp_rejected", name: error.name ?? "AuthError" });
  } catch (err) {
    log({ level: "error", event: "admin.login_otp_failed", name: err instanceof Error ? err.name : typeof err });
  }
  return neutral();
}
