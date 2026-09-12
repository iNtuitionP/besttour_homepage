/**
 * 옛 사이트 메뉴 → 새 라우트 단일 진실 (플랜 v4 §6 P6-3 매핑표).
 *
 * 왜 이 파일이 있는가
 *   사장님 요구는 "기존 메뉴·기능을 삭제하지 말고 재배치만 하라"다. 그 요구를 문서가 아니라
 *   코드로 잠근다. 헤더·푸터는 이 배열만 렌더하므로, 여기서 한 줄을 지우면 메뉴가 사라지고
 *   tests/layout.test.ts 가 즉시 빨간불이 된다(옛 메뉴 10개 라벨을 테스트에 상수로 박아 뒀다).
 *
 * ready 플래그 규약 — 이게 이 파일의 핵심이다
 *   ready 는 "지금 링크해도 404 가 아니다"를 뜻한다. **라우트 파일이 있는지 런타임에 뒤지지 않고**
 *   여기 손으로 적은 플래그를 믿는다. 페이지를 만드는 태스크가 그 페이지를 만들면서 자기 항목의
 *   ready 를 true 로 올린다(P2-4 /about·/fleet, P3 /quote, P4 /notices·/gallery, P5 /reservation/check).
 *   플래그만 올리고 페이지를 안 만들면 tests/layout.test.ts 의 "라우트 파일이 있다" 단언이 잡고,
 *   페이지만 만들고 플래그를 안 올리면 "아직 없다" 단언이 잡는다. 양쪽 다 테스트가 막는다.
 *
 *   ready:false 인 항목은 링크가 아니라 <span aria-disabled="true"> 로 렌더한다(Nav.tsx).
 *   메뉴에서 지우지 않는다 — 지우면 "삭제 금지" 위반이고, 링크하면 404 다.
 *
 * 외부 링크 규약
 *   external:true 인 항목은 ready 가 아니라 **href 유무**로 렌더를 판정한다. URL 은 env 에서 오고,
 *   비어 있으면 항목 자체를 숨긴다(죽은 링크를 배포하지 않는다). URL 을 받으면 env 를 채우고
 *   ready 도 함께 true 로 올린다.
 *
 * 라벨은 옛 사이트 메뉴 텍스트 그대로다. 법정 문구가 아니므로 원장(lib/legal/disclosures.ts)이
 * 아니라 여기 둔다 — 원장은 법정 고지 전용이다.
 */

export type MenuGroup = "company" | "fleet" | "quote" | "support";

export type MenuItem = {
  /** 안정 식별자 — 라벨이 바뀌어도 유지된다. 테스트·매핑표의 키. */
  key: string;
  /** 옛 사이트 메뉴 텍스트 그대로 */
  labelKo: string;
  /** 새 경로. external 이면 URL(없으면 "") */
  href: string;
  /** 외부 사이트로 나가는 링크인가 */
  external?: boolean;
  /** 지금 링크해도 404 가 아닌가 (위 규약 참조) */
  ready: boolean;
  /** 푸터 열 묶음 */
  group: MenuGroup;
};

// [TEMP] LEGACY_MENU.blog.href: 네이버 블로그 주소 사장님 미회신 — 옛 사이트 링크가 깨져 있어 확인 불가. 지어내지 않는다.
//        env 가 비면 항목 자체를 숨긴다. URL 수령 시 env 를 채우고 ready 를 true 로 올린다.
const NAVER_BLOG_URL = process.env.NEXT_PUBLIC_NAVER_BLOG_URL ?? "";

export const LEGACY_MENU: readonly MenuItem[] = [
  { key: "about", labelKo: "회사소개 · 인사말", href: "/about", ready: false, group: "company" },
  { key: "location", labelKo: "찾아오시는 길", href: "/about#location", ready: false, group: "company" },
  { key: "fleet", labelKo: "차량소개 · 보험내용", href: "/fleet", ready: false, group: "fleet" },
  { key: "fares", labelKo: "차량운임료", href: "/fares", ready: false, group: "fleet" },
  { key: "quote", labelKo: "견적요청", href: "/quote", ready: true, group: "quote" },
  { key: "reservationCheck", labelKo: "예약확인", href: "/reservation/check", ready: true, group: "quote" },
  { key: "notices", labelKo: "공지사항", href: "/notices", ready: false, group: "support" },
  { key: "guide", labelKo: "이용안내", href: "/guide", ready: true, group: "support" },
  { key: "gallery", labelKo: "갤러리", href: "/gallery", ready: false, group: "support" },
  { key: "blog", labelKo: "네이버 블로그", href: NAVER_BLOG_URL, external: true, ready: false, group: "support" },
] as const;

/** 그 그룹의 항목만, 순서 유지. 푸터가 열을 나눌 때 쓴다. */
export const MENU_BY_GROUP: Readonly<Record<MenuGroup, readonly MenuItem[]>> = {
  company: LEGACY_MENU.filter((m) => m.group === "company"),
  fleet: LEGACY_MENU.filter((m) => m.group === "fleet"),
  quote: LEGACY_MENU.filter((m) => m.group === "quote"),
  support: LEGACY_MENU.filter((m) => m.group === "support"),
};
