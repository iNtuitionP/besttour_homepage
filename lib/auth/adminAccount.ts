/**
 * 관리자 비밀번호 변경의 순수 부분 — 입력 판정 · Supabase 오류 → 화면 상태 (OF-T3-6 · 결정 6).
 *
 * 서버액션 지시어 없음, Next 없음, Supabase 없음. 서버액션(actions/admin/account.ts)과 화면(components/admin/AccountPasswordForm.tsx)이 부른다.
 *
 * 하한(최소 길이·조합)은 **여기서 정하지 않는다** — 원격 Supabase Auth 의 비밀번호 규칙이 정본이다(브리프 3 · 계획 T3-6).
 * 사장님의 네이버웍스 비밀번호가 화면 하한보다 짧을 수 있고, 화면과 원격이 다른 하한을 가지면 "화면은 통과 · 원격은 거부" 가 생긴다.
 * 그래서 화면은 비었는지 · 두 칸이 같은지 · Supabase 가 받을 수 있는 길이(72자 이하)인지만 보고, 나머지는 원격 오류를 사람 말로 바꾼다.
 *
 * 비밀번호 값은 결과에 싣지 않는다 — 상태 이름 하나만 돌려준다.
 */
import { ADMIN_PASSWORD_MAX_LENGTH } from "./adminLogin";

/** 새 비밀번호 칸 · 확인 칸 이름. 화면·액션·테스트가 같은 문자열을 쓴다. */
export const ACCOUNT_NEW_PASSWORD_FIELD = "newPassword";
export const ACCOUNT_CONFIRM_PASSWORD_FIELD = "confirmPassword";

/**
 * 결과 상태.
 *   changed         바꿨다
 *   empty           빈 칸이 있다
 *   mismatch        두 칸이 다르다
 *   tooLong         72자 초과(Supabase Auth 가 받지 않는다)
 *   weakLength      원격 규칙: 너무 짧다
 *   weakCharacters  원격 규칙: 필요한 문자 조합이 빠졌다
 *   weakPwned       원격 규칙: 유출된 적 있는 비밀번호(유료 요금제의 유출 확인을 켠 경우)
 *   same            지금 비밀번호와 같다
 *   reauth          원격의 "안전한 비밀번호 변경"이 켜져 있어 최근 로그인이 필요하다
 *   failed          그 밖의 실패(네트워크·알 수 없는 오류)
 */
export const ACCOUNT_STATES = [
  "changed",
  "empty",
  "mismatch",
  "tooLong",
  "weakLength",
  "weakCharacters",
  "weakPwned",
  "same",
  "reauth",
  "failed",
] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

export interface AccountResult {
  state: AccountState;
}

export const accountResult = (state: AccountState): AccountResult => ({ state });

/** 입력 판정 — 통과하면 null, 아니면 그 상태. 비밀번호는 trim 하지 않는다(공백도 비밀번호의 일부다). */
export function checkPasswordInput(next: unknown, confirm: unknown): AccountState | null {
  if (typeof next !== "string" || typeof confirm !== "string" || next.length === 0 || confirm.length === 0) return "empty";
  if (next !== confirm) return "mismatch";
  if (next.length > ADMIN_PASSWORD_MAX_LENGTH) return "tooLong";
  return null;
}

/** supabase-js AuthError 에서 판정에 쓰는 모양만. 메시지 문구에는 기대지 않는다(버전마다 바뀐다) — code 와 reasons 만 본다. */
export interface AuthErrorShape {
  code?: unknown;
  reasons?: unknown;
}

/**
 * Supabase Auth 오류 → 화면 상태. 코드는 auth-js 의 ErrorCode 이름이다(node_modules/@supabase/auth-js/dist/main/lib/error-codes.d.ts).
 * weak_password 는 reasons 배열(length · characters · pwned)로 이유를 준다(AuthWeakPasswordError). 여럿이면 길이 → 조합 → 유출 순으로 하나만 알린다.
 */
export function accountStateFromAuthError(error: AuthErrorShape | null | undefined): AccountState {
  if (!error) return "changed";
  const code = typeof error.code === "string" ? error.code : "";
  if (code === "weak_password") {
    const reasons = Array.isArray(error.reasons) ? error.reasons.filter((r): r is string => typeof r === "string") : [];
    if (reasons.includes("length")) return "weakLength";
    if (reasons.includes("characters")) return "weakCharacters";
    if (reasons.includes("pwned")) return "weakPwned";
    return "weakLength";
  }
  if (code === "same_password") return "same";
  if (code === "reauthentication_needed" || code === "reauthentication_not_valid" || code === "reauth_nonce_missing") return "reauth";
  return "failed";
}
