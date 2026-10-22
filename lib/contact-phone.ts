/**
 * 예약·상담 전화 — 표시 문자열과 tel: 링크 (P1-7 브리프 1-C).
 *
 * 번호는 **둘**이다 (사용자 2026-10-18 · OF3-C — 새 대표번호는 끝자리 9, 사용자 확인 2026-10-20):
 *   - 대표번호 `COMPANY.mainTel`(1566-…) — 헤더(줄 + 모바일 패널)·푸터 큰 번호·푸터 사업자 정보의 전화 줄(전자상거래법 §10①). 국내 전용이라 **한국어 화면에서만** 쓴다.
 *   - 예약·상담 `COMPANY.consultTel`(010-…) — 손님에게 "여기로 전화하라" 고 안내하는 나머지 자리: 플로팅 전화 버튼·고객센터 카드·예약확인·접수 완료·오류 화면·
 *     회사소개·이용안내 연락처·문자 발신·개인정보 보호책임자. (사용자 결정 2026-09-21 · 2026-10-09 P7-5 로 010 하나로 통일했던 것을, 대표번호를 새로 얻으며 둘로 나눴다.)
 *   옛 대표전화(끝자리 8)와 사장님 옛 휴대전화는 원장에서 지웠고 다시 쓰지 않는다(번호는 tests/helpers/retired-phones.ts — tests/contact-phone.test.ts §0 이 막는다).
 *
 *   - 표시: mainPhone — 한국어 화면은 COMPANY.mainTel, 그 밖의 로케일은 consultPhone 과 같은 값(1566 은 해외에서 걸리지 않는다).
 *           consultPhone — 한국어 화면은 COMPANY.consultTel(010-…), 그 밖의 로케일은 COMPANY.consultTelIntl(+82 …) — 010 을 국내 표기로만 보여 주면 해외 방문자는 국가번호를 알 수 없다.
 *   - 링크: 예약·상담은 언제나 E.164(`tel:+82…`) — 원장의 국제 표기에서 숫자와 `+` 만 남겨 만든다. 대표번호(ko)는 국내 전용이라 `tel:15…`(localPhone). 번호를 여기 다시 적지 않는다.
 *
 * 원장(상수)만 읽는 작은 모듈이라 클라이언트 컴포넌트((site)/error.tsx)도 import 할 수 있다. 라벨은 ledgerUi(locale).labels.contact.mainTel / consultTel.
 */
import { routing } from "@/i18n/routing";
import { COMPANY } from "@/lib/legal/disclosures";
import { intlPhone } from "@/lib/phone-format";

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

/**
 * 로케일별 대표번호 (OF3-C). 한국어 화면 = 원장 대표번호(국내 전용 `tel:15…`), 그 밖의 로케일 = consultPhone — 영문 화면에 1566 을 쓰지 않는다.
 * 표시·링크는 localPhone 과 같은 규칙이라 번호 리터럴이 이 파일에 없다.
 */
export function mainPhone(locale: string): ContactPhone {
  if (locale === routing.defaultLocale) return localPhone(COMPANY.mainTel, locale);
  return consultPhone(locale);
}

/** 이 로케일에서 대표번호가 예약·상담 번호와 **다른 번호**인가 — 참이면 라벨은 '대표번호'(mainTel), 푸터에 '예약 문의' 줄이 따로 붙는다. 한국어 화면만 참. */
export function hasSeparateMainLine(locale: string): boolean {
  return mainPhone(locale).display !== consultPhone(locale).display;
}

/**
 * 국내 표기 번호의 국제 표기 (P7-4 · 브리프 §7) — 순수 함수는 lib/phone-format.ts(원장 import 없음 — 클라이언트 트리도 쓴다)에 있고
 * 여기서 다시 내보낸다. 이 모듈에는 번호 리터럴이 없다(tests/contact-phone.test.ts §1).
 */
export { intlPhone };

/**
 * 원장의 국내 표기 번호(팩스 · 개인정보 보호책임자 등)를 로케일에 맞춰 보인다 (P7-4).
 *   - 표시: 한국어 화면은 원장 표기 그대로, 그 밖의 로케일은 intlPhone(+82).
 *   - 링크: `0` 으로 시작하면 E.164(`tel:+82…`), 아니면(15xx) 숫자만(`tel:15…`) — 어느 화면에서 눌러도 같은 번호다.
 * 예약·상담 전화는 원장이 국제 표기를 따로 가진다 — consultPhone 을 쓴다(같은 결과지만 원장 값이 정본이다).
 */
export function localPhone(domestic: string, locale: string): ContactPhone {
  const v = domestic.trim();
  const digits = v.replace(/\D/g, "");
  return {
    display: locale === routing.defaultLocale ? v : intlPhone(v),
    href: /^0\d/.test(v) ? `tel:+82${digits.slice(1)}` : `tel:${digits}`,
  };
}
