/**
 * 팝업 **프리뷰 더미** — 개발 서버에서 `/?previewPopup=1` 일 때만 페이지가 props 로 주입한다(app/[locale]/(site)/page.tsx).
 *
 * 왜 있나: 원격 popups 테이블이 비어 있어 팝업 UI(닫기·ESC·오늘 하루 보지 않기·재방문)를 실측할 길이 없다.
 * 원격에 임시 행을 넣지 않기 위한 대체 경로다(P2-4 브리프 §팝업). production 빌드에서는 분기 자체가 죽은 코드다.
 * 문구는 개발 확인용이며 운영 카피가 아니다 — messages/ko.json 에 올리지 않는다.
 */
import type { Popup } from "@/lib/types";

export const PREVIEW_POPUP: Popup = {
  id: 0,
  title: "미리보기 팝업 (개발 전용)",
  body: "관리자가 등록한 팝업이 이 자리에 이렇게 보입니다.\n이 문구는 개발 확인용이며 운영 데이터가 아닙니다.",
  imagePath: "/hero/bus-02.jpg",
  startsAt: "2000-01-01",
  endsAt: "2999-12-31",
  active: true,
  createdAt: "2000-01-01T00:00:00.000Z",
};
