/**
 * 예약·상담 전화 — 표시 문자열과 tel: 링크 (P1-7 브리프 1-C).
 *
 * 사용자 결정(2026-09-21): 010-6362-6188 이 이 홈페이지의 전화번호다(예약 문의·상담). 손님에게 "여기로 전화하라" 고 안내하는
 * 모든 자리(헤더·플로팅 버튼·모바일 메뉴·고객센터 카드·예약확인·접수 완료·오류 화면·/fares CTA·회사소개·이용안내 연락처)는
 * 여기를 거친다. 대표전화 1566-6188(COMPANY.tel)은 푸터 사업자 정보의 "대표전화" 한 줄에만 남는다(tests/contact-phone.test.ts).
 *
 *   - 표시: 한국어 화면은 COMPANY.consultTel(010-…), 그 밖의 로케일은 COMPANY.consultTelIntl(+82 …) — 해외에서 1566 번호는 걸리지 않고,
 *           010 을 국내 표기로만 보여 주면 해외 방문자는 국가번호를 알 수 없다.
 *   - 링크: 언제나 E.164(`tel:+82…`). 원장의 국제 표기에서 숫자와 `+` 만 남겨 만든다 — 번호를 여기 다시 적지 않는다.
 *
 * 원장(상수)만 읽는 작은 모듈이라 클라이언트 컴포넌트((site)/error.tsx)도 import 할 수 있다. 라벨은 ledgerUi(locale).labels.contact.consultTel.
 */
import { routing } from "@/i18n/routing";
import { COMPANY } from "@/lib/legal/disclosures";

export interface ContactPhone {
  /** 화면에 보이는 번호 — ko: 010-…, 그 밖: +82 … */
  display: string;
  /** `tel:+82…` — 공백·하이픈 없는 E.164 */
  href: string;
}

/** 예약·상담 전화의 tel: 링크(E.164). */
export const CONSULT_TEL_HREF = `tel:${COMPANY.consultTelIntl.replace(/[^\d+]/g, "")}`;

/** 로케일별 예약·상담 전화. 알 수 없는 로케일도 국제 표기(한국어 화면만 국내 표기). */
export function consultPhone(locale: string): ContactPhone {
  return {
    display: locale === routing.defaultLocale ? COMPANY.consultTel : COMPANY.consultTelIntl,
    href: CONSULT_TEL_HREF,
  };
}
