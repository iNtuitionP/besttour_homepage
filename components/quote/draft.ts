/**
 * 위저드 초안 — sessionStorage 직렬화 (P3-4).
 *
 *   - 저장소는 **sessionStorage 만**(개인정보 포함 — 탭을 닫으면 사라져야 한다. localStorage 금지).
 *   - 동의 2종(privacyConsent·marketingConsent)과 단계(step)는 **직렬화하지 않는다** — 재방문 시 다시 체크하게(사전 선택 금지, ADR-6).
 *     단계는 URL(?step=N)이 갖는다.
 *   - 읽기·쓰기·삭제는 전부 try/catch — 사생활 모드·저장소 차단·용량 초과에서도 위저드는 동작한다(초안만 못 남길 뿐).
 *   - parseDraft 는 모양을 검사한다: 문자열 필드는 문자열만, 경유지는 문자열 배열(비문자열 원소 제거), 체크 2종은 boolean 만,
 *     phoneKind 는 kr|intl 만. 모르는 키·동의·단계는 버린다. 쓰레기 JSON → null.
 */
import type { DraftFields, WizardState } from "./wizard-state";

export const DRAFT_STORAGE_KEY = "bestour.quote.draft.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STRING_FIELDS = [
  "purposeCode",
  "vehicleSlug",
  "originCode",
  "destinationCode",
  "tripType",
  "departDate",
  "departTime",
  "returnDate",
  "returnTime",
  "busCount",
  "passengers",
  "contactMethod",
  "paymentMethod",
  "message",
  "name",
  "phone",
  "phoneIntl",
  "email",
] as const;
const BOOL_FIELDS = ["parkingIncluded", "vatIncluded"] as const;
const LIST_FIELDS = ["waypointCodes"] as const;
const PHONE_KINDS = new Set(["kr", "intl"]);

/** 직렬화 대상 키 — 동의·단계 제외 (테스트가 JSON 에 Consent 가 없음을 단언). */
export const DRAFT_KEYS: readonly (keyof DraftFields)[] = [...STRING_FIELDS, ...BOOL_FIELDS, ...LIST_FIELDS, "phoneKind"];

export function serializeDraft(state: WizardState): string {
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_KEYS) out[k] = state[k];
  return JSON.stringify(out);
}

export function parseDraft(json: string | null): Partial<DraftFields> | null {
  if (typeof json !== "string" || json.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<DraftFields> = {};
  const sink = out as Record<string, unknown>;
  for (const k of STRING_FIELDS) if (typeof o[k] === "string") sink[k] = o[k];
  for (const k of BOOL_FIELDS) if (typeof o[k] === "boolean") sink[k] = o[k];
  for (const k of LIST_FIELDS) {
    if (Array.isArray(o[k])) out[k] = (o[k] as unknown[]).filter((v): v is string => typeof v === "string");
  }
  if (typeof o.phoneKind === "string" && PHONE_KINDS.has(o.phoneKind)) out.phoneKind = o.phoneKind as DraftFields["phoneKind"];
  return out;
}

export function saveDraft(storage: StorageLike | null | undefined, state: WizardState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DRAFT_STORAGE_KEY, serializeDraft(state));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(storage: StorageLike | null | undefined): Partial<DraftFields> | null {
  if (!storage) return null;
  try {
    return parseDraft(storage.getItem(DRAFT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearDraft(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // 지우지 못해도 탭이 닫히면 사라진다
  }
}

/** 브라우저의 sessionStorage — 접근 자체가 throw 하는 환경(차단·sandbox)이면 null. 서버에서는 null. */
export function sessionStorageOrNull(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}
