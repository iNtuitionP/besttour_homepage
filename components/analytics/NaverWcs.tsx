"use client";

/**
 * 네이버 프리미엄 로그 분석 — 공개 로케일 레이아웃(app/[locale]/layout.tsx)에서만 렌더한다 (OF3-H · 요구사항 §9).
 *
 * 판정과 전송은 lib/analytics/naver-wcs.ts 에 있다(노드에서 테스트한다). 이 파일은 그것을 브라우저에 연결하는 얇은 껍데기다:
 *   - `wa`(NEXT_PUBLIC_NAVER_WA)가 비면 아무것도 렌더하지 않는다.
 *   - 서버 렌더와 첫 화면에서는 스크립트를 넣지 않는다(allowed=false). 마운트 뒤 브라우저에서 **게이트**(시행일 · 거부 표시 · DNT · GPC · 관리자 경로)를
 *     읽고 허용일 때만 `next/script`(afterInteractive)로 wcslog.js 를 불러온다 — SiteAnalytics(Vercel)와 같은 방식이다.
 *     거부 판정은 그 컴포넌트와 **같은 함수**(lib/analytics/before-send.ts readAnalyticsSignals · analyticsRefused)다.
 *   - 같은 탭에서 '방문 통계 거부' 버튼을 누르면(ANALYTICS_OPTOUT_EVENT) · 다른 탭에서 바꾸면(storage) 즉시 다시 판정한다.
 *     이미 불러온 스크립트는 남지만, 경로가 바뀔 때마다 컨트롤러가 거부를 **다시 읽은 뒤에만** wcs_do() 를 부른다 — 로드 뒤 거부하면 그때부터 보내지 않는다.
 *   - 시행일은 서버가 원장(PRIVACY_POLICY_REVISION.effectiveDate)을 prop 으로 내린다 — 원장을 클라이언트 번들에 싣지 않는다.
 *   - 전환(견적 접수 성공)은 QuickQuoteModal 이 trackNaverLead() 를 부른다. 이 컴포넌트가 마운트 때 설정(configureNaverWcs)을 넣어 두므로
 *     컴포넌트가 없는 곳(환경변수 없음)에서는 전환도 나가지 않는다.
 *   - 관리자 레이아웃(app/admin/**)에는 넣지 않는다.
 */
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ANALYTICS_OPTOUT_EVENT, readAnalyticsSignals } from "@/lib/analytics/before-send";
import {
  NAVER_WCS_SRC,
  configureNaverWcs,
  createNaverWcsController,
  naverWcsAllowed,
  type NaverWcsController,
  type NaverWindow,
} from "@/lib/analytics/naver-wcs";

export function NaverWcs({ wa, effectiveFrom }: { wa?: string | null; effectiveFrom: string }) {
  if (!wa) return null;
  return <NaverWcsActive wa={wa} effectiveFrom={effectiveFrom} />;
}

function NaverWcsActive({ wa, effectiveFrom }: { wa: string; effectiveFrom: string }) {
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);
  const [ready, setReady] = useState(false);
  const controller = useRef<NaverWcsController | null>(null);

  // 전환 헬퍼(trackNaverLead)가 읽는 설정 — 이 컴포넌트가 떠 있는 동안만.
  useEffect(() => {
    configureNaverWcs({ wa, effectiveFrom });
    return () => configureNaverWcs(null);
  }, [wa, effectiveFrom]);

  // 스크립트 삽입 게이트 — 마운트 뒤 한 번, 그리고 거부가 바뀔 때마다.
  useEffect(() => {
    const check = () =>
      setAllowed(
        naverWcsAllowed({ wa, effectiveFrom, now: new Date(), signals: readAnalyticsSignals(), pathname: window.location.pathname }),
      );
    check();
    window.addEventListener(ANALYTICS_OPTOUT_EVENT, check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener(ANALYTICS_OPTOUT_EVENT, check);
      window.removeEventListener("storage", check);
    };
  }, [wa, effectiveFrom]);

  // 페이지뷰 — 스크립트가 준비된 뒤 첫 경로, 그리고 클라이언트 경로 이동마다. 매번 거부를 다시 읽는다(컨트롤러).
  useEffect(() => {
    if (!ready || !pathname) return;
    controller.current ??= createNaverWcsController({
      win: window as unknown as NaverWindow,
      wa,
      effectiveFrom,
      now: () => new Date(),
      readSignals: () => readAnalyticsSignals(),
    });
    controller.current.pageview(pathname);
  }, [ready, pathname, wa, effectiveFrom]);

  if (!allowed) return null;
  // onReady — 처음 불러졌을 때와 (거부를 풀어) 다시 마운트됐을 때 모두 부른다(onLoad 는 처음 한 번뿐이다).
  return <Script id="naver-wcs" src={NAVER_WCS_SRC} strategy="afterInteractive" onReady={() => setReady(true)} />;
}
