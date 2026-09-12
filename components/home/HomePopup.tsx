/**
 * 팝업 서버 래퍼 — 페이지가 getActivePopup() 으로 받은 행(또는 개발 프리뷰 더미)을 client island <Popup> 에 props 로 내린다.
 * null 이면 렌더하지 않는다. 라벨(i18n)·이미지 URL 해석은 여기서 끝내고 클라이언트에는 문자열만 준다.
 */
import { getTranslations } from "next-intl/server";

import type { Popup as PopupRow } from "@/lib/types";

import { resolveImageUrl } from "./image-url";
import { Popup } from "./Popup";

export async function HomePopup({ popup }: { popup: PopupRow | null }) {
  if (!popup) return null;
  const t = await getTranslations("home.popup");
  return (
    <Popup
      popup={{ id: popup.id, title: popup.title, body: popup.body, imageSrc: resolveImageUrl(popup.imagePath) }}
      labels={{ close: t("close"), closeAria: t("closeAria"), hideToday: t("hideToday") }}
    />
  );
}
