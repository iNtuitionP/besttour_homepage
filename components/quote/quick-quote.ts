/**
 * 홈 간편 견적 — 순수 로직 (P3-8). React·DOM·env 없음 — tests/quick-quote.test.ts 가 직접 돌린다.
 *
 * 흐름: 위젯(출발지·도착지·출발일·도착일·인원) → [견적 신청하기] → validateWidget 이 빈 칸·잘못된 칸을 **그 자리에서** 알린다
 * (모달을 열지 않는다) → 통과하면 모달(이름·연락처·동의 2종·Turnstile) → 서버액션 submitReservation.
 * 검증은 서버 zod(lib/types.ts quickReservationSchema)의 규칙을 사람에게 먼저 보여 주는 **사전 검사**다. 서버가 최종이다.
 *
 * 클라이언트 번들 위생: lib/types(zod)를 import 하지 않는다 — 휴대폰 패턴·달력 판정은 복제하고 tests/quick-quote.test.ts 가
 * 원본과의 `.source` 동일성·같은 입력에 같은 답을 단언한다. lib/codes 는 순수 상수라 가져온다(옛 위저드와 같다).
 *
 * 오류의 messageKey 는 messages 의 **절대 키**다 — 위젯은 home.hero.widget.errors.*, 모달은 quote.modal.errors.*.
 */
import { isLocationCode } from "@/lib/codes";
import type { SubmitResult } from "@/lib/reservations/submitResult";

// =============================================================================
// 상수 — 서버 규칙과 같은 값 (tests/quick-quote.test.ts 가 lib/types 와 대조)
// =============================================================================

export const NAME_MAX_LENGTH = 30;
export const PASSENGERS_RANGE = { min: 1, max: 900 } as const;

/** = lib/types PHONE_KR_PATTERN (국내 01x, 하이픈 선택). */
export const PHONE_KR_INPUT_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;
/** = lib/types PHONE_INTL_PATTERN (E.164). */
export const PHONE_INTL_INPUT_PATTERN = /^\+[1-9]\d{6,14}$/;
export const PHONE_KR_MAX_DIGITS = 11;
export const ISO_DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// =============================================================================
// 위젯 — 출발지 · 도착지 · 출발일 · 도착일 · 인원
// =============================================================================

export interface WidgetFields {
  originCode: string;
  destinationCode: string;
  /** `YYYY-MM-DD` — `<input type="date">` 값 그대로(KST 달력 날짜로 해석된다). */
  departDate: string;
  returnDate: string;
  /** 입력칸 문자열 그대로 — 숫자 변환은 검증 뒤. */
  passengers: string;
}

export type WidgetField = keyof WidgetFields;

export interface FieldError {
  /** 폼 필드 키(= 서버 fieldErrors 키). 포커스·표시 위치에 쓴다. */
  field: string;
  /** messages 절대 키. */
  messageKey: string;
}

const W = "home.hero.widget.errors";

/** `YYYY-MM-DD` 가 달력에 실제로 있는가 (= lib/types isCalendarDate). */
export function isCalendarDate(iso: string): boolean {
  if (!ISO_DATE_INPUT_PATTERN.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const rt = new Date(Date.UTC(y, m - 1, d));
  return rt.getUTCFullYear() === y && rt.getUTCMonth() === m - 1 && rt.getUTCDate() === d;
}

function isIntIn(s: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(s.trim())) return false;
  const n = Number(s.trim());
  return n >= min && n <= max;
}

/**
 * 위젯 검증 — 빈 칸·잘못된 칸마다 오류 하나. 빈 배열이면 모달을 연다.
 * `today` 는 KST 오늘(`YYYY-MM-DD`) — 호출부가 lib/kst toKstDateString(new Date()) 로 만든다(서버도 같은 규칙으로 거부한다).
 */
export function validateWidget(f: WidgetFields, today: string): FieldError[] {
  const errors: FieldError[] = [];
  const push = (field: WidgetField, key: string) => errors.push({ field, messageKey: `${W}.${key}` });

  if (!isLocationCode(f.originCode)) push("originCode", "origin");
  if (!isLocationCode(f.destinationCode)) push("destinationCode", "dest");

  const departOk = isCalendarDate(f.departDate);
  if (!departOk) push("departDate", "departDate");
  else if (today !== "" && f.departDate < today) push("departDate", "departPast");

  const returnOk = isCalendarDate(f.returnDate);
  if (!returnOk) push("returnDate", "returnDate");
  else if (departOk && f.returnDate < f.departDate) push("returnDate", "returnBefore");

  if (!isIntIn(f.passengers, PASSENGERS_RANGE.min, PASSENGERS_RANGE.max)) push("passengers", "pax");
  return errors;
}

/**
 * 출발일을 고르면 도착일을 같은 날로 채운다(브리프 §C) — 도착일이 비었거나 새 출발일보다 앞일 때만.
 * 이미 뒤 날짜를 고른 사람의 도착일은 지우지 않는다.
 */
export function withDepartDate(f: WidgetFields, departDate: string): WidgetFields {
  const fill = f.returnDate === "" || (isCalendarDate(departDate) && f.returnDate < departDate);
  return { ...f, departDate, returnDate: fill ? departDate : f.returnDate };
}

// =============================================================================
// 모달 — 이름 · 연락처(한 칸: `+` 로 시작하면 해외 번호)
// =============================================================================

export interface ContactFields {
  name: string;
  /** 한 입력칸. `+` 로 시작하면 phoneIntl(E.164), 아니면 국내 휴대전화(phone). */
  phone: string;
}

const M = "quote.modal.errors";

/** 목업 phoneInput 의 자동 하이픈 — 숫자만 남기고 3-4-4, 11자리 초과는 자른다. */
export function formatKrPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, PHONE_KR_MAX_DIGITS);
  if (d.length > 7) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length > 3) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}

/** 입력 중 정리 — `+` 로 시작하면 `+` 와 숫자만(해외), 아니면 국내 3-4-4 자동 하이픈. */
export function formatPhoneInput(raw: string): string {
  const t = raw.trimStart();
  if (t.startsWith("+")) return `+${t.slice(1).replace(/\D/g, "")}`;
  return formatKrPhone(t);
}

/** 한 칸 → 서버 계약의 둘(phone XOR phoneIntl). 정확히 하나만 값이 있다(빈 칸은 ""). */
export function splitPhone(raw: string): { phone: string; phoneIntl: string } {
  const t = raw.trim();
  if (t === "") return { phone: "", phoneIntl: "" };
  if (t.startsWith("+")) return { phone: "", phoneIntl: `+${t.slice(1).replace(/\D/g, "")}` };
  return { phone: t, phoneIntl: "" };
}

export function validateContact(c: ContactFields): FieldError[] {
  const errors: FieldError[] = [];
  const name = c.name.trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) errors.push({ field: "name", messageKey: `${M}.name` });
  const { phone, phoneIntl } = splitPhone(c.phone);
  if (phoneIntl !== "") {
    if (!PHONE_INTL_INPUT_PATTERN.test(phoneIntl)) errors.push({ field: "phone", messageKey: `${M}.phoneIntl` });
  } else if (!PHONE_KR_INPUT_PATTERN.test(phone)) {
    errors.push({ field: "phone", messageKey: `${M}.phone` });
  }
  return errors;
}

/** 서버 fieldErrors 의 키 — 위젯 칸(출발지·도착지·날짜·인원)인가, 모달 칸(이름·연락처·동의)인가. */
const WIDGET_SERVER_FIELDS: ReadonlySet<string> = new Set(["originCode", "destinationCode", "departDate", "returnDate", "passengers"]);
export function isWidgetField(field: string): field is WidgetField {
  return WIDGET_SERVER_FIELDS.has(field);
}
/** 서버 fieldErrors 키 phone·phoneIntl 은 모달의 한 칸(phone)으로 모인다. */
export function modalFieldOf(field: string): string {
  return field === "phoneIntl" ? "phone" : field;
}

// =============================================================================
// 요약 — "이 내용으로 견적 신청하기" 의 출발→도착 · 날짜 · 인원
// =============================================================================

/** 같은 날이면 한 날짜(당일), 다르면 범위. 표시 형식(`YYYY-MM-DD`)은 입력값 그대로 — 변환하지 않는다. */
export function dateSpan(f: Pick<WidgetFields, "departDate" | "returnDate">): { kind: "single"; date: string } | { kind: "range"; from: string; to: string } {
  return f.departDate === f.returnDate || f.returnDate === ""
    ? { kind: "single", date: f.departDate }
    : { kind: "range", from: f.departDate, to: f.returnDate };
}

// =============================================================================
// 수정 라운드 (P3-8 리뷰 P2-1 · P2-10 · P2-11)
// =============================================================================

/** 위젯의 처음 상태 — 기본 출발·도착만 두고 날짜·인원은 비운다. 접수 성공 뒤 이 상태로 되돌린다(같은 내용 재접수 방지 · P2-11). */
export function initialWidgetFields(defaults: { origin: string; dest: string }): WidgetFields {
  return { originCode: defaults.origin, destinationCode: defaults.dest, departDate: "", returnDate: "", passengers: "" };
}

/**
 * 서버 결과가 "새 폼 토큰이 있어야 다시 낼 수 있다" 인가 (P2-1).
 * `bot` 은 타임트랩(토큰 만료 1시간 · 위조 · 너무 빠름)이다 — 같은 토큰으로는 몇 번을 다시 내도 같은 결과다.
 * 그래서 모달이 토큰을 새로 받는다. 다른 실패는 토큰과 무관하다(Turnstile 은 결과마다 따로 리셋한다).
 * 결과 타입은 `import type` 으로만 가져온다(런타임 import 0 — 번들 위생).
 */
export function needsFreshFormToken(result: SubmitResult): boolean {
  return !result.ok && result.code === "bot";
}

/** inertBackground 가 쓰는 요소 모양 — DOM 의 HTMLElement 가 만족한다(테스트는 가짜 요소로 돈다). */
export interface InertTarget {
  /** 대문자(HTML DOM). script·style 같은 보이지 않는 요소는 건너뛴다 — Next 가 body 에 흘리는 RSC 스크립트가 수십 개다. */
  readonly tagName: string;
  parentElement: InertTarget | null;
  readonly children: ArrayLike<InertTarget>;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * 모달이 열려 있는 동안 **배경 전부**를 `inert` 로 만든다(P2-10). 스크린리더가 aria-modal 을 무시해도 배경을 읽거나 누를 수 없다.
 * 대화상자(`dialog`)에서 `stop`(보통 body)까지 올라가며 **조상은 두고 그 형제들만** inert 를 건다 —
 * 조상에 걸면 대화상자까지 inert 가 된다(모달이 위젯 안에 그려지므로 포털이 아니다).
 * 이미 inert 였던 요소는 건드리지 않고, 되돌릴 때도 풀지 않는다. 돌려주는 함수가 건 것만 푼다.
 */
const NOT_RENDERED = new Set(["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"]);

export function inertBackground<T extends InertTarget>(dialog: T, stop: T): () => void {
  const marked: InertTarget[] = [];
  let node: InertTarget | null = dialog;
  while (node && node !== stop && node.parentElement) {
    const parent: InertTarget = node.parentElement;
    for (let i = 0; i < parent.children.length; i++) {
      const sibling = parent.children[i];
      if (sibling === node || sibling.hasAttribute("inert") || NOT_RENDERED.has(sibling.tagName.toUpperCase())) continue;
      sibling.setAttribute("inert", "");
      marked.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const el of marked) el.removeAttribute("inert");
  };
}
