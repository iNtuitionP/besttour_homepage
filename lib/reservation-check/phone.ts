/**
 * 예약 조회 휴대폰 번호 정규화 — 순수 (T2-5 · 사장님 요청 1 · 결정 5, 2026-10-10).
 *
 * 조회 키는 "휴대폰 번호 + 예약자 이름" 이다. 번호는 **접수와 같은 정규화**를 거쳐야 저장값(reservations.phone, E.164)과 만난다:
 *   - 칸 하나. `+` 로 시작하면 해외(E.164 — `+` 와 숫자만 남긴다), 아니면 국내 휴대전화(01x, 하이픈 선택)
 *     — 견적 모달(components/quote/quick-quote.ts splitPhone)과 같은 규칙이다.
 *   - 형식 검사는 lib/types 의 원본 패턴(PHONE_KR_PATTERN · PHONE_INTL_PATTERN), 변환은 lib/reservations/phone.ts contactPhone() —
 *     사본을 두지 않는다. 사본이 갈라지면 "접수는 되는데 조회는 안 되는" 번호가 생긴다.
 *
 * '+820' 보정 (계획 위험 · lib/reservations/phone.ts 의 해외 칸 경로)
 *   해외 칸에 국내 번호를 0 째로 적으면(`+82010…`) contactPhone 이 그대로 저장해 왔다. 그래서
 *   - 입력이 `+820…` 이면 0 을 떼어 정규형(`+8210…`)으로 맞추고,
 *   - DB 에서는 정규형과 옛 저장형(`+820…`) **두 값**을 함께 찾는다(storedPhoneCandidates — SQL 조건은 여전히 phone 한 컬럼).
 *   저장값을 고치는 마이그레이션은 하지 않는다(이 태스크 범위 밖 · 운영 DB 에 그런 행이 있는지는 컨트롤러가 확인한다).
 *
 * 번호 원문은 로그·응답에 싣지 않는다 — 이 모듈은 값을 돌려줄 뿐 아무것도 기록하지 않는다.
 */
import { contactPhone } from "../reservations/phone";
import { PHONE_INTL_PATTERN, PHONE_KR_PATTERN } from "../types";

const KR = "+82";
const KR_LEGACY_ZERO = "+820";

/**
 * 칸에 친 값 → 정규 E.164. 형식 밖이면 null(던지지 않는다 — zod refine 이 쓴다).
 *   "010-1234-5678" · "01012345678"   → "+821012345678"
 *   "+1 (555) 123-4567"               → "+15551234567"
 *   "+82010-1234-5678"                → "+821012345678"  ('+820' 보정)
 */
export function checkPhoneE164(raw: string): string | null {
  const t = raw.trim();
  if (t.length === 0) return null;
  if (t.startsWith("+")) {
    const intl = `+${t.slice(1).replace(/\D/g, "")}`;
    if (!PHONE_INTL_PATTERN.test(intl)) return null;
    const { e164 } = contactPhone({ phoneIntl: intl });
    return e164.startsWith(KR_LEGACY_ZERO) ? `${KR}${e164.slice(KR_LEGACY_ZERO.length)}` : e164;
  }
  if (!PHONE_KR_PATTERN.test(t)) return null;
  return contactPhone({ phone: t }).e164;
}

/** 정규 E.164 → DB 에서 찾을 저장값 후보. 국내(+82) 번호는 옛 저장형 `+820…` 까지 둘, 해외 번호는 하나. */
export function storedPhoneCandidates(e164: string): readonly string[] {
  if (e164.startsWith(KR) && !e164.startsWith(KR_LEGACY_ZERO)) return [e164, `${KR_LEGACY_ZERO}${e164.slice(KR.length)}`];
  return [e164];
}
