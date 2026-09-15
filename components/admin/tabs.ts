/**
 * 관리자 탭 정의 — 단일 진실 (플랜 v4 P5-3~6·P6-2). 순수 모듈: 라벨도, Next 도, DOM 도 없다.
 *
 * `ready` 규약은 lib/legacy-menu-map.ts 와 같은 정신이다: "지금 링크해도 404 가 아니다" 를 손으로 적은 플래그로 믿는다.
 * 화면을 만드는 태스크가 자기 항목의 ready 를 true 로 올린다(P5-4 팝업 · P5-5 공지 · P5-6 대표 노선 · P6-2 갤러리).
 * ready 가 아닌 항목은 **지우지 않는다** — 사장님이 앞으로 무엇이 생길지 알아야 하고, 지우면 다음 태스크가 자리를 잊는다.
 * 대신 링크가 아니라 `aria-disabled` 로 렌더한다(components/admin/AdminTabs.tsx).
 *
 * 라벨은 여기 없다: messages/ko.json `admin.tabs.<key>`. 관리자 영역은 로케일 밖이라 레이아웃이 기본 로케일로 풀어 내린다.
 */
export const ADMIN_TAB_KEYS = ["reservations", "popups", "notices", "gallery", "routes"] as const;
export type AdminTabKey = (typeof ADMIN_TAB_KEYS)[number];

export interface AdminTab {
  key: AdminTabKey;
  /** 활성일 때의 경로. ready 가 false 여도 적어 둔다 — 다음 태스크가 이 자리에 만든다. */
  href: string;
  ready: boolean;
}

export const ADMIN_TABS: readonly AdminTab[] = [
  { key: "reservations", href: "/admin/reservations", ready: true },
  { key: "popups", href: "/admin/popups", ready: true },
  { key: "notices", href: "/admin/notices", ready: true },
  { key: "gallery", href: "/admin/gallery", ready: true },
  { key: "routes", href: "/admin/routes", ready: true },
];
