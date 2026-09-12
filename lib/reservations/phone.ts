/**
 * 접수 연락처 정규화 순수 함수 (REVIEW-FIX M6, 2026-09-12).
 *
 * ReservationInput 은 phone(국내 01x)과 phoneIntl(국제 E.164) 중 정확히 하나를 받는다(XOR, 로케일 무관 — 한국 SIM 을 쓰는
 * 외국인은 phone, 해외 번호는 phoneIntl). DB reservations.phone(0001, text) 에는 그중 하나를 E.164 로 정규화해 넣는다:
 *
 *   phone     '010-1234-5678' → '+821012345678'   (하이픈 제거 · 선행 0 제거 · 국가번호 82)
 *   phoneIntl '+15551234567'  → '+15551234567'    (그대로)
 *
 * kind 는 "어느 칸에 적었나"가 아니라 "어느 나라 번호인가"(국가번호)로 정한다 — phoneIntl 로 들어온 '+8210…' 도 kr 이다.
 * 발송기(P4)가 국내/국제 채널을 고를 때 필요한 것은 후자이기 때문이다.
 *
 * DB·네트워크 없음. 스키마가 먼저 거르므로 둘 다/둘 다 없음/형식 위반이 여기까지 오면 프로그래밍 오류다 — 잘못된 번호를
 * 만들어 내지 않고 throw 한다.
 */
import { PHONE_INTL_PATTERN, PHONE_KR_PATTERN } from "../types";

export type ContactPhoneKind = "kr" | "intl";

export interface ContactPhone {
  /** E.164 (`+` + 국가번호 + 가입자번호, 하이픈·공백 없음). */
  e164: string;
  kind: ContactPhoneKind;
}

export interface ContactPhoneInput {
  phone?: string | undefined;
  phoneIntl?: string | undefined;
}

const KR_COUNTRY_CODE = "+82";

const present = (v: string | undefined): v is string => typeof v === "string" && v.length > 0;

export function contactPhone(input: ContactPhoneInput): ContactPhone {
  const hasKr = present(input.phone);
  const hasIntl = present(input.phoneIntl);

  if (hasKr === hasIntl) {
    throw new Error(
      "contactPhone: phone 과 phoneIntl 중 정확히 하나만 있어야 합니다 (ReservationInput 이 먼저 걸러야 한다).",
    );
  }

  if (hasKr) {
    const raw = input.phone as string;
    if (!PHONE_KR_PATTERN.test(raw)) {
      throw new Error("contactPhone: phone 이 국내 휴대전화 형식(01x-xxxx-xxxx)이 아닙니다.");
    }
    const digits = raw.replace(/-/g, "");
    return { e164: `${KR_COUNTRY_CODE}${digits.slice(1)}`, kind: "kr" };
  }

  const intl = input.phoneIntl as string;
  if (!PHONE_INTL_PATTERN.test(intl)) {
    throw new Error("contactPhone: phoneIntl 이 E.164 형식(+국가번호…)이 아닙니다.");
  }
  return { e164: intl, kind: intl.startsWith(KR_COUNTRY_CODE) ? "kr" : "intl" };
}
