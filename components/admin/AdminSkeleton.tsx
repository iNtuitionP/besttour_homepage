/**
 * 관리자 로딩 스켈레톤 (P5-18) — 탭을 누르거나 목록에서 상세로 들어가는 즉시 본문 자리에 뜬다.
 *
 * 왜: 관리자 화면은 요청마다 렌더한다(app/admin/layout.tsx force-dynamic). 로딩 경계가 없던 동안에는 누른 뒤 서버 응답이
 * 올 때까지 화면이 그대로 멈춰 있었다 — 실측(2026-09-27, 로컬 사본)에서 첫 반응 시각이 본문 도착 시각과 같았다.
 * app/admin/(protected)/loading.tsx(탭 사이)와 상세가 있는 네 구역의 loading.tsx(목록↔상세)가 이 컴포넌트를 그린다.
 * 탭 바는 (protected) 레이아웃에 있어 그대로 남고, 이 컴포넌트는 본문(main) 자리만 채운다.
 * ?쿼리만 바뀌는 이동(필터·페이지)에는 뜨지 않는다 — (protected)/loading.tsx 헤더.
 *
 * ## 이 컴포넌트는 게이트와 무관하게 렌더된다 — 그래서 데이터 0 이 규칙이다 (P5-18 독립 리뷰 P1-1)
 * loading.* 는 레이아웃 게이트의 자식이 아니다. Next 는 세그먼트를 `[segment, 레이아웃 노드, 자식 seed, loadingData, …]` 로 직렬화하고
 * loading 은 **형제 칸**이다(next/dist/server/app-render/create-component-tree.js):
 *   · (protected)/loading 은 레이아웃의 `await requireAdmin()` 과 **나란히** 렌더되고, 게이트가 로그인 화면으로 보내도 결과가 응답에 실린다
 *     (실측: 비로그인 307 응답의 RSC 페이로드에 이 스켈레톤이 있었다 — P5-18 보고서 7-6).
 *   · 구역 loading(reservations 등)은 클라이언트 이동에서 더 멀리 간다 — 서버는 요청의 라우터 상태 헤더를 보고 공유 레이아웃을
 *     건너뛰므로(walk-tree-with-flight-router-state.js) (protected) 레이아웃이 **한 번도 돌지 않은 채** 이 컴포넌트가 렌더될 수 있다
 *     (실측: 쿠키 없는 프리페치 요청이 리다이렉트 0 으로 구역 스켈레톤을 받아 갔다 — P5-18 보고서 「수정 라운드」 R-1).
 * 레이아웃 안쪽에 두어 지켜지는 것은 **비로그인 전체 로드의 307 상태코드**뿐이고(셸이 게이트보다 먼저 나가지 않는다) 렌더 자체는 아니다.
 * 그래서:
 *   · **데이터를 읽지 않는다** — 세션·DB·쿠키·요청 헤더 0, 값을 받지 않는다(매개변수 0). 문구(next-intl)·로케일·자기 CSS 만 import 한다.
 *   · loading 파일은 이 컴포넌트 하나만 그린다(async 0 · 다른 import 0). scripts/check-admin-gate.mjs 규칙 7·8 과
 *     tests/admin-speed.test.ts §3-c 가 모든 loading 을 파일시스템에서 찾아 잠근다. 데이터가 필요하면 loading 이 아니라 page 에 둔다.
 *
 * 규약
 *   · 스크린리더에는 "불러오는 중" 을 **한 번** — role=status 하나에 카탈로그 문구(messages/ko.json admin.loading.label).
 *     회색 막대는 전부 aria-hidden 덩어리 안에 있어 읽히지 않는다.
 *   · 색은 역할 토큰만 · prefers-reduced-motion 이면 움직이지 않는다(AdminSkeleton.module.css).
 *   · 서버 컴포넌트다 — 클라이언트 번들에 아무것도 더하지 않는다.
 * tests/admin-speed.test.ts §3 이 잠근다.
 */
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";

import s from "./AdminSkeleton.module.css";

/** 본문 첫 화면을 대충 채우는 줄 수. 목록이든 상세든 같은 모양이다 — 도착할 화면의 모양을 흉내 내지 않는다. */
const ROWS = [0, 1, 2, 3, 4, 5] as const;
const CHIPS = [0, 1, 2] as const;

export async function AdminSkeleton() {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: "admin.loading" });
  return (
    <main className={s.main} data-testid="admin-loading" aria-busy="true">
      <div className={s.wrap}>
        <p className={s.srOnly} role="status" aria-live="polite">
          {t("label")}
        </p>
        <div className={s.frame} aria-hidden="true">
          <div className={s.head}>
            <span className={`${s.bar} ${s.title}`} />
            <span className={`${s.bar} ${s.sub}`} />
          </div>
          <div className={s.chips}>
            {CHIPS.map((i) => (
              <span key={i} className={`${s.bar} ${s.chip}`} />
            ))}
          </div>
          <div className={s.panel}>
            {ROWS.map((i) => (
              <span key={i} className={`${s.bar} ${s.row}`} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
