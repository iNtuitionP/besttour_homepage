import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { createSsrClient } from "./lib/supabase/ssr";

const intlMiddleware = createMiddleware(routing);

/**
 * matcher는 /admin을 **포함**한다(제외하지 않는다).
 * P5-1에서 관리자 인증 게이트를 넣을 때 matcher를 다시 건드리지 않기 위해서다.
 * 대신 본문에서 /admin을 로케일 처리 없이 그대로 통과시킨다.
 *
 * P5-1: /admin 에서 하는 일은 **세션 쿠키 갱신뿐**이다(@supabase/ssr 권장 형태 — getUser() 가 만료 직전의
 * 액세스 토큰을 갱신하고 새 쿠키를 응답에 실어 준다). 인가 판단은 여기서 하지 않는다:
 * 미들웨어 인가는 matcher 한 줄이나 경로 표기 차이로 우회될 수 있고, 서버 컴포넌트가 게이트를 부르지 않아도
 * "미들웨어가 막아 주겠지" 하고 넘어가게 만든다. 판단은 app/admin/(protected)/layout.tsx 의 requireAdmin() 과
 * 0009 의 RLS 정책 두 군데서 한다.
 *
 * 갱신이 실패해도(Supabase env 부재·네트워크) 요청을 막지 않는다 — 세션이 없는 것과 같아지고, 그 결과는
 * requireAdmin() 이 로그인 화면으로 처리한다. 여기서 500 을 내면 로그인 화면조차 열리지 않는다.
 */
async function refreshAdminSession(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request });
  try {
    const supabase = createSsrClient({
      getAll: () => request.cookies.getAll().map(({ name, value }) => ({ name, value })),
      set: (name, value, options) => {
        response.cookies.set(name, value, options);
      },
    });
    await supabase.auth.getUser();
  } catch {
    // 설정이 없거나 Auth 에 닿지 못했다 — 세션 없음으로 흘려보낸다(인가는 서버 컴포넌트가 한다).
  }
  return response;
}

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/admin")) {
    // 관리자 영역은 로케일 프리픽스를 붙이지 않는다(로케일 밖).
    return refreshAdminSession(request);
  }

  return intlMiddleware(request);
}

export const config = {
  /**
   * 제외 대상: /api(Route Handler·Server Actions), /_next(Next 내부 자산),
   * 확장자가 있는 경로(정적 파일). /admin은 의도적으로 제외하지 않는다.
   */
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
