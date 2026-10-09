/**
 * 대표 노선 입력 검증 · 결과 타입 — 순수 모듈 (플랜 v4 P5-6 · ADR-4).
 *
 * **가격 규칙 (CLAUDE.md §3).** showcase_routes.price_from 은 사장님이 직접 적어 넣는 **정적 표시값**이다.
 * 이 모듈이 하는 일은 "그 값이 DB 에 들어갈 수 있는 정수인가" 를 보는 것뿐이고, 값을 **만들지 않는다** —
 * 배율·거리당 단가·할인·합계 같은 유도 연산이 여기에도, 이 탭 어디에도 없다.
 * tests/admin-routes.test.ts 가 이 파일에서 산술 연산자가 숫자와 붙는 것을 금지한다(상한 비교만 남는다).
 *
 * **빈 값의 뜻.** 가격을 비우면 `null` 이고, 그것이 P2-2 의 라벨 숨김 폴백의 입력이다 —
 * 홈은 그 노선의 금액 라벨만 감추고 노선·핀은 그대로 그린다. "0 원" 이 아니라 "아직 값이 없다" 는 뜻이므로
 * 0 과 음수는 거부한다(0001 의 `check (price_from is null or price_from > 0)` 와 같은 조건).
 *
 * **코드만 저장한다.** 출발·도착은 0002 가 `places(code)` 로 FK 를 걸었다 — 카탈로그 밖의 코드(시도 코드 GG·GW 등)는
 * 쓰기가 FK 위반으로 통째로 실패한다. 그래서 받는 집합은 `LOCATION_CODES`(접수 폼용 28개)가 아니라
 * **`PLACES` 의 17개**다. 번역 문자열("서울")은 저장하지 않는다(CLAUDE.md §3).
 *
 * 사용자에게 보일 문구는 여기 없다(한글 리터럴 0). zod 메시지는 개발자용이라 ASCII 로 적는다.
 */
import { z } from "zod";

import { PLACES, isLocationCode, locationLabelKo, type LocationCode } from "../codes";

/** 폼 필드 이름 — 화면·액션·테스트가 같은 문자열을 쓴다. */
export const ROUTE_FIELDS = {
  id: "id",
  originCode: "originCode",
  destinationCode: "destinationCode",
  priceFrom: "priceFrom",
  sort: "sort",
  active: "active",
} as const;
export type RouteField = keyof typeof ROUTE_FIELDS;

/**
 * 노선이 가리킬 수 있는 장소 코드 — 0002 의 FK 대상(`places`)과 같은 집합.
 * 표시 순서는 카탈로그의 sort 다(인천공항 → 서울 → 스펙 §13.2 도착지 순서).
 */
export const ROUTE_PLACE_CODES: readonly string[] = [...PLACES].sort((a, b) => a.sort - b.sort).map((p) => p.code);

const ROUTE_PLACE_CODE_SET: ReadonlySet<string> = new Set(ROUTE_PLACE_CODES);

export function isRoutePlaceCode(value: string): boolean {
  return ROUTE_PLACE_CODE_SET.has(value);
}

/** 표시용 한글 라벨 — lib/codes.ts 카탈로그에서만 온다(표시 전용, DB 저장 금지). */
export function routePlaceLabel(code: string): string {
  return isLocationCode(code) ? locationLabelKo(code as LocationCode) : code;
}

/** 0001 의 컬럼 타입이 int(=int4)다. 상한은 DB 가 정한 사실이고, 여기서 만든 값이 아니다. */
const INT4_MAX = 2147483647;
/** 표시 가격의 상한 — int4 그대로. 이 숫자는 한계이지 기준값이 아니다(어떤 가격도 이 파일에서 나오지 않는다). */
export const ROUTE_PRICE_MAX = INT4_MAX;
/** 정렬은 16개를 줄 세우는 번호다. 네 자리면 충분하고, 그 이상은 오타로 본다. */
export const ROUTE_SORT_MAX = 9999;

const DIGITS = /^[0-9]+$/;

export interface RouteValues {
  originCode: string;
  destinationCode: string;
  /** 사장님이 적은 표시 가격(원). 비우면 null = 라벨 숨김 폴백. */
  priceFrom: number | null;
  /** 홈 카드·지도의 나열 순서. 비우면 null(뒤로 밀린다). */
  sort: number | null;
  active: boolean;
}

/**
 * "" → null(값 없음), 숫자만 있는 문자열 → 정수, 그 밖(소수·부호·콤마·지수·문자) → NaN.
 * NaN 을 돌려주는 이유: zod 의 `z.number()` 가 NaN 을 거부하므로 **필드 경로가 그대로 보존된 검증 실패**가 된다
 * (여기서 던지면 어느 칸이 틀렸는지 화면이 표시할 수 없다).
 */
function optionalInteger(raw: string): number | null {
  if (raw === "") return null;
  if (!DIGITS.test(raw)) return NaN;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : NaN;
}

export const RouteInput = z
  .object({
    originCode: z.string(),
    destinationCode: z.string(),
    priceFrom: z.number().nullable(),
    sort: z.number().nullable(),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!isRoutePlaceCode(v.originCode)) {
      ctx.addIssue({ code: "custom", path: ["originCode"], message: "originCode must be a place code (0002 FK)" });
    }
    if (!isRoutePlaceCode(v.destinationCode)) {
      ctx.addIssue({ code: "custom", path: ["destinationCode"], message: "destinationCode must be a place code (0002 FK)" });
    } else if (v.destinationCode === v.originCode) {
      ctx.addIssue({ code: "custom", path: ["destinationCode"], message: "origin and destination must differ" });
    }
    if (v.priceFrom !== null && !(Number.isInteger(v.priceFrom) && v.priceFrom > 0 && v.priceFrom <= ROUTE_PRICE_MAX)) {
      ctx.addIssue({ code: "custom", path: ["priceFrom"], message: "priceFrom must be empty or a positive integer within int4" });
    }
    if (v.sort !== null && !(Number.isInteger(v.sort) && v.sort >= 0 && v.sort <= ROUTE_SORT_MAX)) {
      ctx.addIssue({ code: "custom", path: ["sort"], message: "sort must be empty or a non-negative integer" });
    }
  });

/** 화면이 문구 키로 쓰는 결과 어휘 — messages/ko.json `admin.routes.result.*`. */
export type RouteActionCode = "updated" | "activated" | "deactivated" | "notFound" | "duplicate" | "validation" | "failed";

export interface RouteActionResult {
  /** 사장님에게 빨간 오류를 보일 것인가. */
  ok: boolean;
  /** DB 가 실제로 바뀌었는가. 캐시 무효화는 이것이 true 일 때만. */
  changed: boolean;
  code: RouteActionCode;
  /** 어느 입력을 고쳐야 하는지 표시만 한다(문구는 화면 몫). */
  fieldErrors?: Partial<Record<RouteField, true>>;
}

export const ROUTE_FAILED: RouteActionResult = { ok: false, changed: false, code: "failed" };
export const ROUTE_NOT_FOUND: RouteActionResult = { ok: false, changed: false, code: "notFound" };
/** 같은 출발·도착 쌍이 이미 있다 — 0001 의 `unique (origin_code, destination_code)`. */
export const ROUTE_DUPLICATE: RouteActionResult = { ok: false, changed: false, code: "duplicate" };

/** 성공 결과 — changed 는 언제나 true 다(바뀐 것이 없으면 notFound 로 끝난다). */
export const routeChanged = (code: RouteActionCode): RouteActionResult => ({ ok: true, changed: true, code });

export function routeValidationFailed(fieldErrors: Partial<Record<RouteField, true>>): RouteActionResult {
  return { ok: false, changed: false, code: "validation", fieldErrors };
}

/** 체크박스는 켜져 있을 때만 값이 온다. */
function isChecked(raw: FormDataEntryValue | null): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

const text = (raw: FormDataEntryValue | null): string => (typeof raw === "string" ? raw : "");

export type ParsedRouteForm = { ok: true; value: RouteValues } | { ok: false; result: RouteActionResult };

/** FormData → 값. 실패는 필드별 표시가 붙은 결과로 돌려준다(예외를 던지지 않는다). */
export function parseRouteForm(formData: FormData): ParsedRouteForm {
  const parsed = RouteInput.safeParse({
    // 코드는 canonical 그대로 받는다 — 공백·대소문자를 관대하게 보지 않는다(lib/codes.ts isLocationCode 와 같은 규약).
    originCode: text(formData.get(ROUTE_FIELDS.originCode)),
    destinationCode: text(formData.get(ROUTE_FIELDS.destinationCode)),
    priceFrom: optionalInteger(text(formData.get(ROUTE_FIELDS.priceFrom)).trim()),
    sort: optionalInteger(text(formData.get(ROUTE_FIELDS.sort)).trim()),
    active: isChecked(formData.get(ROUTE_FIELDS.active)),
  });

  if (!parsed.success) {
    const fieldErrors: Partial<Record<RouteField, true>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && field in ROUTE_FIELDS) fieldErrors[field as RouteField] = true;
    }
    return { ok: false, result: routeValidationFailed(fieldErrors) };
  }
  return { ok: true, value: parsed.data };
}

/** 경로·폼으로 들어온 id → 양의 정수. 아니면 null(DB 를 부르지 않는다). */
export function parseRouteId(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 && raw <= INT4_MAX ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n <= INT4_MAX ? n : null;
}
