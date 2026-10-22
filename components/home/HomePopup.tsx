/**
 * 팝업 서버 래퍼 — 페이지가 getActivePopups() 로 받은 행들(또는 개발 프리뷰 더미)을 client island <Popup> 에 props 로 내린다.
 * 비어 있으면 렌더하지 않는다. 라벨(i18n)·이미지 URL 해석·사진만 판정은 여기서 끝내고 클라이언트에는 문자열·불리언만 준다.
 * P7-4: 팝업 제목·본문은 사장님이 쓴 한국어 — 영문 화면에서는 lang="ko"(koLang — ko 화면은 undefined 라 속성이 없다).
 * OF3-R2: 홈은 한국어 화면에서만 팝업을 부른다(app/[locale]/(site)/page.tsx) — 영문 홈에는 쿼리도 렌더도 없다.
 */
import { getLocale, getTranslations } from "next-intl/server";

import { koLang } from "@/lib/i18n/ledger-ui";
import { isImageOnlyPopup } from "@/lib/popup-display";
import type { Popup as PopupRow } from "@/lib/types";

import { resolveImageUrl } from "./image-url";
import { Popup } from "./Popup";

export async function HomePopup({ popups }: { popups: readonly PopupRow[] }) {
  if (popups.length === 0) return null;
  const [t, locale] = await Promise.all([getTranslations("home.popup"), getLocale()]);
  return (
    <Popup
      popups={popups.map((p) => ({
        id: p.id,
        title: p.title,
        body: p.body,
        imageSrc: resolveImageUrl(p.imagePath),
        imageOnly: isImageOnlyPopup(p),
      }))}
      labels={{ close: t("close"), closeAria: t("closeAria"), hideToday: t("hideToday") }}
      lang={koLang(locale)}
    />
  );
}
