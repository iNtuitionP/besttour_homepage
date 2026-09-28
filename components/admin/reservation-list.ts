/**
 * 접수 목록 — 순수 모델 (P5-21 · 시안 docs/handoff/2026-09-27-admin-ux #list · 제안서 ⑤-2 · ⑦ 1-4).
 *
 * React·Next·DB·env·한글 리터럴 없음 — tests/admin-list.test.ts 가 그대로 부른다. 목록 화면(서버)과 '20건 더 보기'(클라이언트)가 함께 쓴다
 * — 그래서 서버 전용 모듈(lib/admin/*)을 가져오지 않는다.
 *
 * 탭 · 쪽 · 주소
 *   - 탭은 다섯(새 접수 · 확정 · 운행 완료 · 취소 · 전체). **기본 탭은 새 접수**다 — 쿼리 없는 `/admin/reservations` 가 새 접수를 보인다
 *     (메뉴 배지를 누르면 곧 그 숫자의 목록이다). 전체는 `?status=all` 로 명시한다.
 *   - 파서는 관대하다: 모르는 값·쓰레기값은 기본 탭·첫 쪽으로 떨어진다(주소창 오타로 화면이 500 이 되면 안 된다).
 *     조회 함수(lib/admin/reservations.ts listReservations)는 반대로 엄격하다.
 *   - 주소에는 **상태와 쪽만** 싣는다(제안서 ④ 원칙 7 — URL 에 개인정보 0). 상세로 가는 링크에는 uuid 와 들어온 탭·쪽만
 *     (P5-22 B-2 — detailHref · 상세의 "← 접수 목록" 이 그리로 돌아간다).
 *   - '20건 더 보기'는 다음 쪽 주소로 바꾸고(같은 탭), 화면은 **첫 줄부터 쪽 × 20 건**을 다시 그린다. 그래서 "끝을 넘은 쪽" 이 없다 —
 *     목록이 비었다면 그 탭에 정말 한 건도 없는 것이다(빈 상태 문장이 거짓이 되지 않는다 · P5-20 리뷰 P2-3 의 경우가 사라진다).
 *     한 번에 그리는 양의 상한은 MAX_LIST_PAGES 쪽이다(넘으면 거짓 없는 안내 — 검색은 2단계).
 *
 * 묶음 — 새 접수 탭은 72시간이 **넘은** 것을 "답이 늦은 접수" 묶음으로 맨 위에 둔다. 경계는 상태 배지·0022 와 같은 isOverdue 다
 * (딱 72시간은 아직 아니다).
 *
 * 확정 탭(P5-21 수정 라운드 · 리뷰 P1-1) — 쪽으로 넘기는 목록은 **다가오는 운행만**이다(출발 ≥ KST 오늘 00:00 = kstTodayStart · 출발이 가까운 순).
 * 운행일이 지난 확정(운행 완료로 바꾸지 않은 건)은 목록 위에 **따로 짧게** 보인다 — 건수와 최근 것부터 PAST_CONFIRMED_SHOWN 건.
 * 전에는 한 쿼리(출발 순)라 지난 확정이 쌓이면 쪽 1 을 다 차지해 다가오는 운행이 첫 화면에서 사라졌다(200건을 넘으면 아예 닿을 수 없었다).
 * 경계는 관리 홈 '이번 주 운행' 창의 시작과 같다(components/admin/dashboard.ts upcomingWindow) — 그 카드가 이 탭으로 보낸다.
 *
 * 번호 가운데 가림 — 목록 표시는 `010-****-0004`(사용자 결정). **어깨너머·캡처 노출을 줄이는 표시 규칙**이지 DOM 은닉이 아니다 —
 * 전화 버튼의 `tel:` 은 전체 번호다(관리자 전용 화면 · 제안서 ⑤-2 개인정보). 국내 휴대전화는 lib/mask.ts 의 공용 변환을 그대로 쓰고
 * (사본을 두지 않는다), 해외 번호(+ 로 시작하는 E.164)는 **'+' 와 끝 네 자리만** 보인다 — 국가번호와 길이도 가린다. 되걸려 온 전화의
 * 뒷자리로 행을 알아보는 데는 끝 네 자리면 되고, 국가번호를 가르려면 번호표가 필요해 짐작이 된다(짐작해서 일부를 내보내지 않는다).
 * 모르는 모양은 아무 숫자도 내보내지 않는다(***).
 *
 * 시각 — 경과("25분 전")와 날짜 조각은 **요청의 시각 하나(now)** 로 잰다(서버가 한 번 읽는다). 날짜는 KST 고정 +9 시간이다
 * (lib/kst.ts 와 같은 방식 — 서버 프로세스의 TZ 와 무관, 로컬 시간 getter 를 쓰지 않는다).
 */
import { maskPhone, maskStoredPhone } from "@/lib/mask";

import { isOverdue } from "./status-badge";

export const LIST_TABS = ["new", "confirmed", "done", "cancelled", "all"] as const;
export type ListTab = (typeof LIST_TABS)[number];
export const DEFAULT_LIST_TAB: ListTab = "new";

export const LIST_PATH = "/admin/reservations";
/** '더 보기' 한 번에 늘어나는 행 수. */
export const LIST_PAGE_SIZE = 20;
/** 한 번에 그리는 쪽의 상한 — 쪽 × 20 건을 첫 줄부터 다시 읽으므로 끝없이 늘리지 않는다(검색은 2단계). */
export const MAX_LIST_PAGES = 10;
/** 확정 탭 위의 '운행일이 지난 확정' 칸에 보이는 건수(최근 것부터) — 나머지는 건수로만 말한다. */
export const PAST_CONFIRMED_SHOWN = 5;

/** `?status=` → 탭. 모르는 값이면 기본 탭(새 접수). */
export function parseListTab(raw: unknown): ListTab {
  return typeof raw === "string" && (LIST_TABS as readonly string[]).includes(raw) ? (raw as ListTab) : DEFAULT_LIST_TAB;
}

/** `?page=` → 쪽(1 부터). 정수가 아니거나 1 보다 작으면 1, 상한을 넘으면 상한. */
export function parseListPage(raw: unknown): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return 1;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) return 1;
  return n > MAX_LIST_PAGES ? MAX_LIST_PAGES : n;
}

/** 목록 주소 — 상태·쪽만. 기본 탭의 첫 쪽은 쿼리 없음. */
export function listHref(tab: ListTab, page = 1): string {
  const qs = new URLSearchParams();
  if (tab !== DEFAULT_LIST_TAB) qs.set("status", tab);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `${LIST_PATH}?${s}` : LIST_PATH;
}

/**
 * 상세로 가는 주소(P5-22 · P5-21 리뷰 P2-13 · 브리프 B-2) — uuid 경로에, 들어온 **탭·쪽**을 `?from=` · `&page=` 로 싣는다(기본 탭의 첫 쪽이면 쿼리 없음).
 * 상세의 "← 접수 목록" 이 그 탭·쪽으로 돌아간다(backToListHref). 상태·쪽은 개인정보가 아니다 — 주소에 이름·번호는 여전히 0 이다.
 * 브라우저 뒤로 가기 대신 이 길을 고른 이유는 보고서 ⑥: 링크가 늘 "접수 목록" 으로 간다(관리 홈에서 들어와도 거짓이 되지 않는다) ·
 * 서버가 그리므로 JS 없이도 · 새로고침 뒤에도 같다 · 주소가 곧 상태라 시험할 수 있다.
 */
export function detailHref(id: string, from?: { tab: ListTab; page: number } | null): string {
  const qs = new URLSearchParams();
  if (from && from.tab !== DEFAULT_LIST_TAB) qs.set("from", from.tab);
  if (from && from.page > 1) qs.set("page", String(from.page));
  const s = qs.toString();
  return s ? `${LIST_PATH}/${id}?${s}` : `${LIST_PATH}/${id}`;
}

/**
 * 상세의 "← 접수 목록" 주소 — 상세 주소의 `from`·`page` 를 목록 파서(관대 — 모르는 값은 기본 탭·첫 쪽)로 읽어 목록 주소(listHref — 상태·쪽만)로.
 * 같은 이름이 여러 번 오면(배열) 믿지 않는다 · 다른 키는 되울리지 않는다.
 */
export function backToListHref(query: Readonly<Record<string, string | string[] | undefined>> | null | undefined): string {
  const one = (v: string | string[] | undefined): string | undefined => (typeof v === "string" ? v : undefined);
  return listHref(parseListTab(one(query?.from)), parseListPage(one(query?.page)));
}

/** 쪽 → 읽을 행 수(첫 줄부터). */
export function listLimit(page: number): number {
  return page * LIST_PAGE_SIZE;
}

/** 그 쪽의 첫 행이 목록에서 몇 번째인가(0 부터) — '더 보기' 뒤 포커스를 둘 자리. */
export function firstRowIndexOfPage(page: number): number {
  return (page - 1) * LIST_PAGE_SIZE;
}

// =============================================================================
// 묶음
// =============================================================================

/** overdue = 답이 늦은 접수(72시간 넘음) · waiting = 그 밖의 새 접수 · plain = 묶지 않음(확정 탭의 지난 운행은 묶음이 아니라 따로 읽는 칸이다). */
export type ListGroupKind = "overdue" | "waiting" | "plain";

export interface ListItem<T> {
  row: T;
  /** 읽어 온 목록에서의 자리(0 부터) — 묶어도 바뀌지 않는다. */
  index: number;
}

export interface ListGroup<T> {
  kind: ListGroupKind;
  items: ListItem<T>[];
}

/** 두 묶음으로 가른다 — 앞 묶음이 없으면 묶지 않고(plain), 뒤 묶음이 없으면 앞 묶음 하나. 묶음 안의 순서는 읽어 온 순서 그대로다. */
function split<T>(items: ListItem<T>[], first: ListGroupKind, rest: ListGroupKind, isFirst: (it: ListItem<T>) => boolean): ListGroup<T>[] {
  const a = items.filter(isFirst);
  if (a.length === 0) return [{ kind: "plain", items }];
  const b = items.filter((it) => !isFirst(it));
  return b.length === 0 ? [{ kind: first, items: a }] : [{ kind: first, items: a }, { kind: rest, items: b }];
}

export function groupListRows<T extends { created_at: string }>(tab: ListTab, rows: readonly T[], now: Date): ListGroup<T>[] {
  const items = rows.map((row, index) => ({ row, index }));
  if (items.length === 0) return [];
  if (tab === "new") return split(items, "overdue", "waiting", (it) => isOverdue(it.row.created_at, now));
  return [{ kind: "plain", items }];
}

// =============================================================================
// 경과 · KST 날짜
// =============================================================================

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

export type Elapsed = { unit: "justNow" } | { unit: "minutes" | "hours" | "days"; n: number };

/** 접수 뒤 지난 시간 — 1분 안(또는 시계가 어긋난 미래)은 방금 · 분 · 시간 · 날(24시간 단위 내림 — 배지의 N일째와 같은 계산). */
export function elapsedSince(iso: string, now: Date): Elapsed | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const age = now.getTime() - t;
  if (age < MINUTE_MS) return { unit: "justNow" };
  if (age < HOUR_MS) return { unit: "minutes", n: Math.floor(age / MINUTE_MS) };
  if (age < DAY_MS) return { unit: "hours", n: Math.floor(age / HOUR_MS) };
  return { unit: "days", n: Math.floor(age / DAY_MS) };
}

export interface KstParts {
  /** KST 달력 날짜 `YYYY-MM-DD`. */
  dateKey: string;
  year: number;
  month: number;
  day: number;
  /** 0 = 일요일 … 6 = 토요일. */
  weekday: number;
  /** 두 자리 `HH` · `mm`. */
  hour: string;
  minute: string;
}

/** 인스턴트(ISO 문자열 또는 Date) → KST 날짜 조각. 읽을 수 없으면 null. */
export function kstParts(value: string | Date): KstParts | null {
  const t = typeof value === "string" ? Date.parse(value) : value.getTime();
  if (!Number.isFinite(t)) return null;
  const shifted = new Date(t + KST_OFFSET_MS);
  const iso = shifted.toISOString();
  return {
    dateKey: iso.slice(0, 10),
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: iso.slice(11, 13),
    minute: iso.slice(14, 16),
  };
}

function dayIndex(dateKey: string): number {
  return Math.round(Date.parse(`${dateKey}T00:00:00.000Z`) / DAY_MS);
}

/** 출발(또는 어떤 인스턴트)의 KST 날짜 − 지금의 KST 날짜(일). 오늘 0 · 내일 1 · 어제 -1. 읽을 수 없으면 null. */
export function kstDayDiff(iso: string, now: Date): number | null {
  const a = kstParts(iso);
  const b = kstParts(now);
  if (a === null || b === null) return null;
  return dayIndex(a.dateKey) - dayIndex(b.dateKey);
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** KST 달력 날짜의 00:00 이 되는 인스턴트(ISO · UTC). 형식이 아니면 던진다(호출부는 kstParts 의 dateKey 를 넘긴다). */
export function kstDayStart(dateKey: string): string {
  const m = DATE_KEY.exec(dateKey);
  if (!m) throw new Error(`kstDayStart: expected YYYY-MM-DD, got "${dateKey}"`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KST_OFFSET_MS).toISOString();
}

/** KST 달력 날짜에서 n 일 뒤(앞)의 날짜. */
export function addDaysToKey(dateKey: string, n: number): string {
  const m = DATE_KEY.exec(dateKey);
  if (!m) throw new Error(`addDaysToKey: expected YYYY-MM-DD, got "${dateKey}"`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10);
}

/**
 * KST 달력의 오늘 00:00(ISO · UTC) — 확정 탭의 경계(이보다 앞 출발 = 운행일이 지난 확정 · 같거나 뒤 = 다가오는 운행).
 * 오늘 이미 출발한 운행(시각이 지났어도)은 다가오는 쪽이다. 관리 홈 '이번 주 운행' 창의 시작과 같은 값이다(dashboard.ts upcomingWindow 가 이것을 쓴다).
 */
export function kstTodayStart(now: Date): string {
  const p = kstParts(now);
  if (p === null) throw new Error("kstTodayStart: invalid now");
  return kstDayStart(p.dateKey);
}

/**
 * 여러 날 운행의 박 수 — 돌아오는 날(return_at)과 출발일의 **KST 달력** 차이(리뷰 P2-3). 1박 이상일 때만 수, 그 밖(당일 · 돌아오는 날 없음 ·
 * 거꾸로 · 읽을 수 없음)은 null — 기간을 지어내지 않는다. 간편 접수는 날짜만 받으므로(00:00 자리값) 달력 차이가 곧 박 수다.
 */
export function stayNights(departIso: string, returnIso: string | null): number | null {
  if (returnIso === null) return null;
  const a = kstParts(departIso);
  const b = kstParts(returnIso);
  if (a === null || b === null) return null;
  const nights = dayIndex(b.dateKey) - dayIndex(a.dateKey);
  return nights >= 1 ? nights : null;
}

// =============================================================================
// 번호 가림 · 전화 버튼
// =============================================================================

const MASKED_FALLBACK = "***";
const E164 = /^\+[1-9]\d{6,14}$/;
const KR_MOBILE_DOMESTIC = /^01\d-?\d{3,4}-?\d{4}$/;

/** 목록 표시용 번호 — 국내 휴대전화 `010-****-0004` · 해외(E.164) `+****-4567` · 국내 표기 옛 값은 국내 규칙 · 모르는 모양 `***`. */
export function listPhoneText(stored: string): string {
  const v = (stored ?? "").trim();
  if (v.startsWith("+82")) {
    const kr = maskStoredPhone(v);
    if (kr !== MASKED_FALLBACK) return kr;
  }
  const compact = v.replace(/[\s-]/g, "");
  if (E164.test(compact)) return `+****-${compact.slice(-4)}`;
  if (KR_MOBILE_DOMESTIC.test(v)) return maskPhone(v);
  return MASKED_FALLBACK;
}

/**
 * 전화 버튼 — 전체 번호(숫자와 + 만). 숫자가 하나도 없으면 null — 버튼을 그리지 않는다(리뷰 P2-9: `tel:` 만 남은 링크는 누르면 아무 데도 안 간다).
 * 저장값은 늘 E.164 라 지금은 닿지 않는 가드다(DB 가 phone not null 이고 접수가 정규화한다).
 */
export function telHref(stored: string): string | null {
  const dial = (stored ?? "").replace(/[^0-9+]/g, "");
  return /\d/.test(dial) ? `tel:${dial}` : null;
}
