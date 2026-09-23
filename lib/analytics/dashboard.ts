/**
 * 방문 통계 대시보드 링크 — `VERCEL_ANALYTICS_URL` (플랜 v4 P5-17).
 *
 * 왜 관리자 폴더가 아니라 여기인가
 * ---------------------------------------------------------------------------
 * `scripts/check-admin-gate.mjs` 규칙 6 은 **관리자 경로(app/admin·actions/admin·lib/admin·components/admin)의
 * `process.env` 분기를 0 으로** 강제한다 — 개발 전용 우회가 거기서 시작됐기 때문이다(P5-3 리뷰 F1·F2).
 * 그래서 env 를 읽는 한 줄은 관리자 폴더 밖에 둔다. 관리자 화면은 결과값(문자열 또는 null)만 받는다.
 *
 * 무엇을 하고 무엇을 하지 않나
 * ---------------------------------------------------------------------------
 * **하는 것**: 사장님이 Vercel 대시보드의 방문 통계를 열 수 있는 링크 하나를 준다.
 *   관리자 화면으로 수치를 가져오는 공식 조회 API 는 확인되지 않았다(ADMIN-STATS-RESEARCH §4) — 그래서 링크다.
 * **하지 않는 것**: 추적 코드를 넣지 않는다. 방문 수집은 이미 `components/SiteAnalytics`(P1-7)가 공개 화면에서만 하고,
 *   관리자 경로는 `lib/analytics/before-send.ts` 가 **보내지 않는다.** 이 모듈은 링크 문자열만 다룬다.
 *
 * 왜 상수가 아니라 함수인가: 환경마다 값이 다르고(팀·프로젝트 슬러그), 모듈 로드 시점에 고정하면 테스트가
 * 환경을 바꿔도 반영되지 않는다. `lib/site-url.ts` 와 같은 규약이다 — 호출 시점에 읽는다.
 *
 * **`https://` 가 아니면 null 이다.** 이 값은 화면의 `href` 로 그대로 들어간다. 반쯤 채워진 배포에서
 * `javascript:` 같은 값이 들어오면 관리자 화면에 클릭 가능한 스크립트 링크가 생긴다 — 모르면 링크를 걸지 않는다.
 * 서버 전용 env 다(`NEXT_PUBLIC_` 접두사 없음) — 서버 컴포넌트에서만 읽히고 브라우저 번들에 들어가지 않는다.
 */
import "server-only";

/** 설정된 Vercel 방문 통계 주소. 없거나 https 가 아니면 null(화면은 "설정되면 여기에서 볼 수 있습니다" 를 보여 준다). */
export function vercelAnalyticsUrl(): string | null {
  const raw = (process.env.VERCEL_ANALYTICS_URL ?? "").trim();
  return /^https:\/\/[^\s/]+/.test(raw) ? raw : null;
}
