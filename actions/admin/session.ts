"use server";
/**
 * 관리자 **로그아웃** — 사장님이 스스로 나가는 유일한 경로 (플랜 v4 P5-11 · D5 · ADR-3).
 *
 * 왜 이 파일이 생겼나
 * ---------------------------------------------------------------------------
 * 이 태스크 전까지 저장소 전체에서 `signOut()` 은 lib/auth/requireAdmin.ts 한 곳뿐이었고,
 * 그것은 **명단 밖 사용자를 쫓아내는 강제 경로**다. 사장님이 스스로 나갈 방법이 없었다.
 * Supabase 세션은 미들웨어의 갱신으로 계속 연장되므로 한 번 로그인한 브라우저는 사실상 무기한
 * 로그인 상태로 남고, 그 화면에는 **손님 이름과 원문 전화번호**가 마스킹 없이 보인다
 * (마스킹하지 않는 것이 의도다 — 사장님은 그 번호로 전화를 거셔야 한다).
 *
 * 설계의 핵심: **게이트를 우회하지 않고 오히려 탄다**
 * ---------------------------------------------------------------------------
 * 첫 문장이 `await requireAdmin();` 이고, scripts/check-admin-gate.mjs 의 예외 목록(PUBLIC_ACTIONS)에
 * 이 파일을 **넣지 않는다.** actions/admin/auth.ts 가 예외인 것은 *로그인 링크 요청이 인증 전이라
 * 게이트를 부를 수 없기* 때문이다. 로그아웃은 반대다 — 이미 들어와 있는 사람이 나가는 동작이라
 * 게이트를 부를 수 있고, 불러야 한다. 예외 목록에 한 줄을 더하는 것이 이 저장소에서 인가를 무르게 만드는
 * 가장 싼 방법이므로(tests/admin-gate.test.ts 가 목록을 그대로 단언한다) 새 예외를 만들지 않는다.
 *
 * 명단 밖 세션이 이 액션을 쳐도 결과가 옳다: requireAdmin() 안의 resolveAdminSession() 이
 * **먼저 signOut 시키고** null 을 돌려주므로 redirect 로 로그인 화면에 떨어진다 — 그것이 곧 로그아웃이다.
 *
 * 보장하는 것
 * ---------------------------------------------------------------------------
 *   · **이 브라우저의 세션 쿠키가 지워진다.** requireAdmin.ts 헤더가 적어 둔 한계("서버 컴포넌트에서는
 *     쿠키를 쓸 수 없다")는 **서버 컴포넌트의 한계**이고, 서버액션에서는 next/headers 의 cookies().set 이
 *     동작한다. @supabase/ssr 이 SIGNED_OUT 에 맞춰 만료 쿠키를 실어 보내므로 응답과 함께 삭제된다.
 *   · **Auth 서버의 리프레시 토큰이 회수된다.** signOut() 의 기본 scope 는 `global` 이라
 *     그 사용자의 **모든 기기·브라우저**의 리프레시 토큰이 함께 죽는다(auth-js GoTrueClient.signOut).
 *     즉 사무실 컴퓨터에서 로그아웃하면 휴대폰의 로그인도 함께 끊긴다.
 *
 * 보장하지 못하는 것 — 매뉴얼에 "안전합니다"라고 쓰면 안 되는 것
 * ---------------------------------------------------------------------------
 *   · **이미 발급된 액세스 토큰(JWT)은 PostgREST 에서 만료(1시간) 전까지 살아 있다.** 2026-09-16 로컬 스택 실측:
 *     로그아웃 뒤 같은 토큰으로
 *       - Auth 의 `GET /auth/v1/user` → **403 session_not_found** (세션 표를 확인하므로 즉시 죽는다)
 *       - PostgREST 의 `POST /rest/v1/rpc/is_admin` → **200 true**, `GET /rest/v1/reservations` → **200**
 *     PostgREST 는 **서명만** 검증하고 세션 존재를 묻지 않기 때문이다. 즉 이 화면(requireAdmin → getUser)은 즉시
 *     닫히지만, 로그아웃 전에 **쿠키 값을 통째로 복사해 간 사람**은 남은 만료 시간 동안 DB 에 직접 질의할 수 있다.
 *     그래서 **공용 컴퓨터에서는 로그아웃만으로 충분하지 않다** — 애초에 들어가지 않는 것이 유일한 방어다.
 *   · **화면에 이미 그려진 손님 이름·전화번호는 지워지지 않는다.** 로그아웃은 다음 요청부터 막는 것이고,
 *     열려 있는 탭의 HTML·뒤로가기 캐시를 회수하지 못한다(브라우저를 닫아야 한다).
 *   · Auth 서버에 닿지 못하면 리프레시 토큰이 살아남을 수 있다. 그래도 **로그인 화면으로 보낸다** —
 *     실패를 알리고 그 자리에 머무르게 하면 사장님이 로그인된 화면 앞에 남는다(fail-closed).
 *
 * 경계: export 는 이 async 함수 하나(ADR-3 — 'use server' 모듈의 export 는 전부 공개 POST 엔드포인트가 된다).
 * 서비스 롤을 부르지 않는다(ADR-2). 화면 문구는 messages/ko.json `admin.session.*` 몫이다.
 * GET 으로는 부를 수 없다 — 호출부는 반드시 form 제출(POST)이어야 한다(components/admin/AdminTabs.tsx).
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_LOGIN_PATH } from "@/lib/auth/adminLogin";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { createSsrClient } from "@/lib/supabase/ssr";

/** 이 액션이 남기는 로그 — 주소도 user id 도 오류 메시지도 싣지 않는다(requireAdmin.ts 와 같은 규약). */
interface AdminSessionLogEntry extends StructuredLogEntry {
  /** 예외의 종류만(Error.name 또는 typeof). */
  name?: string;
}

const log = (entry: AdminSessionLogEntry): void => structuredLog(entry);

export async function signOutAdmin(): Promise<void> {
  await requireAdmin();

  try {
    const client = createSsrClient(await cookies());
    const { error } = await client.auth.signOut();
    if (error) log({ level: "warn", event: "admin.sign_out_rejected", name: error.name ?? "AuthError" });
  } catch (err) {
    // 실패해도 로그인 화면으로 보낸다 — 여기서 멈추면 사장님이 로그인된 화면 앞에 남는다.
    log({ level: "error", event: "admin.sign_out_failed", name: err instanceof Error ? err.name : typeof err });
  }

  // redirect() 는 throw 다. try 밖에 두어야 catch 가 삼키지 않는다.
  redirect(ADMIN_LOGIN_PATH);
}
