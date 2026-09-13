/**
 * 옛 메뉴 텍스트(lib/legacy-menu-map.ts labelKo) — 서브페이지의 h1·브레드크럼은 메뉴명을 그대로 쓴다
 * ("기존 메뉴 삭제 금지, 재배치만" 규칙: 페이지 이름이 곧 메뉴 이름이다). 없는 키는 키 자체를 돌려줘 개발 중 눈에 띄게 한다.
 */
import { LEGACY_MENU } from "@/lib/legacy-menu-map";

export function menuLabel(key: string): string {
  return LEGACY_MENU.find((m) => m.key === key)?.labelKo ?? key;
}
