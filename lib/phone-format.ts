/**
 * 전화번호 표기만 바꾸는 순수 함수 (P7-4 · 브리프 §7) — 원장·로케일 설정을 import 하지 않는다.
 * 그래서 클라이언트 트리(예약확인 결과 카드 — 원장을 클라이언트 번들에 싣지 않는다)도 쓸 수 있다. lib/contact-phone.ts 가 다시 내보낸다.
 *
 * 국내 표기 번호의 국제 표기 — `0` 으로 시작하는 번호만 앞 `0` 을 떼고 `+82 ` 를 붙인다
 * (`010-…` → `+82 10-…`, `0303-…` → `+82 303-…`, 가린 번호 `010-****-1234` → `+82 10-****-1234`).
 * `0` 으로 시작하지 않는 번호(15xx·16xx 전국 대표번호 · 가린 해외 번호 `***`)는 **그대로** 둔다 — 그 번호에는 뗄 지역·이동통신 식별 `0` 이 없고,
 * 국가번호를 붙여도 해외에서 걸리지 않는다(지금 원장에는 그런 번호가 없다 — P7-5).
 * 원장의 값은 바꾸지 않는다 — 표시만 바꾼다. 번호 리터럴 없음.
 */
export function intlPhone(domestic: string): string {
  const v = domestic.trim();
  return /^0\d/.test(v) ? `+82 ${v.slice(1)}` : v;
}

const KR_MOBILE = /^01\d{8,9}$/;

/**
 * 저장값(E.164)의 국내 표기 — 반대 방향(국제 → 국내). `+8210…` 휴대전화만 `010-1234-5678`(3-4-4 · 10자리는 3-3-4)로 바꾸고,
 * 그 밖(해외 번호 · 유선 · 모르는 모양)은 저장값 그대로 둔다(양끝 공백만 걷는다) — 짐작해서 바꾸지 않는다. 가리지 않는다.
 * 쓰는 곳: 관리자 접수 상세의 큰 번호(전화를 거는 화면) · 사장님 접수 알림 문자(T2-4 · 결정 12 — 옛 이름 detailPhoneText,
 * components/admin/reservation-detail.ts 에서 옮겼다).
 */
export function domesticPhoneText(stored: string): string {
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
