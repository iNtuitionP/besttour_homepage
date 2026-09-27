/**
 * 허브 화면의 한 줄 상태 — 순수 계산 (P5-20 · 브리프 §B · 제안서 ⑥ "허브 화면은 항목마다 상태 한 줄").
 *
 * 휴대폰 탭 바의 '홈페이지' · '기록' 은 묶음의 허브 화면(app/admin/(protected)/site · records)으로 간다. 허브는 링크 목록에
 * 항목마다 **지금 상태 한 줄**을 붙인다 — 들어가 보기 전에 "할 일이 있는지" 를 알 수 있게(예: "팝업 — 지금 노출 중인 팝업이 없어요").
 *
 * 규칙
 *   - 조회는 허브 화면이 게이트를 통과한 **뒤에** 서로 기다리지 않고 **동시에**(Promise.allSettled) 보낸다. 조회는 전부 이미 있는 목록 함수다 —
 *     각 목록 화면이 여는 것과 같은 조회라 허브가 더 무겁지 않다(새 조회·새 집계 함수를 만들지 않았다).
 *   - 하나가 실패해도 화면은 열린다. 그 줄만 "지금은 상태를 불러오지 못했어요"(unknown) — **모르는 것을 "없음"·"이상 없음" 이라 하지 않는다.**
 *   - 숫자는 DB 가 지금 준 행을 센 것이다(실증 문제 없음 — CLAUDE.md §3). 날짜는 저장된 값 그대로(공지 목록과 같은 표기).
 *
 * 돌려주는 것은 카탈로그 키(messages/ko.json `admin.hub.*` 기준)와 채울 값뿐이다 — 문구는 여기 없다(한글 리터럴 0). React·Next·DB 없음.
 */

export interface HubLine {
  /** `admin.hub` 아래 키(예: "popups.noneLive"). */
  key: string;
  values?: Record<string, string | number>;
}

export const UNKNOWN_LINE: HubLine = { key: "unknown" };

type Settled<T> = PromiseSettledResult<T>;

/** 공지 — 노출 중 건수와 그 가운데 가장 늦은 게시일. 노출 중이 없으면 "없어요", 한 건도 없으면 "아직 없어요". */
export function noticesLine(res: Settled<readonly { active: boolean; published_at: string }[]>): HubLine {
  if (res.status !== "fulfilled") return UNKNOWN_LINE;
  const rows = res.value;
  if (rows.length === 0) return { key: "notices.empty" };
  const live = rows.filter((r) => r.active);
  if (live.length === 0) return { key: "notices.noneLive" };
  const last = live.map((r) => r.published_at).reduce((a, b) => (b > a ? b : a));
  return { key: "notices.live", values: { n: live.length, date: last } };
}

/** 팝업 — 지금 방문자에게 보이는 것(활성 + 오늘이 기간 안)의 개수. 판정은 부르는 쪽이 공개 화면과 같은 함수로(popupState). */
export function popupsLine<T>(res: Settled<readonly T[]>, isLive: (row: T) => boolean): HubLine {
  if (res.status !== "fulfilled") return UNKNOWN_LINE;
  const live = res.value.filter(isLive).length;
  return live === 0 ? { key: "popups.noneLive" } : { key: "popups.live", values: { n: live } };
}

/** 갤러리 — 올려 둔 사진 장수(저장된 행의 합 — 갤러리 화면의 사용량과 같은 값). */
export function galleryLine(res: Settled<{ photos: number }>): HubLine {
  if (res.status !== "fulfilled") return UNKNOWN_LINE;
  return res.value.photos === 0 ? { key: "gallery.empty" } : { key: "gallery.count", values: { n: res.value.photos } };
}

/**
 * 대표 노선 — 몇 개 중 몇 개가 홈에 나가는지, 그 가운데 금액이 비어 **노선만** 보이는 것이 몇 개인지(홈이 금액 라벨을 숨기는 폴백 — P2-2).
 * 금액은 세기만 한다(계산 없음 — CLAUDE.md §3).
 */
export function routesLine(res: Settled<readonly { active: boolean; price_from: number | null }[]>): HubLine {
  if (res.status !== "fulfilled") return UNKNOWN_LINE;
  const rows = res.value;
  const live = rows.filter((r) => r.active);
  const noPrice = live.filter((r) => r.price_from === null).length;
  return noPrice === 0
    ? { key: "routes.live", values: { total: rows.length, live: live.length } }
    : { key: "routes.noPrice", values: { total: rows.length, live: live.length, n: noPrice } };
}

/** 문자 기록 — 발송 내역 화면 맨 위 요약과 **같은 값·같은 말**(admin.notifications.summary.*). 키는 그 네임스페이스 기준이다. */
export type NotificationsHubLine = { kind: "unknown" } | { kind: "ok" } | { kind: "problems"; parts: { key: "failed" | "stuck" | "sentUnconfirmed"; n: number }[] };

export function notificationsLine(res: Settled<{ failed: number; stuck: number; sentUnconfirmed: number; ok: boolean }>): NotificationsHubLine {
  if (res.status !== "fulfilled") return { kind: "unknown" };
  const s = res.value;
  if (s.ok) return { kind: "ok" };
  const parts = (["failed", "stuck", "sentUnconfirmed"] as const).filter((k) => s[k] > 0).map((k) => ({ key: k, n: s[k] }));
  return parts.length === 0 ? { kind: "ok" } : { kind: "problems", parts };
}
