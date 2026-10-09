/**
 * 견적 신청으로 가는 링크 — 홈 히어로 간편 견적 위젯(`id="quote"`)으로 (P3-8).
 *
 * 6단계 위저드(/quote)는 없어졌다. 견적 CTA(차량 카드 · 차량운임료 · 메뉴 · 옛 /quote 리디렉트)는 전부 홈의 이 앵커로 모인다.
 * next-intl Link 에 객체로 넘긴다 — 로케일 접두는 Link 가 붙인다(ko `/#quote` · en `/en#quote`). 대표 노선 카드(components/KrMap)도 같은 모양을 쓴다.
 */
export const QUOTE_ANCHOR = { pathname: "/", hash: "quote" } as const;
