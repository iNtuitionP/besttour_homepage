/**
 * 접수 상세 — 순수 계산 (P5-22 · 시안 docs/handoff/2026-09-27-admin-ux #detail · 제안서 ⑤-3).
 *
 * React·Next·DB·env·한글 리터럴 없음 — tests/admin-detail-panel.test.ts 가 그대로 부른다. 화면(app/admin/(protected)/reservations/[id]/page.tsx)은
 * 서버 컴포넌트이고, 여기서 받은 조각을 카탈로그 틀(admin.detail.* · admin.dates.*)에 채워 그린다.
 *
 * 규칙
 *   - 시각은 KST 달력이다(서버 프로세스의 TZ 와 무관 — reservation-list.ts kstParts 의 고정 +9 시간). "오늘" 은 요청의 시각 하나(now)로 잰다.
 *   - 상세는 **전화를 거는 화면**이라 번호를 가리지 않는다(목록·관리 홈과 다르다 — 매뉴얼 3장). 국내 휴대전화만 읽기 좋은 국내 표기로 바꾸고,
 *     그 밖(해외 번호 · 유선 · 모르는 모양)은 저장값 그대로 둔다 — 짐작해서 바꾸지 않는다. `tel:`·`sms:` 는 숫자와 + 만.
 *   - 개인정보를 들고 있지 않는다 — 부르는 쪽(서버 화면)이 값을 넘기고 결과를 곧바로 그린다(어떤 부품의 props 에도 싣지 않는다).
 */
import { kstParts } from "./reservation-list";

/** 제목 틀 "{name} 님" 을 이름 앞·뒤로 나눈다 — 이름은 화면이 id 요소(시트가 읽는 자리) 안에 따로 그린다. 틀이 아니면 앞·뒤 모두 빈 글자. */
export function splitNameTemplate(tpl: unknown): { before: string; after: string } {
  if (typeof tpl !== "string") return { before: "", after: "" };
  const at = tpl.indexOf("{name}");
  if (at < 0) return { before: "", after: "" };
  return { before: tpl.slice(0, at), after: tpl.slice(at + "{name}".length) };
}

const KR_MOBILE = /^01\d{8,9}$/;

/** 상세의 큰 번호 — `+8210…` 휴대전화는 `010-1234-5678`(3-4-4 · 10자리는 3-3-4), 그 밖은 저장값 그대로(양끝 공백만 걷는다). */
export function detailPhoneText(stored: string): string {
  const v = (stored ?? "").trim();
  if (v.startsWith("+82")) {
    const domestic = `0${v.replace(/\D/g, "").slice(2)}`;
    if (KR_MOBILE.test(domestic)) {
      return domestic.length === 11
        ? `${domestic.slice(0, 3)}-${domestic.slice(3, 7)}-${domestic.slice(7)}`
        : `${domestic.slice(0, 3)}-${domestic.slice(3, 6)}-${domestic.slice(6)}`;
    }
  }
  return v;
}

/** 문자 보내기 — 전체 번호(숫자와 + 만). 숫자가 하나도 없으면 null — 버튼을 그리지 않는다(reservation-list.ts telHref 와 같은 규칙). */
export function smsHref(stored: string): string | null {
  const dial = (stored ?? "").replace(/[^0-9+]/g, "");
  return /\d/.test(dial) ? `sms:${dial}` : null;
}

/** 접수 시각 — KST 오늘이면 시각만 · 올해면 월·일 · 해가 다르면 연도까지. 읽을 수 없으면 null. */
export type ReceivedAt =
  | { kind: "today"; hour: string; minute: string }
  | { kind: "date"; month: number; day: number; hour: string; minute: string }
  | { kind: "year"; year: number; month: number; day: number; hour: string; minute: string };

export function receivedAt(createdIso: string, now: Date): ReceivedAt | null {
  const p = kstParts(createdIso);
  const n = kstParts(now);
  if (p === null || n === null) return null;
  if (p.dateKey === n.dateKey) return { kind: "today", hour: p.hour, minute: p.minute };
  if (p.year === n.year) return { kind: "date", month: p.month, day: p.day, hour: p.hour, minute: p.minute };
  return { kind: "year", year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute };
}

/** 운행 날짜 조각(가는 날 · 오는 날) — KST 달력 · 요일(0 = 일요일) · 해가 지금과 다르면 withYear. 읽을 수 없으면 null. */
export interface DayParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: string;
  minute: string;
  withYear: boolean;
}

export function dayParts(iso: string, now: Date): DayParts | null {
  const p = kstParts(iso);
  const n = kstParts(now);
  if (p === null || n === null) return null;
  return { year: p.year, month: p.month, day: p.day, weekday: p.weekday, hour: p.hour, minute: p.minute, withYear: p.year !== n.year };
}
