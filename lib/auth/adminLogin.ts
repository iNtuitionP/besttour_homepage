/**
 * 관리자 로그인의 순수 부분 — 허용 목록·입력 검증·응답 상태 (플랜 v4 P5-1 · ADR-4).
 *
 * 서버액션 지시어 없음, Next 없음, Supabase 없음. 서버액션(actions/admin/auth.ts)과 로그인 화면(app/admin/login/page.tsx)이
 * 이 모듈을 부른다. `ADMIN_EMAILS` 를 읽는 곳은 이 파일 하나다(액션·페이지는 adminEmailAllowlist() 만 부른다).
 *
 * 설계의 핵심 두 가지:
 *   1. **허용 목록이 비면 로그인 자체가 닫힌다**(fail-closed). "설정 안 됨 = 아무나 링크를 받을 수 있음" 이 되는 것이
 *      이 화면에서 가장 위험한 기본값이다. 목록이 비면 Supabase 를 부르지 않고 화면도 닫는다.
 *   2. **응답은 성공과 실패를 구분하지 않는다.** 목록 안이든 밖이든 같은 결과(`sent`)를 돌려준다 — 어느 주소가
 *      관리자인지 알려주면 그 주소가 곧 표적이 된다. P6-3a 예약확인의 "부재 = 불일치" 와 같은 원칙이다.
 *      OF-T3-6(비밀번호 로그인)에서도 같다 — 비밀번호 모드의 실패는 이유와 무관하게 `credentials` 하나다.
 */
import { z } from "zod";

/** 로그인 폼의 주소 입력 이름 — 화면·액션·테스트가 같은 문자열을 쓴다. */
export const ADMIN_EMAIL_FIELD = "email";

/** 비밀번호 입력 이름 (OF-T3-6). 값은 서버액션 안에서 Supabase 로만 간다 — 로그·응답·DOM 에 다시 나오지 않는다. */
export const ADMIN_PASSWORD_FIELD = "password";

/**
 * 로그인 방식 (OF-T3-6 · 결정 6). 폼의 두 제출 버튼이 `name="mode"` 로 이 값을 싣는다.
 *   password  기본 — 이메일 + 비밀번호
 *   link      보조(비상용) — 메일로 로그인 링크 받기. 처음 비밀번호를 정할 때·잊었을 때 쓴다
 * 값이 없거나 모르는 값이면 password 로 본다(엔터 키 제출 = 첫 버튼 = 비밀번호).
 */
export const ADMIN_MODE_FIELD = "mode";
export const ADMIN_LOGIN_MODES = ["password", "link"] as const;
export type AdminLoginMode = (typeof ADMIN_LOGIN_MODES)[number];
export const parseAdminLoginMode = (raw: unknown): AdminLoginMode => (raw === "link" ? "link" : "password");

/**
 * CAPTCHA 토큰 칸 — Turnstile 위젯이 폼 안에 스스로 넣는 hidden input 의 이름(components/quote/TurnstileWidget 의 기본값).
 * 서버액션은 이 값을 Supabase Auth 에 `captchaToken` 으로 그대로 넘긴다(검증은 원격 Supabase Auth 의 CAPTCHA 설정이 한다 — actions/admin/auth.ts 머리 주석).
 */
export const ADMIN_CAPTCHA_FIELD = "cf-turnstile-response";
/** Cloudflare 문서상 토큰 최대 길이(lib/guard/turnstile.ts 와 같은 값). 더 긴 값은 Supabase 로 보내지 않는다. */
export const ADMIN_CAPTCHA_MAX_LENGTH = 2_048;
/**
 * 관리자 로그인 위젯의 `action` — 접수('reserve')·조회('check')와 다른 값. Cloudflare 분석에서 어느 화면의 토큰인지 갈린다.
 * Supabase Auth 는 action 을 대조하지 않는다(토큰의 진위·1회성만 본다).
 */
export const ADMIN_TURNSTILE_ACTION = "admin";

/**
 * 로그인 화면의 Turnstile 사이트 키(공개 값 · 접수·조회 위젯과 같은 키). 비어 있으면 로그인 화면은 닫힌다(app/admin/login/page.tsx).
 * 관리자 경로(app/admin)는 env 를 직접 읽지 못하게 게이트가 막으므로(scripts/check-admin-gate.mjs — 개발 우회 방지) 여기서 읽는다.
 */
export function adminTurnstileSiteKey(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
}

/** 비밀번호 칸 최대 길이 — Supabase Auth(bcrypt)는 72자를 넘는 비밀번호를 받지 않는다. 입력 칸·변경 화면이 같은 값을 쓴다. */
export const ADMIN_PASSWORD_MAX_LENGTH = 72;

/** 로그인 화면 · 관리자 홈 · 매직링크가 돌아올 콜백 경로. redirect() 대상과 emailRedirectTo 가 갈리지 않게 한 곳에 둔다. */
export const ADMIN_LOGIN_PATH = "/admin/login";
export const ADMIN_HOME_PATH = "/admin";
export const ADMIN_CALLBACK_PATH = "/admin/auth/callback";
/** 내 계정(비밀번호 변경) 화면 — OF-T3-6. 보호 구역 안((protected)/account)이다. */
export const ADMIN_ACCOUNT_PATH = "/admin/account";

/** 콜백 실패를 로그인 화면에 알리는 쿼리 (`/admin/login?error=callback`). 이유는 싣지 않는다. */
export const ADMIN_LOGIN_ERROR_PARAM = "error";
export const ADMIN_LOGIN_ERROR_CALLBACK = "callback";

/** RFC 5321 의 주소 최대 길이. 더 긴 입력은 형식 오류로 끊는다(zod 가 뒤의 단계를 보호한다). */
export const ADMIN_EMAIL_MAX_LENGTH = 254;

/**
 * 응답 상태 6종. 이것 말고는 아무것도 내보내지 않는다 — 상태 하나하나가 공격자에게 주는 정보다.
 *   sent        (링크 모드) 링크를 보냈다(고 말한다). 목록 밖·허니팟·CAPTCHA 없음·Supabase 오류도 전부 이것이다
 *   credentials (비밀번호 모드) 로그인하지 못했다. 없는 주소·틀린 비밀번호·허용 목록 밖·CAPTCHA 실패·허니팟·Supabase 오류가
 *               **전부 이것 하나**다(OF-T3-6 · 결정 6 — 구분되면 그 차이가 명단 판별기가 된다). 성공은 응답이 아니라 redirect 다
 *   closed      ADMIN_EMAILS 가 비어 로그인이 닫혀 있다
 *   invalid     주소 형식 오류 — 존재 여부와 무관한 정보라 알려 줘도 된다
 *   ratelimit   한도 초과(이 서버액션의 IP 한도)
 *   infra       Upstash 설정 부재·네트워크 오류 (fail-closed)
 */
export const ADMIN_LOGIN_STATES = ["sent", "credentials", "closed", "invalid", "ratelimit", "infra"] as const;
export type AdminLoginState = (typeof ADMIN_LOGIN_STATES)[number];

export interface AdminLoginResult {
  state: AdminLoginState;
}

export const adminLoginResult = (state: AdminLoginState): AdminLoginResult => ({ state });

/**
 * 중립 응답(`sent`)의 최소 소요 시간(ms) — 독립 리뷰 M2.
 *
 * 화면과 응답 객체를 같게 만들어도 **시간이 다르면 구분된다**: 목록 밖 주소는 즉시 돌아오고(네트워크 0),
 * 목록 안 주소는 Supabase 왕복을 기다린다. 그 차이를 재면 어느 주소가 관리자인지 알 수 있다.
 * 그래서 두 경로에 공통 바닥을 깐다 — 빠른 쪽을 이 시간까지 채운 뒤에 돌려준다.
 * 300ms 는 사람에게는 체감되지 않으면서 로컬 네트워크 왕복(수십 ms)을 덮는 값이다.
 * 이보다 오래 걸린 요청은 더 기다리지 않는다(느린 쪽을 잘라 낼 수는 없다 — 바닥이지 천장이 아니다).
 */
export const MIN_LOGIN_RESPONSE_MS = 300;

/**
 * 비밀번호 모드 실패 응답(`credentials`)의 최소 소요 시간(ms) — OF-T3-6.
 *
 * 링크 모드보다 높은 이유: 비밀번호 판정은 Supabase Auth 의 bcrypt 비교와 CAPTCHA siteverify 를 거쳐 왕복이 길고,
 * "등록된 사용자 + 틀린 비밀번호"(bcrypt 를 돈다)와 "목록 밖"(Supabase 를 부르지 않는다)의 시간 차가 링크 요청보다 크다.
 * 실측(보고서 ⑤): 로컬 스택에서 틀린 비밀번호 왕복은 수십~백여 ms, 원격은 여기에 Vercel↔Supabase 왕복과 siteverify 가 더해진다.
 * 1초는 그 모두를 덮으면서 사람에게는 "확인 중" 으로 읽히는 길이다. 성공(redirect)에는 걸지 않는다 — 맞는 비밀번호를 가진 사람에게 감출 것이 없다.
 */
export const MIN_PASSWORD_RESPONSE_MS = 1_000;

/**
 * 바닥까지 남은 시간. 이미 지났으면 0. 음수·NaN 같은 이상한 경과값은 전액 대기로 접는다(시간 누출도 fail-closed).
 * `floorMs` 를 주지 않으면 링크 모드의 바닥(MIN_LOGIN_RESPONSE_MS)이다.
 */
export function remainingPadMs(elapsedMs: number, floorMs: number = MIN_LOGIN_RESPONSE_MS): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return floorMs;
  return Math.max(0, floorMs - elapsedMs);
}

/** 주소 정규화 — trim + 소문자. 저장·비교·발송 모두 이 형태로 한다. */
const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

/**
 * 입력 스키마. `.trim().toLowerCase()` 를 먼저 걸어 정규화된 값으로 형식을 본다
 * (lib/reservation-check/guards.ts CheckInput 의 `.trim().toUpperCase().regex()` 와 같은 순서 규약).
 */
export const AdminLoginInput = z.object({
  email: z.string().trim().toLowerCase().max(ADMIN_EMAIL_MAX_LENGTH).email(),
});
export type AdminLoginInput = z.infer<typeof AdminLoginInput>;

/**
 * 비밀번호 칸 판정 — 비었거나 지나치게 길면 Supabase 로 보내지 않는다. 결과는 `credentials` 로 접힌다(형식 오류로 따로 알리지 않는다 —
 * 비밀번호의 "모양" 을 알려 줄 이유가 없다). trim 하지 않는다: 앞뒤 공백도 비밀번호의 일부일 수 있다.
 * 상한은 넉넉히 1024 — 72자 초과는 Supabase 가 어차피 거부하고(같은 credentials), 여기서는 거대한 입력만 막는다.
 */
export const ADMIN_PASSWORD_INPUT_MAX = 1_024;
export function isPasswordShapeOk(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length > 0 && raw.length <= ADMIN_PASSWORD_INPUT_MAX;
}

/** CAPTCHA 토큰 칸 판정 — 문자열 · 비어 있지 않음 · 2048자 이하. 진위는 원격 Supabase Auth 가 본다. */
export function isCaptchaShapeOk(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length > 0 && raw.length <= ADMIN_CAPTCHA_MAX_LENGTH;
}

/**
 * `ADMIN_EMAILS` 파싱 — 쉼표 구분, 공백·대소문자 무시, 빈 항목·중복 제거.
 * 여기서 주소 형식을 검사하지 않는다: 형식이 틀린 항목은 어차피 어떤 입력과도 일치하지 않아 무해하고,
 * 오타 하나 때문에 목록 전체가 비어 로그인이 닫히는 편이 더 나쁘다.
 */
export function parseAdminEmails(raw: string | undefined | null): string[] {
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const value = normalizeEmail(part);
    if (value.length > 0) seen.add(value);
  }
  return [...seen];
}

/** `ADMIN_EMAILS` 를 읽는 유일한 지점. 비어 있으면 빈 배열 = 로그인 닫힘. */
export function adminEmailAllowlist(): string[] {
  return parseAdminEmails(process.env.ADMIN_EMAILS);
}

/** 목록 소속 판정. 입력도 목록도 정규화된 형태로 비교한다. 빈 목록은 언제나 false(fail-closed). */
export function isAdminEmailAllowed(email: string, allow: readonly string[]): boolean {
  const value = normalizeEmail(email);
  if (value.length === 0) return false;
  return allow.includes(value);
}
