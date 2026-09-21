/**
 * 관리자 콘텐츠 쓰기 RPC 의 공통 판정 (플랜 v4 P5-16 · 마이그레이션 0020 · known-defects **D10**).
 *
 * **왜 표에 직접 쓰지 않게 됐나.** PostgreSQL 은 `ACCESS EXCLUSIVE` 같은 강한 표 잠금을
 * **MAINTAIN·UPDATE·DELETE·TRUNCATE 중 하나**로 허용한다(`src/backend/commands/lockcmds.c` `LockTableAclCheck`).
 * 관리자 화면이 세션 롤(`authenticated`)로 콘텐츠 표에 쓰려면 그 롤에 UPDATE·DELETE 가 있어야 했고,
 * 그래서 **로그인만 하면(관리자 명단에 없어도)** 공지·갤러리 표를 잠가 공개 화면과 관리자 화면을 멈출 수 있었다.
 * RLS 는 그것을 막지 못한다 — RLS 는 "어느 행", GRANT 는 "어느 동작"이고 잠금은 행을 보지 않는다.
 * 0020 이 그 권한을 회수하고, 화면의 쓰기를 `security definer` 함수 18개로 옮겼다(0010 이 예약 전이에 한 방식).
 *
 * **세션 클라이언트를 계속 쓴다 — 서비스 롤이 아니다**(ADR-2 · scripts/check-admin-no-service-role.sh 가 grep).
 * definer 함수는 소유자 권한으로 돌아 RLS 를 우회하므로, 함수 **첫 문장의 `is_admin()` 가드**가 유일한 방어선이다.
 *
 * ## 이 파일이 있는 이유 — 42501 두 가지를 가른다
 * definer 함수를 부를 때 `42501`(insufficient_privilege)이 오는 경로는 **둘**이고 뜻이 정반대다:
 *   · **가드 거부** — EXECUTE 는 있었고 함수가 스스로 막았다(`raise … using errcode = '42501'`).
 *     명단 밖 세션이다. 0020 **이전** 이 경우의 결과는 "바뀐 행 0" 이었다(정책의 `using` 이 행을 안 보여 줬다) —
 *     화면은 그것을 "그런 행이 없습니다"(수정·삭제) 또는 "실패"(새로 만들기)로 보여 줬다. **그 의미를 그대로 유지한다.**
 *   · **EXECUTE 거부** — 함수 본문이 한 줄도 돌지 않았다(`permission denied for function …`).
 *     이것은 배포·마이그레이션 사고이지 "권한 없는 사용자" 가 아니다. 조용히 "행이 없다" 로 삼키면
 *     사장님 화면에 원인을 알 수 없는 문구만 뜬다 — 그래서 **던진다.**
 * 둘 다 SQLSTATE 는 42501 이라 코드로는 갈리지 않는다. 가드가 던지는 **문구**로 가른다
 * (`tests/write-privileges.test.ts` 가 0020 의 18개 함수 전부에 이 문구가 있는지 확인한다).
 * 문구가 어긋나면 안전한 쪽(오류)으로 떨어진다 — 조용히 성공처럼 보이지 않는다.
 */
import "server-only";

/** 0020 의 definer 가드가 던지는 문구(0010 의 네 함수와 같다). 마이그레이션의 `raise exception` 과 **한 글자도 같아야** 한다. */
export const ADMIN_GUARD_MESSAGE = "관리자 명단에 없는 호출자다";

/** PostgreSQL `insufficient_privilege`. PostgREST 가 `error.code` 로 그대로 넘겨준다. */
export const INSUFFICIENT_PRIVILEGE = "42501";

/** PostgREST 가 돌려주는 오류의 최소 모양 — 이 파일은 code 와 message 만 본다(행 내용은 보지 않는다). */
export interface AdminRpcError {
  code?: string | null;
  message: string;
}

/**
 * 부른 함수 `fn` 의 `is_admin()` 가드가 막았는가 — EXECUTE 거부(같은 42501)와는 문구로 갈린다(파일 머리 주석).
 * 가드는 `'<함수>: 관리자 명단에 없는 호출자다'` 를 던진다. **그 문자열과 한 글자도 같을 때만** 가드 거부다.
 * 문구가 포함되기만 해도 받아 주면, 가드 문구를 품은 다른 42501(다른 함수의 가드·감싼 메시지)이
 * 조용히 "바뀐 행 0" 으로 바뀐다(GPT astra P2, P5-16). 어긋나면 던지는 쪽 — 안전한 쪽으로 떨어진다.
 */
export function isAdminGuardDenial(error: AdminRpcError | null | undefined, fn: string): boolean {
  if (!error) return false;
  return error.code === INSUFFICIENT_PRIVILEGE && error.message === `${fn}: ${ADMIN_GUARD_MESSAGE}`;
}

/**
 * 돌아온 행이 하나라도 있으면 실제로 바뀐 것이다. 0행 = 그런 id 가 없다.
 * 0020 의 함수들은 전부 `returns table (id integer)` 라서 바뀐 행의 id 한 줄 또는 0행을 준다 —
 * 표에 직접 쓰던 때의 `.select("id")` 와 같은 모양이고, 그래서 호출부의 판정을 바꾸지 않는다.
 */
export function rpcChangedRows(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0;
}
