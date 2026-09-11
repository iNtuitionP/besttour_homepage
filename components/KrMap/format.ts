/**
 * 가격 **표시 포맷** — 계산이 아니다 (CLAUDE.md §3 · P2-2 브리프 규칙 1).
 *
 * showcase_routes.price_from 은 사장님이 admin 에 적어 둔 정적 표시값(원)이다. 이 모듈은 그 정수를
 * "40만원" 같은 문자열로 바꿔 보여 줄 뿐, 할인·합계·배율·비교 어떤 계산도 하지 않는다.
 * 함수 본문의 만원 단위 나눗셈 한 곳이 컴포넌트 전체에서 유일하게 허용된 산술이다(tests/krmap.test.ts 가 잠근다).
 *
 * 폴백: null·0·음수·비정상 숫자는 빈 문자열 — 호출 측은 빈 문자열이면 라벨을 숨긴다(실값 미수령 시 라벨 숨김 폴백).
 * 만원 단위가 아닌 값(예: 1,255,000)은 "125.5만원" 으로 소수를 그대로 보인다 — 반올림·절사로 값을 만들지 않는다.
 */
export function formatPriceKrw(priceKrw: number | null): string {
  if (priceKrw === null || !Number.isFinite(priceKrw) || priceKrw <= 0) return "";
  const man = priceKrw / 10000; // 유일하게 허용된 산술 — 원 → 만원 단위 표기
  return `${man}만원`;
}
