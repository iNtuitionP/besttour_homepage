import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  ADMIN_HOME_PATH,
  ADMIN_LOGIN_ERROR_CALLBACK,
  ADMIN_LOGIN_ERROR_PARAM,
  ADMIN_LOGIN_PATH,
} from "@/lib/auth/adminLogin";
import { structuredLog, type StructuredLogEntry } from "@/lib/log";
import { createSsrClient } from "@/lib/supabase/ssr";

/**
 * /admin/auth/callback — 매직링크가 돌아오는 자리 (P5-1).
 *
 * 메일의 링크에는 일회용 `code` 가 붙어 온다. exchangeCodeForSession 이 그것과 이 브라우저의 PKCE verifier 쿠키를
 * 맞바꿔 세션 쿠키를 심는다 — 그래서 **링크는 요청한 브라우저에서 열어야** 한다(다른 기기에서 열면 verifier 가 없어 실패).
 *
 * 여기서 권한을 판단하지 않는다. 세션만 만들고 /admin 으로 보낸다 —
 * 관리자인지는 (protected) 레이아웃의 requireAdmin() 이 is_admin() 으로 확인하고, 아니면 로그아웃시킨다.
 * 그래서 명단에서 빠진 사람이 예전 링크로 들어와도 세션만 잠깐 생겼다가 즉시 회수된다.
 *
 * 실패(코드 없음·만료·이미 사용됨)는 이유를 구분하지 않고 로그인 화면으로 돌려보낸다: `?error=callback`.
 * 리다이렉트 대상은 언제나 이 앱의 고정 경로다 — 링크의 파라미터를 리다이렉트에 쓰지 않는다(오픈 리다이렉트 차단).
 */
interface CallbackLogEntry extends StructuredLogEntry {
  name?: string;
}
const log = (entry: CallbackLogEntry): void => structuredLog(entry);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const failed = new URL(`${ADMIN_LOGIN_PATH}?${ADMIN_LOGIN_ERROR_PARAM}=${ADMIN_LOGIN_ERROR_CALLBACK}`, request.nextUrl.origin);
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    log({ level: "warn", event: "admin.callback_missing_code" });
    return NextResponse.redirect(failed);
  }

  const response = NextResponse.redirect(new URL(ADMIN_HOME_PATH, request.nextUrl.origin));
  try {
    const cookieStore = await cookies();
    const supabase = createSsrClient({
      getAll: () => cookieStore.getAll().map(({ name, value }) => ({ name, value })),
      set: (name, value, options) => {
        response.cookies.set(name, value, options);
      },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      log({ level: "warn", event: "admin.callback_exchange_rejected", name: error.name ?? "AuthError" });
      return NextResponse.redirect(failed);
    }
  } catch (err) {
    log({ level: "error", event: "admin.callback_failed", name: err instanceof Error ? err.name : typeof err });
    return NextResponse.redirect(failed);
  }

  return response;
}
