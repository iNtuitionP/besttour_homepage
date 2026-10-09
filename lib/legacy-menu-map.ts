/**
 * 사이트 메뉴 → 라우트 단일 진실 (플랜 v4 §6 P6-3 매핑표 → P7-6 사용자 결정으로 개편).
 *
 * 왜 이 파일이 있는가
 *   헤더·휴대폰 메뉴 패널·푸터는 이 배열만 렌더한다. 메뉴 구성은 문서가 아니라 코드로 잠근다 —
 *   여기서 한 줄을 바꾸면 tests/layout.test.ts(목록·순서·경로)와 tests/site-menu.test.ts(렌더 결과)가 즉시 빨간불이 된다.
 *
 * P7-6 (사용자 결정 2026-10-09 — 오픈 당일 미리보기 승인): 플랜의 "기존 메뉴 10개 전부 매핑" 게이트와 "메뉴 삭제 금지" 규칙을
 *   **사용자가 직접 뒤집었다.** "회사소개·인사말·찾아오시는 길은 한 페이지인데 나눌 필요 없고, 차량운임료는 아예 빼버려,
 *   견적요청·예약확인·공지사항은 좋고, 이용안내는 빼고, 갤러리 남겨놔."
 *     - 찾아오시는 길(/about#location) 항목 삭제 — 회사소개 페이지의 그 구역은 그대로다(옛 bo_page=map 이 그리로 301).
 *     - 차량운임료(/fares) 항목·페이지 삭제 — 대표 노선은 홈 지도(#routes). /fares 는 next.config 가 홈 #routes 로 301.
 *     - 이용안내(/guide)는 **위 메뉴에서만** 뺀다(header:false) — 푸터 고객센터 열에 남는다. 전자상거래법상 거래조건
 *       (취소·환불·계약금) 고지가 사이트에서 닿아야 한다.
 *
 * header 플래그 — 위 메뉴(PC 머리글 · 휴대폰 메뉴 패널)에 나오는가
 *   위 메뉴 순서 = 이 배열에서 header:true 인 항목의 순서다(HEADER_MENU). 푸터는 group 별 열로 나눈다(MENU_BY_GROUP).
 *
 * ready 플래그 규약
 *   ready 는 "지금 링크해도 404 가 아니다"를 뜻한다. **라우트 파일이 있는지 런타임에 뒤지지 않고**
 *   여기 손으로 적은 플래그를 믿는다(P2-4 /about·/fleet, P3 /quote(P3-8 부터 홈 `/#quote`), P4 /notices·/gallery, P5 /reservation/check).
 *   플래그만 올리고 페이지를 안 만들면 tests/layout.test.ts 의 "라우트 파일이 있다" 단언이 잡고,
 *   페이지만 만들고 플래그를 안 올리면 "아직 없다" 단언이 잡는다. 양쪽 다 테스트가 막는다.
 *   ready:false 인 항목은 링크가 아니라 <span aria-disabled="true"> 로 렌더한다(Nav.tsx).
 *
 * 외부 링크 규약
 *   external:true 인 항목은 ready 가 아니라 **href 유무**로 렌더를 판정한다. URL 은 env 에서 오고,
 *   비어 있으면 항목 자체를 숨긴다(죽은 링크를 배포하지 않는다). URL 을 받으면 env 를 채우고
 *   ready 도 함께 true 로 올린다.
 *
 * 라벨(labelKo)은 ko 메뉴 문구다(messages layout.menu 와 같은 글자 — tests/i18n-en.test.ts §5). 법정 문구가 아니므로
 * 원장(lib/legal/disclosures.ts)이 아니라 여기 둔다 — 원장은 법정 고지 전용이다.
 */

export type MenuGroup = "company" | "fleet" | "quote" | "support";

export type MenuItem = {
  /** 안정 식별자 — 라벨이 바뀌어도 유지된다. 테스트·매핑표의 키. */
  key: string;
  /** ko 메뉴 문구 (messages layout.menu 와 같은 글자) */
  labelKo: string;
  /** 새 경로. external 이면 URL(없으면 "") */
  href: string;
  /** 외부 사이트로 나가는 링크인가 */
  external?: boolean;
  /** 지금 링크해도 404 가 아닌가 (위 규약 참조) */
  ready: boolean;
  /** 위 메뉴(PC 머리글 · 휴대폰 메뉴 패널)에 나오는가 — false 면 푸터에만 (P7-6) */
  header: boolean;
  /** 푸터 열 묶음 */
  group: MenuGroup;
};

// [TEMP] LEGACY_MENU.blog.href: 네이버 블로그 주소 사장님 미회신 — 옛 사이트 링크가 깨져 있어 확인 불가. 지어내지 않는다.
//        env 가 비면 항목 자체를 숨긴다. URL 수령 시 env 를 채우고 ready 를 true 로 올린다.
const NAVER_BLOG_URL = process.env.NEXT_PUBLIC_NAVER_BLOG_URL ?? "";

export const LEGACY_MENU: readonly MenuItem[] = [
  { key: "about", labelKo: "회사소개", href: "/about", ready: true, header: true, group: "company" },
  { key: "fleet", labelKo: "차량소개 · 보험내용", href: "/fleet", ready: true, header: true, group: "fleet" },
  // P3-8: 6단계 위저드(/quote)를 지우고 홈 간편 견적 위젯(`id="quote"`)으로 모았다. /quote 는 next.config 가 `/#quote` 로 영구 리디렉트한다.
  { key: "quote", labelKo: "견적요청", href: "/#quote", ready: true, header: true, group: "quote" },
  { key: "reservationCheck", labelKo: "예약확인", href: "/reservation/check", ready: true, header: true, group: "quote" },
  { key: "notices", labelKo: "공지사항", href: "/notices", ready: true, header: true, group: "support" },
  // P7-6: 위 메뉴에서만 뺀다 — 푸터 고객센터 열(공지사항 · 이용안내 · 갤러리)에 남는다.
  { key: "guide", labelKo: "이용안내", href: "/guide", ready: true, header: false, group: "support" },
  { key: "gallery", labelKo: "갤러리", href: "/gallery", ready: true, header: true, group: "support" },
  { key: "blog", labelKo: "네이버 블로그", href: NAVER_BLOG_URL, external: true, ready: false, header: true, group: "support" },
] as const;

/** 위 메뉴(PC 머리글 · 휴대폰 메뉴 패널) — header:true 만, 순서 유지 (P7-6). */
export const HEADER_MENU: readonly MenuItem[] = LEGACY_MENU.filter((m) => m.header);

/** 그 그룹의 항목만, 순서 유지. 푸터가 열을 나눌 때 쓴다(회사 열 = company · 고객센터 열 = support). */
export const MENU_BY_GROUP: Readonly<Record<MenuGroup, readonly MenuItem[]>> = {
  company: LEGACY_MENU.filter((m) => m.group === "company"),
  fleet: LEGACY_MENU.filter((m) => m.group === "fleet"),
  quote: LEGACY_MENU.filter((m) => m.group === "quote"),
  support: LEGACY_MENU.filter((m) => m.group === "support"),
};
