/**
 * 팝업 사진 "새로 올리기" 의 저장 위치 (T3-3 · 결정 9) — 순수 함수, 브라우저·서버 공용.
 *
 * 새 버킷을 만들지 않고 기존 공개 버킷 `gallery` 에 `popups/` 접두어로 넣는다(0011 정책·마이그레이션이 필요 없다).
 * 갤러리 키 규약(yyyy/mm/<uuid>-1600.webp · KST 달)을 그대로 따른다. 공개본(WebP)만 올리고 갤러리 행은 만들지 않는다 —
 * 팝업 사진이 공개 갤러리에 섞이지 않게. 결과 경로는 popupInput 의 형식 검사와 components/home/image-url.ts 의 해석을 그대로 통과한다.
 *
 * 옛 파일은 자동으로 지우지 않는다(갤러리에서 고른 파일일 수 있다 — 고아 파일 허용, 결정 9).
 */
import { toKstDateString } from "../kst";
import { GALLERY_BUCKET, GALLERY_PUBLIC_EXTENSION, GALLERY_PUBLIC_SUFFIX, GALLERY_UUID_RE } from "./galleryInput";

export const POPUP_IMAGE_PREFIX = "popups";

export interface PopupImagePath {
  bucket: typeof GALLERY_BUCKET;
  key: string;
  /** popups.image_path 에 넣을 값 — "gallery/popups/…" */
  imagePath: string;
}

export function buildPopupImagePath(uuid: string, at: Date): PopupImagePath {
  if (!GALLERY_UUID_RE.test(uuid)) throw new Error("buildPopupImagePath: uuid must be a v4 uuid");
  const [yyyy, mm] = toKstDateString(at).split("-");
  const key = `${POPUP_IMAGE_PREFIX}/${yyyy}/${mm}/${uuid}${GALLERY_PUBLIC_SUFFIX}.${GALLERY_PUBLIC_EXTENSION}`;
  return { bucket: GALLERY_BUCKET, key, imagePath: `${GALLERY_BUCKET}/${key}` };
}
