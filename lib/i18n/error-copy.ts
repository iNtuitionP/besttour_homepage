/**
 * 오류 경계의 문구 — global-error(앱 전체)와 관리자 (protected) error 가 **지연 로드**로 읽는다 (P7-4 · 브리프 §8).
 *
 * 왜 따로 떼고 지연 로드하나
 *   - 두 경계는 클라이언트 컴포넌트이고 NextIntlClientProvider 밖이다(global-error 는 루트 레이아웃을 대신하고, 관리자 영역은 로케일 밖이라
 *     공급자가 없다 — app/admin/(protected)/layout.tsx 주석). 그래서 useTranslations 를 쓸 수 없다.
 *   - global-error 는 모든 공개 페이지의 첫 JS 에 실린다(RSC 페이로드의 G 칸 — next/dist/server/app-render/app-render.js).
 *     카탈로그(messages/ko.json 64KB)를 정적으로 import 하면 오류가 없을 때도 매 페이지가 그만큼 더 받는다.
 *     이 모듈을 `import()` 로 부르면 카탈로그는 **오류 화면이 실제로 뜰 때만** 받는다.
 * 문구는 카탈로그 그대로다 — global-error 는 `errors.*`(공개 (site)/error.tsx 와 같은 문구), 관리자는 `admin.error.*`(해요체).
 * 전화는 원장 예약·상담 전화(COMPANY.consultTel · E.164 링크 CONSULT_TEL_HREF — P1-7). 여기에는 한글 리터럴이 없다.
 */
import { CONSULT_TEL_HREF } from "@/lib/contact-phone";
import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";
import ko from "@/messages/ko.json";

/** 앱 전체 오류(global-error) — 한국어 기본(로케일을 알 수 없는 자리다) + 예약·상담 전화. */
export const GLOBAL_ERROR_COPY = {
  title: ko.errors.errorTitle,
  body: ko.errors.errorBody,
  retry: ko.errors.retry,
  home: ko.errors.home,
  /** "오류 참조 번호 {digest}" — 부르는 쪽이 {digest} 를 채운다 */
  ref: ko.errors.errorRef,
  telLabel: LEGAL_LABELS.contact.consultTel,
  tel: { display: COMPANY.consultTel, href: CONSULT_TEL_HREF },
} as const;

/** 관리자 화면 오류 — 관리자 셸(메뉴·탭 바) 안에서 본문 자리만 바뀐다. 해요체(tests/admin-copy-tone.test.ts). */
export const ADMIN_ERROR_COPY = {
  title: ko.admin.error.title,
  body: ko.admin.error.body,
  retry: ko.admin.error.retry,
  home: ko.admin.error.home,
  ref: ko.admin.error.ref,
} as const;
