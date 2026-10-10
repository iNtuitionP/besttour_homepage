"use server";
/**
 * 관리자 로그인 — 얇은 래퍼 하나, 방식 둘 (플랜 v4 P5-1 · ADR-3 · ADR-4 → OF-T3-6 · 사장님 요청 13 · 결정 6).
 *
 * 방식(폼의 제출 버튼이 `mode` 로 싣는다 · lib/auth/adminLogin.ts parseAdminLoginMode):
 *   password  기본. 이메일 + 비밀번호 → signInWithPassword. 성공하면 세션 쿠키를 심고 관리자 홈으로 redirect
 *   link      보조(비상용). 메일로 로그인 링크 → signInWithOtp(shouldCreateUser:false). 처음 비밀번호를 정할 때·잊었을 때
 * 옛 결정("관리자는 비밀번호 없이 메일 링크만")을 OF-T3-6 에서 뒤집었다 — 기록은 docs/ops/admin-manual.md 로그인 장.
 *
 * 순서(싼 것 → 비싼 것, 막히는 쪽으로) — 두 방식이 같은 길을 걷다가 마지막에만 갈린다:
 *   1. 허용 목록이 비면 **로그인 자체가 닫힌다** — Supabase 도 Upstash 도 부르지 않는다(fail-closed)
 *   2. zod — 형식이 틀린 주소는 카운터를 먹지 않는다(존재 여부와 무관한 정보라 invalid 로 알려 준다)
 *   3. 허니팟 — 채워졌으면 중립 응답(링크: sent · 비밀번호: credentials). 봇에게 필드를 들키지 않는다
 *   4. rate limit — 목록 안이든 밖이든 여기서 슬롯을 소비한다. 열거·대입 시도가 공짜가 아니어야 하고,
 *      한도 판정이 주소마다 갈리면 응답 차이로 명단이 새기 때문이다(키는 IP 해시, 주소가 아니다)
 *   5. 허용 목록 밖 — Supabase 를 부르지 않고 **중립 응답**. 어느 주소가 관리자인지 알려주지 않는다
 *   6. CAPTCHA 토큰·비밀번호 모양 — 없거나 이상하면 Supabase 를 부르지 않고 중립 응답
 *   7. Supabase Auth 호출(captchaToken 동봉). 실패해도 응답은 중립 그대로
 *
 * 중립 응답 — 비밀번호 모드는 `credentials` 하나다(없는 주소·틀린 비밀번호·허용 목록 밖·CAPTCHA 실패·허니팟·Supabase 장애가 구분되지 않는다).
 * Supabase 의 오류 코드는 로그에 **이름만** 남기고 응답에 싣지 않는다 — 그대로 돌려주면 "이 주소는 등록돼 있다" 를 알려주는 판별기가 된다.
 * 값이 같아도 **시간이 다르면 구분된다** — 그래서 중립 응답은 방식별 바닥(링크 MIN_LOGIN_RESPONSE_MS · 비밀번호 MIN_PASSWORD_RESPONSE_MS) 위에 올린다.
 * closed·invalid·ratelimit·infra 는 바닥을 깔지 않는다 — 허용 목록 판정보다 **앞** 단계라 주소의 존재 여부와 무관하다.
 *
 * CAPTCHA(Turnstile) — **검증은 원격 Supabase Auth 가 한다.** 이 액션은 토큰이 있는지만 보고 `captchaToken` 으로 넘긴다.
 *   이유: Turnstile 토큰은 1회용이다. 여기서 siteverify 를 먼저 부르면 그 토큰이 소모되어, CAPTCHA 를 켠 Supabase Auth 의 검증이
 *   언제나 실패한다(timeout-or-duplicate) — 로그인이 통째로 막힌다. 그리고 공개 anon 키로 Auth API 를 직접 두드리는 공격(계획 위험 #2)을
 *   막는 것은 이 액션이 아니라 원격 Supabase 의 CAPTCHA 다(이 액션의 한도·허니팟은 이 액션을 거치는 요청에만 효과가 있다).
 *   그래서 원격 대시보드에서 CAPTCHA 를 켜는 것이 배포 조건이다(보고서 ③ 체크리스트 · docs/ops/migration-runbook.md 「로컬·원격 Auth 차이」).
 *   로컬 스택(supabase/config.toml)은 CAPTCHA 가 꺼져 있어 토큰을 보지 않는다 — 관리자 DB 테스트가 anon 키 password grant 를 직접 쓰기 때문이다.
 *
 * 성공 — `redirect()` 는 throw 이므로 **try 밖**에서 부른다(actions/admin/session.ts 와 같은 규약). 세션 쿠키는 @supabase/ssr 이
 * signInWithPassword 안에서 cookies().set 으로 심는다(서버액션이라 쓸 수 있다 — lib/supabase/ssr.ts 의 삼킴은 서버 컴포넌트용).
 * 쿠키가 실제로 심어지는지는 tests/admin-password-login.test.ts 가 로컬 스택으로 단언한다.
 *
 * 경계: export 는 이 async 함수 하나(ADR-3 — 'use server' 모듈의 export 는 전부 공개 POST 엔드포인트가 된다).
 * 서비스 롤을 부르지 않는다(ADR-2 · scripts/check-admin-no-service-role.sh 가 grep). 문구는 화면(messages/ko.json admin.*) 몫이다.
 * 비밀번호·토큰은 Supabase 호출 인자 말고는 어디에도 쓰지 않는다(로그·응답·redirect 주소 0).
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_CALLBACK_PATH,
  ADMIN_CAPTCHA_FIELD,
  ADMIN_EMAIL_FIELD,
  ADMIN_HOME_PATH,
  ADMIN_MODE_FIELD,
  ADMIN_PASSWORD_FIELD,
  AdminLoginInput,
  MIN_LOGIN_RESPONSE_MS,
  MIN_PASSWORD_RESPONSE_MS,
  adminEmailAllowlist,
  adminLoginResult,
  isAdminEmailAllowed,
  isCaptchaShapeOk,
  isPasswordShapeOk,
  parseAdminLoginMode,
  remainingPadMs,
  type AdminLoginResult,
} from "@/lib/auth/adminLogin";
import { HONEYPOT_FIELD, checkHoneypot, checkRateLimit, clientIpKey } from "@/lib/guard";
import { adminGuardDeps, type AdminGuardDeps } from "@/lib/guard/deps";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { siteOrigin } from "@/lib/site-url";
import { createSsrClient } from "@/lib/supabase/ssr";

/** 이 액션이 남기는 로그 — 주소도, 비밀번호도, 토큰도, 오류 메시지도 싣지 않는다(명단·비밀을 드러낼 수 있다). */
interface AdminLoginLogEntry extends StructuredLogEntry {
  name?: string;
  stage?: string;
  mode?: string;
  /** Supabase AuthError 의 code(예: invalid_credentials · captcha_failed). 문구가 아니라 고정된 식별자라 주소가 섞이지 않는다. */
  code?: string;
}
const log = (entry: AdminLoginLogEntry): void => structuredLog(entry);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const errName = (err: unknown): string => (err instanceof Error ? err.name : typeof err);
const errCode = (error: { code?: unknown; name?: unknown }): string =>
  typeof error.code === "string" ? error.code : typeof error.name === "string" ? error.name : "AuthError";

export async function signInAdmin(formData: FormData): Promise<AdminLoginResult> {
  const startedAt = Date.now();
  const mode = parseAdminLoginMode(formData.get(ADMIN_MODE_FIELD));

  /**
   * 중립 응답 — 목록 안·목록 밖·허니팟·CAPTCHA 없음·Supabase 실패가 **같은 값 같은 시간**으로 돌아온다 (독립 리뷰 M2 · OF-T3-6).
   * 목록 밖은 네트워크를 타지 않아 즉시 끝나므로, 방식별 바닥까지 채운 뒤에 돌려준다.
   */
  const neutral = async (): Promise<AdminLoginResult> => {
    const floor = mode === "password" ? MIN_PASSWORD_RESPONSE_MS : MIN_LOGIN_RESPONSE_MS;
    const pad = remainingPadMs(Date.now() - startedAt, floor);
    if (pad > 0) await wait(pad);
    return adminLoginResult(mode === "password" ? "credentials" : "sent");
  };

  // 1. 허용 목록 — 비어 있으면 아무도 로그인할 수 없다
  const allow = adminEmailAllowlist();
  if (allow.length === 0) return adminLoginResult("closed");

  // 2. zod
  const parsed = AdminLoginInput.safeParse({ email: formData.get(ADMIN_EMAIL_FIELD) });
  if (!parsed.success) return adminLoginResult("invalid");

  // 3. 허니팟 — 가짜 응답(시간까지 같게)
  if (!checkHoneypot({ [HONEYPOT_FIELD]: formData.get(HONEYPOT_FIELD) }).ok) return neutral();

  // 4. rate limit — 준비 실패(Upstash env 부재)는 infra 로 닫는다
  let requestHeaders: Awaited<ReturnType<typeof headers>>;
  let deps: AdminGuardDeps;
  try {
    requestHeaders = await headers();
    deps = adminGuardDeps();
  } catch (err) {
    log({ level: "error", event: "admin.login_guard_setup_failed", name: errName(err) });
    return adminLoginResult("infra");
  }

  const { key, bucket } = clientIpKey(requestHeaders, deps.secret);
  let rl;
  try {
    rl = await checkRateLimit(key, bucket, deps.rateLimit);
  } catch (err) {
    log({ level: "error", event: "admin.login_ratelimit_failed", stage: "ratelimit", name: errName(err) });
    return adminLoginResult("infra");
  }
  if (!rl.ok) return adminLoginResult(rl.reason === "ratelimit" ? "ratelimit" : "infra");

  // 5. 목록 밖 — 여기서 끝. Supabase 근처에도 가지 않는다
  if (!isAdminEmailAllowed(parsed.data.email, allow)) {
    log({ level: "warn", event: "admin.login_not_allowlisted", mode });
    return neutral();
  }

  // 6. CAPTCHA 토큰 — 위젯을 거치지 않은 요청. 원격 Supabase 가 어차피 거부할 것이라 부르지 않는다
  const captchaToken = formData.get(ADMIN_CAPTCHA_FIELD);
  if (!isCaptchaShapeOk(captchaToken)) {
    log({ level: "warn", event: "admin.login_captcha_missing", mode });
    return neutral();
  }

  // 7-a. 메일 링크 — 실패해도 응답은 같다
  if (mode === "link") {
    try {
      const supabase = createSsrClient(await cookies());
      const { error } = await supabase.auth.signInWithOtp({
        email: parsed.data.email,
        options: { shouldCreateUser: false, emailRedirectTo: `${siteOrigin()}${ADMIN_CALLBACK_PATH}`, captchaToken },
      });
      if (error) log({ level: "warn", event: "admin.login_otp_rejected", code: errCode(error) });
    } catch (err) {
      log({ level: "error", event: "admin.login_otp_failed", name: errName(err) });
    }
    return neutral();
  }

  // 7-b. 비밀번호
  const password = formData.get(ADMIN_PASSWORD_FIELD);
  if (!isPasswordShapeOk(password)) return neutral();

  let signedIn = false;
  try {
    const supabase = createSsrClient(await cookies());
    const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password, options: { captchaToken } });
    if (error) log({ level: "warn", event: "admin.login_password_rejected", code: errCode(error) });
    else signedIn = Boolean(data?.session);
  } catch (err) {
    log({ level: "error", event: "admin.login_password_failed", name: errName(err) });
  }
  if (!signedIn) return neutral();

  log({ level: "info", event: "admin.login_password_ok" });
  // redirect() 는 throw 다. try 밖에 두어야 catch 가 삼키지 않는다. 명단(is_admin) 확인은 도착한 화면의 requireAdmin() 이 한다.
  redirect(ADMIN_HOME_PATH);
}
