import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

/**
 * matcher는 /admin을 **포함**한다(제외하지 않는다).
 * P5-1에서 관리자 인증 게이트를 넣을 때 matcher를 다시 건드리지 않기 위해서다.
 * 대신 본문에서 /admin을 로케일 처리 없이 그대로 통과시킨다.
 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/admin")) {
    // P5-1: requireAdmin 게이트가 여기 들어온다.
    // 관리자 영역은 로케일 프리픽스를 붙이지 않는다(로케일 밖).
    return NextResponse.next();
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
