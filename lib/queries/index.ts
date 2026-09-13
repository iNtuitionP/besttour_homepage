/**
 * 읽기 쿼리 계층 — RSC 가 직접 호출한다. 서버 액션이 아니고(ADR-3), anon 키 + RLS 로만 읽으며,
 * 캐시를 모른다(감싸는 건 호출부, 태그 이름만 QUERY_TAGS 로 공유).
 */
export { QUERY_TAGS, type QueryTag } from "./tags";
export { getShowcaseRoutes, mapShowcaseRouteRows, type PlacePinRow, type ShowcaseRouteRow } from "./showcase";
export { getPlaces, type PlaceRow } from "./places";
export { getVehicles, type VehicleRow } from "./vehicles";
export { DEFAULT_NOTICE_LIMIT, getNotice, getNotices, parseNoticeId, type NoticeRow } from "./notices";
export { DEFAULT_GALLERY_LIMIT, getGallery, mapGalleryRows, type GalleryRow } from "./gallery";
export { getActivePopup, isActiveOn, type GetActivePopupOptions, type PopupRow } from "./popups";
export type { GalleryItem, Notice, Place, PlacePin, Popup, ShowcaseRouteView, Vehicle } from "../types";
