/**
 * 접수 현황 **프리뷰 더미** — 개발 서버에서 `/?previewFeed=1` 일 때만 페이지가 실제 매퍼(mapRecentRows)에 넣어 props 로 내린다
 * (app/[locale]/(site)/page.tsx, popup-preview.ts 와 같은 규약). production 빌드에서는 분기 자체가 죽은 코드다.
 *
 * 왜 있나: 원격 reservations 가 비어 있으면 섹션이 부재라 마스킹 렌더를 실측할 길이 없다. 고객 개인정보 테이블에 임시 행을 넣지
 * 않기 위한 대체 경로다. 더미를 **원문 행** 모양으로 두는 이유는 프리뷰가 곧 마스킹 경로의 실측이 되게 하기 위해서다 —
 * browse 가 DOM 전체 텍스트에 PREVIEW_RAW_MARKERS 가 0건임을 단언한다(tests/recent-feed.test.ts §11 은 JSON 에 대해 같은 단언).
 *
 * 아래 이름·전화·이메일은 실존 인물이 아닌 개발 확인용 허구값이다. phone·email 은 RecentReservationRow 에 없는 필드라 매퍼가
 * 타입상 받지도 않는다 — 여기 실어 두는 것은 "행에 더 실려 와도 옮겨지지 않는다"를 프리뷰에서도 보이기 위해서다.
 * 운영 카피가 아니므로 messages/ko.json 에 올리지 않는다.
 */
import type { RecentReservationRow } from "@/lib/recent-feed";

export type PreviewRecentRow = RecentReservationRow & { phone: string; email: string };

export const PREVIEW_RECENT_ROWS: readonly PreviewRecentRow[] = [
  {
    name: "한지원",
    phone: "010-1234-5678",
    email: "preview.one@example.com",
    vehicle_slug: "bus45",
    depart_at: "2026-09-19T23:00:00Z", // KST 9/20 — UTC 날짜(9/19)로 읽으면 하루 어긋나는 경계값
    status: "confirmed",
    created_at: "2026-09-13T01:00:00Z",
  },
  {
    name: "Kim Minjun",
    phone: "010-2345-6789",
    email: "preview.two@example.com",
    vehicle_slug: "limo28",
    depart_at: "2026-10-02T22:30:00Z",
    status: "new",
    created_at: "2026-09-12T09:00:00Z",
  },
  {
    name: "박서연",
    phone: "+82 10 3456 7890",
    email: "preview.three@example.com",
    vehicle_slug: "bus16",
    depart_at: "2026-09-27T00:00:00Z",
    status: "new",
    created_at: "2026-09-11T12:00:00Z",
  },
];

/** 원문 조각 — 렌더 결과(DOM 텍스트·JSON)에 하나라도 있으면 누출이다: 이름 전체 · 이름 뒷부분 · 전화 숫자열(4자리 이상) · 이메일 로컬파트. */
export const PREVIEW_RAW_MARKERS: readonly string[] = PREVIEW_RECENT_ROWS.flatMap((r) => [
  r.name,
  r.name.slice(1).trim(),
  ...(r.phone.match(/\d{4,}/g) ?? []),
  r.email.split("@")[0],
]);
