"use server";
/**
 * 관리자 비밀번호 변경 — 로그인한 사람이 자기 비밀번호를 정하거나 바꾼다 (OF-T3-6 · 사장님 요청 13 · 결정 6).
 *
 * 첫 비밀번호도 여기서 정한다: 메일 링크로 들어온 뒤 '내 계정' 에서 설정한다(비밀번호는 채팅·문서로 주고받지 않는다 — 결정 6).
 *
 * 설계
 *   · **첫 문장이 `await requireAdmin();`** 이다(scripts/check-admin-gate.mjs — 이 파일은 예외 목록에 없다).
 *     세션이 없거나 명단 밖이면 로그인 화면으로 redirect 되고 아래는 실행되지 않는다.
 *   · 바꾸는 대상은 **세션 클라이언트의 사용자 자신**이다(`auth.updateUser`). 폼에서 사용자 id·주소를 받지 않는다 — 남의 비밀번호를
 *     바꿀 수 있는 입력이 애초에 없다. 서비스 롤(admin API)을 부르지 않는다(ADR-2).
 *   · 하한(최소 길이·조합)은 원격 Supabase Auth 규칙이 정본이다. 여기서는 빈 칸 · 두 칸 불일치 · 72자 초과만 막고,
 *     원격의 거부(weak_password · same_password · reauthentication_needed)를 사람 말 상태로 바꾼다(lib/auth/adminAccount.ts).
 *   · 비밀번호는 updateUser 인자 말고는 어디에도 쓰지 않는다 — 로그에는 오류 code 만, 응답에는 상태 이름만.
 *
 * 경계: export 는 이 async 함수 하나(ADR-3). 문구는 messages/ko.json admin.account.* 몫이다.
 */
import { cookies } from "next/headers";

import {
  ACCOUNT_CONFIRM_PASSWORD_FIELD,
  ACCOUNT_NEW_PASSWORD_FIELD,
  accountResult,
  accountStateFromAuthError,
  checkPasswordInput,
  type AccountResult,
} from "@/lib/auth/adminAccount";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { createSsrClient } from "@/lib/supabase/ssr";

/** 이 액션이 남기는 로그 — 주소·user id·비밀번호·오류 문구를 싣지 않는다. */
interface AdminAccountLogEntry extends StructuredLogEntry {
  name?: string;
  code?: string;
}
const log = (entry: AdminAccountLogEntry): void => structuredLog(entry);

export async function changeAdminPassword(formData: FormData): Promise<AccountResult> {
  await requireAdmin();

  const next = formData.get(ACCOUNT_NEW_PASSWORD_FIELD);
  const confirm = formData.get(ACCOUNT_CONFIRM_PASSWORD_FIELD);
  const inputState = checkPasswordInput(next, confirm);
  if (inputState !== null || typeof next !== "string") return accountResult(inputState ?? "empty");

  try {
    const client = createSsrClient(await cookies());
    const { error } = await client.auth.updateUser({ password: next });
    if (error) {
      const code = typeof error.code === "string" ? error.code : (error.name ?? "AuthError");
      log({ level: "warn", event: "admin.password_change_rejected", code });
      return accountResult(accountStateFromAuthError(error));
    }
  } catch (err) {
    log({ level: "error", event: "admin.password_change_failed", name: err instanceof Error ? err.name : typeof err });
    return accountResult("failed");
  }

  log({ level: "info", event: "admin.password_changed" });
  return accountResult("changed");
}
