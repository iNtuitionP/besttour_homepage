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
 */
import { z } from "zod";

/** 로그인 폼의 주소 입력 이름 — 화면·액션·테스트가 같은 문자열을 쓴다. */
export const ADMIN_EMAIL_FIELD = "email";

/** 로그인 화면 · 관리자 홈 · 매직링크가 돌아올 콜백 경로. redirect() 대상과 emailRedirectTo 가 갈리지 않게 한 곳에 둔다. */
export const ADMIN_LOGIN_PATH = "/admin/login";
export const ADMIN_HOME_PATH = "/admin";
export const ADMIN_CALLBACK_PATH = "/admin/auth/callback";

/** 콜백 실패를 로그인 화면에 알리는 쿼리 (`/admin/login?error=callback`). 이유는 싣지 않는다. */
export const ADMIN_LOGIN_ERROR_PARAM = "error";
export const ADMIN_LOGIN_ERROR_CALLBACK = "callback";

/** RFC 5321 의 주소 최대 길이. 더 긴 입력은 형식 오류로 끊는다(zod 가 뒤의 단계를 보호한다). */
export const ADMIN_EMAIL_MAX_LENGTH = 254;

/**
 * 응답 상태 5종. 이것 말고는 아무것도 내보내지 않는다 — 상태 하나하나가 공격자에게 주는 정보다.
 *   sent      링크를 보냈다(고 말한다). 목록 밖·허니팟·Supabase 오류도 전부 이것이다
 *   closed    ADMIN_EMAILS 가 비어 로그인이 닫혀 있다
 *   invalid   주소 형식 오류 — 존재 여부와 무관한 정보라 알려 줘도 된다
 *   ratelimit 한도 초과
 *   infra     Upstash 설정 부재·네트워크 오류 (fail-closed)
 */
export const ADMIN_LOGIN_STATES = ["sent", "closed", "invalid", "ratelimit", "infra"] as const;
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

/** 바닥까지 남은 시간. 이미 지났으면 0. 음수·NaN 같은 이상한 경과값도 0으로 접는다(기다림이 음수가 될 수 없다). */
export function remainingPadMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return MIN_LOGIN_RESPONSE_MS;
  return Math.max(0, MIN_LOGIN_RESPONSE_MS - elapsedMs);
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
