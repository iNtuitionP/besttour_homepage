/**
 * 사이트 원점(origin) 단일 출처 — robots·sitemap 이 같은 값을 쓰게 한다 (P7-2).
 *
 * 왜 상수가 아니라 함수인가
 *   `NEXT_PUBLIC_SITE_URL` 은 환경마다 다르다(프리뷰 배포 URL / 운영 도메인). 모듈 로드 시점에
 *   고정하면 테스트가 환경을 바꿔도 반영되지 않고, 프리뷰에서 운영 URL 이 박힌 sitemap 이 나간다.
 *   호출 시점에 읽는다.
 *
 * 정규화 규칙
 *   - 끝 슬래시를 뗀다 — 호출부가 `${origin}/sitemap.xml` 처럼 붙여 쓰므로 `//` 가 생기면 안 된다.
 *   - `http(s)://` 로 시작하지 않는 값(공란 포함)은 무시하고 운영 도메인으로 폴백한다.
 *     env 를 반쯤 채운 배포에서 상대 URL 이 sitemap 에 들어가는 것보다 운영 도메인이 낫다.
 */
export const FALLBACK_SITE_ORIGIN = "https://bestour.co.kr";

export function siteOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  const candidate = /^https?:\/\/[^\s/]+/.test(raw) ? raw : FALLBACK_SITE_ORIGIN;
  return candidate.replace(/\/+$/, "");
}
