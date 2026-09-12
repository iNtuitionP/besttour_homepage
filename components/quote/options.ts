/**
 * 위저드 선택지·입력 규칙 — 순수 (P3-4). 라벨은 여기 없다(messages/ko.json quote.*). 값은 코드다.
 *
 *   - CONTACT_METHODS: 목업의 "이메일로 견적 받기"(email)는 **숨긴다** — 메일 발송 경로가 없다(UIUX 브리프 §3-⑤, P4-5 후 복구).
 *     HIDDEN_CONTACT_METHODS 에 그 사실을 남겨 둔다(복구할 때 여기서 옮기면 된다).
 *   - PAYMENT_METHODS: 현금 · 카드 · 세금계산서발행(목업 순서). 서버는 자유 문자열로 받지만 번역 문자열이 아니라 코드를 저장한다.
 *   - 장소 그룹: 도시(PLACES, 카탈로그 순) 먼저, 그 다음 카탈로그에 없는 시도 11개 — 합집합이 LOCATION_CODES 28개다.
 *   - 휴대폰 패턴은 lib/types 의 PHONE_KR_PATTERN·PHONE_INTL_PATTERN 과 같은 정규식이다. lib/types 를 import 하면 zod 가 클라이언트
 *     번들에 실리므로 소스를 복제하고 tests/quote-wizard.test.ts 가 `.source` 동일성을 단언한다.
 */
import { LOCATION_CODES, PLACES, REGIONS, type LocationCode } from "@/lib/codes";

export const CONTACT_METHODS = ["mobile", "phone", "fax"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];
/** 목업에는 있었지만 지금은 렌더하지 않는 선택지 — 메일 발송 경로가 생기면(P4-5) CONTACT_METHODS 로 옮긴다. */
export const HIDDEN_CONTACT_METHODS = ["email"] as const;

export const PAYMENT_METHODS = ["cash", "card", "tax_invoice"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** 차량 카드 사진 — 홈 차량 섹션(components/home/FleetSection.tsx)과 같은 slug↔사진 대응(public/hero). 없는 slug 는 사진 없이 렌더. */
export const VEHICLE_IMAGES: Readonly<Record<string, string>> = {
  bus45: "/hero/bus-01.jpg",
  bus35: "/hero/bus-04.jpg",
  limo28: "/hero/bus-03.jpg",
  bus25: "/hero/bus-02.jpg",
  bus16: "/hero/bus-05.jpg",
};

/** = lib/types PHONE_KR_PATTERN (국내 01x, 하이픈 선택). */
export const PHONE_KR_INPUT_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;
/** = lib/types PHONE_INTL_PATTERN (E.164). */
export const PHONE_INTL_INPUT_PATTERN = /^\+[1-9]\d{6,14}$/;
export const PHONE_KR_MAX_DIGITS = 11;

/** 목업 phoneInput 의 자동 하이픈 — 숫자만 남기고 3-4-4, 11자리 초과는 자른다. */
export function formatKrPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, PHONE_KR_MAX_DIGITS);
  if (d.length > 7) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length > 3) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}

export interface LocationGroup {
  key: "cities" | "regions";
  codes: LocationCode[];
}

const PLACE_CODES = new Set<string>(PLACES.map((p) => p.code));

/** 출발지·도착지·경유지 공통 선택지 — 도시 우선 그룹 + "그 외 지역(시도)" 그룹 (브리프 3단계). */
export function locationGroups(): LocationGroup[] {
  const cities = [...PLACES].sort((a, b) => a.sort - b.sort).map((p) => p.code as LocationCode);
  const regions = REGIONS.filter((r) => !PLACE_CODES.has(r)) as LocationCode[];
  // 방어: 두 그룹의 합이 접수 코드 집합과 같아야 한다(카탈로그가 바뀌어도 선택지가 새지 않게)
  if (cities.length + regions.length !== LOCATION_CODES.length) {
    throw new Error("locationGroups: 도시+시도 그룹의 합이 LOCATION_CODES 와 다르다");
  }
  return [
    { key: "cities", codes: cities },
    { key: "regions", codes: regions },
  ];
}
