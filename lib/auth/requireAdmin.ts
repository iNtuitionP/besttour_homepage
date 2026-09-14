/**
 * 관리자 게이트 — 세션이 있는가, 그 세션이 명단에 있는가 (플랜 v4 P5-1 · ADR-2).
 *
 * 서버 전용. 두 단계다:
 *   1. `createSsrClient(cookies())` 로 쿠키 세션을 확인한다. 없으면 로그인 화면.
 *   2. `is_admin()` RPC 로 명단을 확인한다. true 가 아니면 **로그아웃시킨 뒤** 로그인 화면 —
 *      권한 없는 세션을 그대로 두면 "로그인은 됐는데 아무것도 못 하는" 상태가 남고, 그 세션으로
 *      다른 경로를 계속 두드릴 수 있다.
 *
 * 여기서 서비스 롤을 쓰지 않는다(ADR-2). 이 함수가 통과시킨 뒤의 모든 조회는 같은 세션 클라이언트로
 * 돌고 RLS 가 한 번 더 막는다 — 이 함수를 부르는 것을 빠뜨려도 DB 가 0행을 준다.
 *
 * 실패는 전부 같은 결과(로그인 화면)다. 이유를 화면에 알리지 않는다.
 * 예외(Supabase env 부재·네트워크)도 500 이 아니라 로그인 화면이다 — 관리자 화면이 오류 페이지로
 * 열리는 것보다 닫히는 편이 안전하고, env 가 없는 배포에서 /admin 이 깨지지 않는다.
 *
 * 한계(알려진 것): 서버 컴포넌트에서는 쿠키를 쓸 수 없어(next/headers cookies().set 이 던진다)
 * signOut() 이 브라우저 쿠키를 즉시 지우지 못한다. 대신 Auth 서버의 리프레시 토큰이 회수되므로
 * 그 세션은 액세스 토큰 만료(1시간) 뒤 되살아나지 못하고, 미들웨어의 갱신 시도가 실패하며 쿠키가 정리된다.
 */
import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { createSsrClient } from "@/lib/supabase/ssr";

import { ADMIN_LOGIN_PATH } from "./adminLogin";

/**
 * 이 파일이 남기는 로그. 주소·user id·오류 메시지를 싣지 않는다 —
 * Supabase 오류 문구에는 주소가 섞여 올 수 있고, 관리자 주소도 개인정보다.
 */
interface AdminAuthLogEntry extends StructuredLogEntry {
  /** 예외의 종류만(Error.name 또는 typeof). */
  name?: string;
}

const log = (entry: AdminAuthLogEntry): void => structuredLog(entry);

/** 0009 가 만든 판정 함수 이름. RPC 이름을 문자열로 흩뿌리지 않는다. */
export const IS_ADMIN_RPC = "is_admin";

export interface AdminSession {
  userId: string;
  /** auth.users 의 주소. 화면 표시용이며 권한 판정에는 쓰지 않는다(판정은 user_id). */
  email: string;
}

/**
 * 세션 → 명단 확인까지. 통과하지 못하면 null(이유를 구분하지 않는다).
 * 리다이렉트하지 않으므로 테스트에서 그대로 부를 수 있다 — requireAdmin() 이 이것을 감싼다.
 */
export async function resolveAdminSession(): Promise<AdminSession | null> {
  let client: ReturnType<typeof createSsrClient>;
  try {
    client = createSsrClient(await cookies());
  } catch (err) {
    log({ level: "error", event: "admin.session_client_failed", name: err instanceof Error ? err.name : typeof err });
    return null;
  }

  try {
    const { data, error } = await client.auth.getUser();
    const user = error ? null : (data?.user ?? null);
    if (!user) return null;

    const rpc = await client.rpc(IS_ADMIN_RPC);
    if (rpc.error || rpc.data !== true) {
      // 권한 없는 세션을 남기지 않는다. 실패해도 결과는 같다(로그인 화면).
      await client.auth.signOut();
      log({ level: "warn", event: "admin.session_not_admin" });
      return null;
    }

    return { userId: user.id, email: user.email ?? "" };
  } catch (err) {
    log({ level: "error", event: "admin.session_check_failed", name: err instanceof Error ? err.name : typeof err });
    return null;
  }
}

/** 관리자만 통과시킨다. 아니면 로그인 화면으로 보내고 여기서 실행이 끝난다(redirect 는 throw 다). */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await resolveAdminSession();
  if (!session) redirect(ADMIN_LOGIN_PATH);
  return session;
}
