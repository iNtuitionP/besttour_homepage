import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Phase A placeholder — next-intl 미들웨어 연결은 Phase B에서 수행한다.
 * 지금은 matcher 규칙만 고정해 "i18n 미들웨어 함정"(API/admin/정적 자산 경로가
 * 로케일 프리픽스 리다이렉트에 걸려 깨지는 문제)을 예방한다:
 *   - /api/**  — Route Handler·Server Actions는 로케일 라우팅 대상이 아님
 *   - /admin/** — 관리자 영역은 별도 인증 흐름, 공개 i18n 라우팅 제외
 *   - /_next/** — Next 내부 자산
 *   - 확장자가 있는 경로(.*\..*) — 정적 파일(이미지, favicon 등)
 * 이 4가지를 제외한 나머지 경로에만 미들웨어가 적용된다.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|admin|_next|.*\\..*).*)"],
};
