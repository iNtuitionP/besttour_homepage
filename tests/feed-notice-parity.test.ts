import { describe, expect, test } from "vitest";

import { PRIVACY_NOTICE } from "@/lib/legal/disclosures";
import type { RecentFeedItem } from "@/lib/recent-feed";
import ko from "@/messages/ko.json";

/**
 * 접수 현황 고지 ↔ 화면 항목 대조 (P3-5 독립 리뷰 M-1, 2026-09-13).
 *
 * 원장 PRIVACY_NOTICE.publicFeedNotice 는 "…만 마스킹하여 홈에 공개됩니다" 라고 **한정 열거**한다. 그런데 P3-5 화면은
 * 성명 일부·차종·운행일에 더해 접수 상태(접수/확정) 칩을 보여 준다 — 리뷰 전까지 고지는 3항목, 화면은 4항목이었고
 * 어떤 게이트도 둘을 비교하지 않았다. 여기서 RecentFeedItem 의 키 하나하나에 고지 문구 조각을 대응시킨다:
 *   - 항목 타입에 키가 늘면 Record<keyof RecentFeedItem, string> 이 컴파일에서 실패한다(고지에 넣기 전엔 화면에 못 올린다)
 *   - 고지에서 문구가 빠지면 런타임 단언이 실패한다
 * 반대 방향(고지에는 있는데 화면에 없는 항목)은 과잉 고지일 뿐 위법이 아니므로 잠그지 않는다.
 */
const DISCLOSED_BY_KEY: Record<keyof RecentFeedItem, string> = {
  maskedName: "성명 일부",
  vehicleLabel: "차종",
  departDateKst: "운행일",
  status: "접수 상태",
};

describe("publicFeedNotice ↔ RecentFeedItem 항목 대조", () => {
  test("화면에 내려가는 모든 키가 고지 문구에 열거돼 있다", () => {
    for (const [key, phrase] of Object.entries(DISCLOSED_BY_KEY)) {
      expect(PRIVACY_NOTICE.publicFeedNotice, `${key} → "${phrase}" 가 고지에 없다`).toContain(phrase);
    }
  });

  test("고지는 여전히 한정 열거('…만')이고 마스킹을 명시한다", () => {
    expect(PRIVACY_NOTICE.publicFeedNotice).toMatch(/만 마스킹하여/);
    expect(PRIVACY_NOTICE.publicFeedNotice).toContain("홈에 공개");
  });

  test("고지의 상태 값 괄호가 화면 칩 문구(ko.json home.recentFeed.statusNew/statusConfirmed)와 글자까지 같다", () => {
    const feed = (ko as { home: { recentFeed: { statusNew: string; statusConfirmed: string } } }).home.recentFeed;
    expect(PRIVACY_NOTICE.publicFeedNotice).toContain(`(${feed.statusNew}/${feed.statusConfirmed})`);
    expect(PRIVACY_NOTICE.publicFeedNotice).toContain("접수 상태(접수/확정)");
  });

  test("고지에 없는 정보는 항목 타입에도 없다 — 시각·출발지·도착지·인원·전화·이메일", () => {
    const keys = Object.keys(DISCLOSED_BY_KEY).sort();
    expect(keys).toEqual(["departDateKst", "maskedName", "status", "vehicleLabel"]);
    for (const forbidden of ["phone", "email", "name", "id", "publicCode", "origin", "destination", "passengers", "time"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
