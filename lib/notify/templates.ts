/**
 * 문자·알림톡 문안 (플랜 v4 P4-3 · ADR-7 · CLAUDE.md §3).
 *
 * 아웃박스(outbox.ts)는 `template` **키**만 저장하고, 발송기(worker.ts)는 그 키를 그대로 sender 에게 넘긴다.
 * 문안이 사는 곳은 여기 하나다. 제공자 호출(P4-2)도, env 도, DB 도 여기 없다 — 값을 받아 문자열을 내는 순수 모듈이다.
 * 그래서 렌더 결과의 바이트 수를 테스트가 정확히 셀 수 있고, 발송 없이도 문안을 검증할 수 있다.
 *
 * 지키는 것 네 가지
 * ---------------------------------------------------------------------------
 * 1. **verbatim 은 한 바이트도 바뀌지 않는다.** 접수·확정 문구는 원장(../legal/disclosures VERBATIM.bookingNotice)에서
 *    가져다 그대로 끼운다. 길이가 모자라면 **다른 문장을 줄인다** — 이 문장은 SMS 판에도 그대로 남는다
 *    (tests/notify-templates.test.ts §1 이 hex 로 대조한다).
 * 2. **정보성 문자에 광고 표현 0.** 할인·이벤트·특가 같은 낱말이 하나라도 섞이면 정보통신망법 §50 상 광고성 정보가 되어
 *    제목의 `(광고)` 표기와 무료 수신거부 번호 고지 의무가 생긴다 — 우리는 그 둘을 만들지 않았고, 만들 계획도 없다.
 *    `marketing_consent` 를 받은 사람에게도 **이 템플릿으로는** 광고를 보내지 않는다(광고 발송은 별도 템플릿·별도 태스크).
 *    반대로 `(광고)`·수신거부 문구를 정보성 문자에 미리 붙여 두지도 않는다 — 붙이는 순간 광고로 읽힌다.
 * 3. **법정 문구·회사 정보 리터럴 0.** 대표전화·결제 안내·상호를 여기 다시 타이핑하지 않는다. 전부 원장 상수다.
 *    안내 문장(법정 문구가 아닌 것)은 여기 두어도 된다 — 그것이 이 파일의 일이다.
 * 4. **개인정보는 사장님 템플릿에만.** 고객 문자는 `CustomerVars`(접수번호·원점)만 받는다 — 타입에 이름·번호가 없어
 *    다른 사람의 정보가 흘러들 자리 자체가 없다. 사장님 문자는 반대로 마스킹하지 않는다: 전화를 걸어야 하기 때문이다.
 *
 * SMS / LMS 선택 — 왜 UTF-8 바이트인가
 * ---------------------------------------------------------------------------
 * 국내 SMS 의 90바이트 상한은 원래 **EUC-KR(CP949) 기준**(한글 2바이트)이다. 그런데 이 코드베이스에서 문자열의 길이를
 * 흔들림 없이 잴 수 있는 것은 UTF-8 뿐이고(새 패키지 금지 — iconv 계열 인코더가 없다), UTF-8 은 한글을 3바이트로 세므로
 * **항상 EUC-KR 보다 크거나 같다.** 즉 UTF-8 기준으로 90바이트에 들어가면 제공자 기준으로도 반드시 들어간다 —
 * 보수적인 쪽으로만 틀린다(잘려 나가는 사고가 없고, 대신 SMS 로 보낼 수 있는 것을 LMS 로 보낼 수 있다).
 * 그 대가를 눈에 보이게 하려고 `kscByteLength()`(EUC-KR 추정)를 같이 계산해 `RenderedMessage.kscBytes` 로 싣는다 —
 * **선택에는 쓰지 않는다.** 요금 판단과 P4-2 의 제공자 대조용 숫자다.
 *
 * 실제 결과: verbatim 한 문장이 UTF-8 81바이트(EUC-KR 추정 57바이트)라 90바이트 SMS 에 거의 다 찬다. 그래서 verbatim 을
 * 반드시 포함해야 하는 고객 문자 2종과, 필수 항목이 많은 사장님 문자 2종은 **전부 LMS 로 나간다.** 줄일 수 있는 것은
 * 이미 줄였고, 남은 것은 규약이 요구하는 내용뿐이다.
 */
import { CANCELLATION, COMPANY, PAYMENT, VERBATIM, WITHDRAWAL } from "../legal/disclosures";
import { FALLBACK_SITE_ORIGIN } from "../site-url";
import type { NotifyEvent } from "../types";
import { ALL_TEMPLATE_KEYS, MAX_ATTEMPTS, type TemplateKey } from "./outbox";

// =============================================================================
// 상수
// =============================================================================

/** 단문(SMS) 상한. UTF-8 바이트로 잰다 — 헤더 "SMS / LMS 선택" 참조. */
export const SMS_BYTE_LIMIT = 90;

/** 장문(LMS) 상한. 넘으면 자르지 않고 throw 한다 — verbatim 을 잘라 보내는 것보다 보내지 않는 편이 낫다. */
export const LMS_BYTE_LIMIT = 2000;

/** 예약확인 화면 경로 — app/[locale]/(site)/reservation/check/page.tsx. 접수번호 + 휴대폰 뒷 4자리로 조회한다. */
export const RESERVATION_CHECK_PATH = "/reservation/check";

/** 이용안내 경로 — app/[locale]/(legal)/guide/page.tsx. 취소·환불 규정과 청약철회 제한 고지 전문이 있다(확정 통지의 링크 — P1-7 R2). */
export const GUIDE_PATH = "/guide";

/** 관리자 예약 목록 경로 — app/admin/(protected)/reservations. 상세는 `${…}/{reservationId}`. */
export const ADMIN_RESERVATIONS_PATH = "/admin/reservations";

/**
 * 관리자 발송 내역 경로 — app/admin/(protected)/notifications. 실패한 통지의 사유(`last_error`)가 있는 유일한 화면이라
 * 실패 알림(P4-4)이 여기를 가리킨다. `lib/admin/notifications.ts` 의 같은 이름 상수와 값이 같아야 하며
 * tests/notify-fallback.test.ts 가 그 일치를 잠근다 — 저쪽은 세션 클라이언트를 쓰는 서버 모듈이라
 * 순수 모듈인 이 파일이 import 할 수 없다(lib/notify/vars.ts 가 `labelOf` 를 다시 적은 것과 같은 이유).
 */
export const ADMIN_NOTIFICATIONS_PATH = "/admin/notifications";

/** 발신 브랜드 표기. 원장의 브랜드명으로 만든다 — 상호를 여기 다시 적지 않는다. */
const BRAND = `[${COMPANY.brandName}]`;

export type MessageFormat = "sms" | "lms";

// =============================================================================
// 바이트 재기
// =============================================================================

/** UTF-8 바이트 수. SMS/LMS 선택의 **유일한** 기준이다. */
export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * EUC-KR(CP949) 바이트 **추정** — ASCII 1바이트, 그 밖 2바이트. 보고·요금 판단 전용이며 선택에는 쓰지 않는다.
 * 한계: EUC-KR 에 없는 문자(이모지 등)는 실제로는 전송 자체가 되지 않거나 더 긴 바이트를 먹는다. 우리 문안은
 * 한글·ASCII·가운뎃점뿐이라 이 추정이 정확하지만, 값을 신뢰하기 전에 P4-2 가 제공자 응답으로 한 번 대조할 것.
 */
export function kscByteLength(text: string): number {
  let n = 0;
  for (const ch of text) n += (ch.codePointAt(0) ?? 0) < 128 ? 1 : 2;
  return n;
}

/** 이 본문을 SMS 로 보낼 수 있는가. 90바이트 이하면 sms, 넘으면 lms. */
export function chooseFormat(text: string): MessageFormat {
  return utf8ByteLength(text) <= SMS_BYTE_LIMIT ? "sms" : "lms";
}

// =============================================================================
// 렌더 입력
// =============================================================================

/**
 * 고객 문자가 받는 전부. **이름·전화번호가 없다** — 있어야 할 이유가 없고, 없으면 새어 나갈 수도 없다.
 * `origin` 은 호출부(P4-2)가 lib/site-url.ts `siteOrigin()` 으로 얻어 넘긴다. 이 모듈은 env 를 보지 않는다.
 */
export interface CustomerVars {
  /** reservations.public_code — 고객이 예약확인에 입력하는 8자 코드. */
  publicCode: string;
  /** `https://…` 형식의 사이트 원점(끝 슬래시 없음). */
  origin: string;
}

/** 사장님 접수 알림이 받는 것. 여기만 원문 개인정보를 싣는다 — 사장님은 전화를 걸어야 한다(마스킹하지 않는다). */
export interface OwnerVars extends CustomerVars {
  /** reservations.id (uuid) — 관리자 상세 링크에 쓴다. */
  reservationId: string;
  name: string;
  phone: string;
  /** 표시용 차량 라벨(vehicles.name_ko). 코드가 아니라 사람이 읽는 값이다. */
  vehicleLabel: string;
  /** KST 벽시계 `YYYY-MM-DD HH:mm` — lib/reservation-check/view.ts kstWallClock 의 결과. */
  departAtKst: string;
  originLabel: string;
  destinationLabel: string;
  busCount: number;
  /** 미입력이면 null — 그 줄에서 인원만 뺀다. */
  passengers: number | null;
}

/**
 * 키 → 그 키가 요구하는 입력. 고객 키에 OwnerVars 를 넘길 수는 있어도 그 반대는 컴파일이 막는다.
 *
 * 실패 알림 2종(P4-4)이 `OwnerVars` 가 아니라 **`CustomerVars`** 인 것은 실수가 아니라 이 태스크의 핵심이다:
 * 그 문안은 사장님께 가지만 *"무엇이 실패했는지"* 만 말하므로 고객 이름·전화를 다시 실을 이유가 없고,
 * `CustomerVars` 에는 그 필드가 **타입에 없어** 실릴 자리 자체가 없다(lib/notify/vars.ts 와 같은 수법 —
 * 규율이 아니라 구조로 막는다). 부수 효과로 어댑터가 사장님 조회(9컬럼)를 하지 않고 `public_code` 한 컬럼만 읽는다.
 */
export interface TemplateVarsByKey {
  "created.owner.sms": OwnerVars;
  "created.owner.email": OwnerVars;
  "created.customer.sms": CustomerVars;
  "confirmed.customer.sms": CustomerVars;
  "created.owner.failure.email": CustomerVars;
  "confirmed.owner.failure.email": CustomerVars;
}

/** 두 벌 + (메일 키에만) 제목. */
export interface MessageVariants {
  sms: string;
  lms: string;
  subject?: string;
}

export interface RenderedMessage {
  key: TemplateKey;
  format: MessageFormat;
  text: string;
  /** 선택 기준이 된 바이트 수(UTF-8). */
  utf8Bytes: number;
  /** 제공자(EUC-KR) 기준 추정 — 참고용. 선택에 쓰지 않는다. */
  kscBytes: number;
  /** channel = 'email' 폴백에만. 문자 3종은 undefined. */
  subject?: string;
}

// =============================================================================
// 문안
// =============================================================================

const NL = "\n";

/**
 * 줄을 잇는다. `null` 인 줄은 통째로 뺀다 — 값이 없을 때 "구간 →" 같은 반쪽 줄을 보내지 않기 위해서다.
 * 빈 문자열 `""` 은 **뺀 줄이 아니라 빈 줄**이다(LMS 의 문단 나누기).
 */
const lines = (...parts: (string | null)[]): string => parts.filter((p): p is string => p !== null).join(NL);

/** `{origin}{path}` — origin 이 비면 경로만 남는다(테스트·로컬). */
const link = (origin: string, path: string): string => `${origin}${path}`;

const checkLink = (v: CustomerVars): string => link(v.origin, RESERVATION_CHECK_PATH);
/** 이용안내(취소·환불 규정 · 청약철회 제한 고지 전문) — 확정 통지의 "자세한 내용" 링크(P1-7 R2). */
const guideLink = (v: CustomerVars): string => link(v.origin, GUIDE_PATH);
const adminLink = (v: OwnerVars): string => `${link(v.origin, ADMIN_RESERVATIONS_PATH)}/${v.reservationId}`;

/** 대수 · 인원. 인원 미입력이면 대수만. */
const fleetLine = (v: OwnerVars): string =>
  v.passengers === null ? `${v.vehicleLabel} ${v.busCount}대` : `${v.vehicleLabel} ${v.busCount}대 · ${v.passengers}명`;

const route = (v: OwnerVars): string => `${v.originLabel} → ${v.destinationLabel}`;

/**
 * 사장님 접수 알림 — 접수번호·성명·연락처·차량·운행일·구간·인원·관리자 링크(브리프 Part 1).
 * verbatim 은 넣지 않는다: "사장님 확정 후 연락드리며" 는 고객에게 하는 약속이고, 사장님에게 되돌려 보내면 뜻이 뒤집힌다.
 * SMS 판은 같은 항목을 한 줄로 붙인 최소형이다 — 이 항목들을 더 뺄 수 없어 실제로는 언제나 LMS 로 나간다.
 */
function ownerVariants(v: OwnerVars): MessageVariants {
  return {
    sms: `${BRAND} 접수 ${v.publicCode} ${v.name} ${v.phone} ${v.departAtKst} ${route(v)} ${fleetLine(v)} ${adminLink(v)}`,
    lms: lines(
      `${BRAND} 새 예약이 접수되었습니다.`,
      "",
      `접수번호 ${v.publicCode}`,
      `고객 ${v.name} ${v.phone}`,
      `운행 ${v.departAtKst}`,
      `구간 ${route(v)}`,
      `차량 ${fleetLine(v)}`,
      "",
      `확인 ${adminLink(v)}`,
    ),
  };
}

/**
 * 고객 접수 확인 — 접수번호 + verbatim + 예약확인 안내 + 예약·상담 전화(브리프 Part 1 · P1-7).
 * 예약확인은 접수번호와 휴대폰 뒷 4자리로 조회한다(app/[locale]/(site)/reservation/check). 문구는 그 화면과 같은 말을 쓴다.
 * 전화는 원장 COMPANY.consultTel — 손님에게 "여기로 전화하라" 고 안내하는 번호다(대표전화 1566 은 푸터 사업자 정보에만 남는다).
 */
function createdCustomerVariants(v: CustomerVars): MessageVariants {
  return {
    sms: lines(`${BRAND} 접수 ${v.publicCode}`, VERBATIM.bookingNotice, `확인 ${checkLink(v)} · 문의 ${COMPANY.consultTel}`),
    lms: lines(
      `${BRAND} 견적 신청이 접수되었습니다.`,
      "",
      `접수번호 ${v.publicCode}`,
      VERBATIM.bookingNotice,
      "",
      `접수 내용은 ${checkLink(v)} 에서 접수번호와 휴대폰 뒷 4자리로 확인하실 수 있습니다.`,
      `문의 ${COMPANY.consultTel}`,
    ),
  };
}

/**
 * 확정 사실을 알리는 문장. 이 문장 **바로 뒤**에 verbatim 이 오면 "확정됐다" 다음에 "사장님 확정 후 연락드리며" 가 붙어
 * 아직 확정 전인 것처럼 읽힌다 — 확정 문자에서 이것은 문체 문제가 아니라 사실을 뒤집는 결함이다.
 * verbatim 은 한 글자도 고칠 수 없으므로(CLAUDE.md §3) **주변을 고쳤다**: 이 문장은 맨 위(일어난 일),
 * verbatim 은 맨 아래(늘 붙는 고지)로 떼어 놓았다. tests/notify-templates.test.ts §1 이 그 배치를 잠근다.
 */
export const CONFIRMED_HEADLINE = "예약이 확정되었습니다.";

/**
 * 고객 확정 안내 — 접수번호 + 확정 사실 + verbatim + 결제 안내(브리프 Part 1).
 *
 * 읽는 순서를 "일어난 일 → 앞으로 할 일 → 늘 붙는 고지" 로 짰다.
 *   1. 일어난 일   : `[베스트투어] 예약이 확정되었습니다.` + 접수번호
 *   2. 앞으로 할 일: 대금 지급 조건(원장 PAYMENT.line 그대로 — **지어내지 않는다**) · 예약확인 방법 · 변경·취소 연락처
 *   3. 늘 붙는 고지: verbatim. 사이트에서도 이 문장은 카드 아래쪽의 상시 고지 자리에 있다
 *                    (components/reservation-check/ReservationCard.tsx `data-legal="booking-notice"`).
 * 그래서 verbatim 앞 문장은 확정 선언이 아니라 연락처 안내다 — 두 문장이 서로 부딪히지 않는다.
 * 변경·취소 안내 문구는 예약확인 화면(`reservationCheck.card.help`)과 같은 말을 쓴다.
 *
 * P1-7 R2 [P1-4] — 약관 제8조가 약속한 "예약 확정 통지에서의 고지": 결제 안내 바로 다음에 원장 줄 셋(취소·환불 · 청약철회 제한 ·
 * 입금 계좌)과 자세한 내용 링크(이용안내 — 절대 URL)를 둔다. 이 줄들을 빼서 90바이트 SMS 에 맞추지 않는다 — SMS 판에도 같은 줄이 다
 * 들어 있어 언제나 90바이트를 넘고, 그래서 확정 통지는 **LMS 로만** 나간다(renderTemplate 의 선택 규칙 그대로 · 테스트가 잠근다).
 */
function confirmedCustomerVariants(v: CustomerVars): MessageVariants {
  const notices = [CANCELLATION.smsLine, WITHDRAWAL.smsLine, PAYMENT.accountLine, `자세한 내용 ${guideLink(v)}`];
  return {
    sms: lines(`${BRAND} 확정 ${v.publicCode}`, PAYMENT.line, ...notices, `문의 ${COMPANY.consultTel}`, VERBATIM.bookingNotice),
    lms: lines(
      `${BRAND} ${CONFIRMED_HEADLINE}`,
      "",
      `접수번호 ${v.publicCode}`,
      PAYMENT.line,
      ...notices,
      "",
      `예약 내용은 ${checkLink(v)} 에서 접수번호와 휴대폰 뒷 4자리로 확인하실 수 있습니다.`,
      `예약 변경·취소는 ${COMPANY.consultTel} 로 전화 주시면 도와드립니다.`,
      "",
      VERBATIM.bookingNotice,
    ),
  };
}

/**
 * 실패 알림이 가리키는 통지의 종류. **키의 event 부분으로 정해진다** — 죽은 행을 다시 읽지 않는다.
 * 그럴 수도 없다: 알림은 부분 유니크 때문에 "예약 하나 · event 하나당 한 번" 으로 묶여서(outbox.ts
 * `FAILURE_TEMPLATE_KEYS`) 접수 통지 두 건이 함께 죽어도 한 통이다 — 특정 행을 지목하는 문장은 애초에 쓸 수 없다.
 */
const FAILURE_KIND_LABEL: Record<NotifyEvent, string> = { created: "접수", confirmed: "확정" };

/**
 * 사장님 발송 실패 알림 (P4-4) — 접수번호 · 어떤 통지가 못 나갔는지 · 다음에 할 일 · 발송 내역 링크.
 *
 * **고객 이름·전화·메일·문의내용을 넣지 않는다.** 입력 타입이 `CustomerVars` 라 넣을 자리도 없다(TemplateVarsByKey 주석).
 * 사장님은 접수번호로 관리자 화면에서 전부 볼 수 있고, 통지가 못 나간 채널로 개인정보를 다시 흘릴 이유가 없다.
 *
 * verbatim 은 넣지 않는다 — "사장님 확정 후 연락드리며" 는 **고객에게 하는 약속**이지 사장님께 하는 보고가 아니다
 * (사장님 접수 알림 `ownerVariants` 가 같은 이유로 넣지 않는다).
 * 시각도 넣지 않는다: 이 모듈에는 시계가 없고(순수), 메일 자체의 수신 시각과 발송 내역의 시각이 그 역할을 한다.
 *
 * 시도 횟수는 `MAX_ATTEMPTS` 에서 온다 — 문안에 숫자를 적어 두면 재시도 정책을 바꿀 때 한쪽만 바뀐다.
 */
function failureVariants(event: NotifyEvent): (v: CustomerVars) => MessageVariants {
  const kind = FAILURE_KIND_LABEL[event];
  return (v) => {
    const where = link(v.origin, ADMIN_NOTIFICATIONS_PATH);
    return {
      sms: `${BRAND} ${kind} 통지 발송 실패 ${v.publicCode} ${where}`,
      lms: lines(
        `${BRAND} ${kind} 통지가 발송되지 않았습니다.`,
        "",
        `접수번호 ${v.publicCode}`,
        `${MAX_ATTEMPTS}번 시도했으나 모두 실패했습니다. 고객에게 직접 연락해 주세요.`,
        "",
        `실패 사유는 ${where} 에서 확인하실 수 있습니다.`,
      ),
      subject: `${BRAND} ${kind} 통지 발송 실패 ${v.publicCode}`,
    };
  };
}

/** 키 → 두 벌을 만드는 함수. 키는 ALL_TEMPLATE_KEYS 그대로다 — 여기서 새 키를 만들지 않는다. */
type BuilderMap = { [K in TemplateKey]: (vars: TemplateVarsByKey[K]) => MessageVariants };

const BUILDERS: BuilderMap = {
  "created.owner.sms": ownerVariants,
  // 사장님 번호가 없을 때의 폴백(outbox.ts planNotifications). 본문은 같고 제목만 더 붙는다.
  "created.owner.email": (v) => ({ ...ownerVariants(v), subject: `${BRAND} 새 예약 접수 ${v.publicCode}` }),
  "created.customer.sms": createdCustomerVariants,
  "confirmed.customer.sms": confirmedCustomerVariants,
  // 발송 실패 알림(P4-4). 본문은 같은 틀이고 event 만 다르다 — 사장님께 가지만 고객 변수만 받는다(위 주석).
  "created.owner.failure.email": failureVariants("created"),
  "confirmed.owner.failure.email": failureVariants("confirmed"),
};

const isTemplateKey = (key: string): key is TemplateKey => (ALL_TEMPLATE_KEYS as readonly string[]).includes(key);

/** 두 벌을 그대로 돌려준다 — 바이트 표를 만들거나 두 판을 나란히 검사할 때. */
export function renderVariants<K extends TemplateKey>(key: K, vars: TemplateVarsByKey[K]): MessageVariants {
  if (!isTemplateKey(key)) {
    throw new Error(`renderVariants: 알 수 없는 템플릿 키다 (${String(key)}) — 키는 outbox.ts ALL_TEMPLATE_KEYS 뿐이다`);
  }
  // BUILDERS[key] 는 키별로 다른 매개변수 타입을 갖는 함수의 합집합이라 (반공변) 직접 호출할 수 없다.
  // 키와 vars 의 짝은 위 시그니처가 이미 보장했으므로 여기서 한 번만 좁힌다.
  const build = BUILDERS[key] as (v: TemplateVarsByKey[K]) => MessageVariants;
  return build(vars);
}

/**
 * 보낼 한 통. sms 판이 90바이트 이하면 그것을, 아니면 lms 판을 고른다.
 * lms 판마저 상한을 넘으면 **자르지 않고 throw** 한다 — 잘린 자리가 하필 verbatim 이면 그것이 가장 나쁜 결과다.
 */
export function renderTemplate<K extends TemplateKey>(key: K, vars: TemplateVarsByKey[K]): RenderedMessage {
  const variants = renderVariants(key, vars);
  const format = chooseFormat(variants.sms);
  const text = format === "sms" ? variants.sms : variants.lms;
  const utf8Bytes = utf8ByteLength(text);
  if (utf8Bytes > LMS_BYTE_LIMIT) {
    throw new Error(`renderTemplate: ${key} 의 본문이 LMS 상한(${LMS_BYTE_LIMIT} 바이트)을 넘었다 (${utf8Bytes}) — 자르지 않는다`);
  }
  return {
    key,
    format,
    text,
    utf8Bytes,
    kscBytes: kscByteLength(text),
    ...(variants.subject === undefined ? {} : { subject: variants.subject }),
  };
}

// =============================================================================
// 알림톡 — 카카오 심사 제출용 원문 (발송 연동은 P4-2)
// =============================================================================

/**
 * 알림톡은 문자와 달리 **본문을 미리 카카오에 등록하고 심사를 받는다.** 심사에 내는 형태는 변수 자리를 `#{변수명}` 으로
 * 적은 원문이고, 발송 시 그 자리에 값을 채워 보낸다. 아래 `body` 가 **그대로 심사 제출본**이다(별도 사본을 만들지 않는다).
 *
 * created 의 심사 제출본은 이렇게 생겼다:
 *   [베스트투어] 견적 신청이 접수되었습니다.
 *
 *   접수번호 #{접수번호}
 *   사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다.
 *
 *   접수 내용은 예약확인 화면에서 접수번호와 휴대폰 뒷 4자리로 확인하실 수 있습니다.
 *   문의 #{상담전화}
 *
 * 링크는 본문 URL 이 아니라 **버튼(웹링크)** 으로 붙인다 — 심사에서 본문 URL 은 광고성으로 걸리기 쉽고, 버튼은
 * 템플릿 등록 시 고정 URL 로 심사받는다. 그래서 본문에는 경로를 적지 않는다. **버튼 정의는 이 파일의 `buttons` 다**
 * (R3 [P2-H] — 예전에는 "콘솔에서 등록한다" 는 주석뿐이어서 초안만으로는 심사에 낼 수 없었다). 콘솔 등록 때 이 값을 그대로 옮긴다.
 * 대체(실패 시 문자) 문안은 위 renderTemplate 의 같은 이벤트 문안을 그대로 쓴다.
 *
 * P1-7 R2 [P1-4] — 확정 알림톡에도 문자와 같은 원장 줄 셋(취소·환불 · 청약철회 제한 · 입금 계좌)을 결제 안내 바로 다음에 둔다.
 * 문자의 "자세한 내용" 링크(이용안내 GUIDE_PATH)는 알림톡에서는 버튼(웹링크)으로 등록한다(위 규칙 — P4-2 연동 때 콘솔에).
 * 전화 자리 이름은 `#{상담전화}`(옛 `#{대표전화}` — 심사 전이라 바꿨다). 채우는 값은 원장 COMPANY.consultTel 이다.
 */
/**
 * 알림톡 버튼(웹링크) — 심사 제출본의 일부다 (R3 [P2-H]).
 * 카카오 버튼 규격: `linkType = WL`(웹링크) · 모바일/PC 링크. 템플릿 등록 때 **고정 URL 로 심사**받으므로 변수 자리를 쓰지 않는다.
 * 그래서 운영 도메인(FALLBACK_SITE_ORIGIN = 사이트 정본 원점)으로 박는다 — 문자 문안의 링크가 요청 원점을 쓰는 것과 다른 점이다.
 */
export interface AlimtalkButton {
  /** 버튼에 보이는 이름. */
  name: string;
  /** 웹링크. 카카오 규격의 `WL`. */
  type: "WL";
  linkMo: string;
  linkPc: string;
}

export interface AlimtalkTemplate {
  event: NotifyEvent;
  /** 사람이 목록에서 구분하는 이름. 카카오 템플릿 코드는 등록 시 발급받는 값이라 여기서 지어내지 않는다. */
  name: string;
  /** 심사 제출본. `#{변수}` 자리는 renderAlimtalk 이 채운다. */
  body: string;
  variables: readonly string[];
  /** 본문에 URL 을 적지 않는 대신 붙이는 웹링크 버튼(심사 제출본의 일부). */
  buttons: readonly AlimtalkButton[];
}

const ALIMTALK_VARIABLES = ["접수번호", "상담전화"] as const;

/** 고정 URL 웹링크 버튼 하나. */
const webLink = (name: string, pathname: string): AlimtalkButton => ({
  name,
  type: "WL",
  linkMo: `${FALLBACK_SITE_ORIGIN}${pathname}`,
  linkPc: `${FALLBACK_SITE_ORIGIN}${pathname}`,
});

export const ALIMTALK_TEMPLATES: readonly AlimtalkTemplate[] = [
  {
    event: "created",
    name: "견적 신청 접수 안내",
    body: lines(
      `${BRAND} 견적 신청이 접수되었습니다.`,
      "",
      "접수번호 #{접수번호}",
      VERBATIM.bookingNotice,
      "",
      "접수 내용은 예약확인 화면에서 접수번호와 휴대폰 뒷 4자리로 확인하실 수 있습니다.",
      "문의 #{상담전화}",
    ),
    variables: ALIMTALK_VARIABLES,
    buttons: [webLink("예약확인", RESERVATION_CHECK_PATH)],
  },
  {
    event: "confirmed",
    // 문자 확정본과 같은 순서다: 일어난 일 → 앞으로 할 일 → 늘 붙는 고지(verbatim 은 맨 아래).
    // 확정 선언 바로 뒤에 verbatim 이 오면 아직 확정 전인 것처럼 읽힌다 — 채널이 달라도 같은 결함이다.
    name: "예약 확정 안내",
    body: lines(
      `${BRAND} ${CONFIRMED_HEADLINE}`,
      "",
      "접수번호 #{접수번호}",
      PAYMENT.line,
      CANCELLATION.smsLine,
      WITHDRAWAL.smsLine,
      PAYMENT.accountLine,
      "",
      "예약 내용은 예약확인 화면에서 접수번호와 휴대폰 뒷 4자리로 확인하실 수 있습니다.",
      "예약 변경·취소는 #{상담전화} 로 전화 주시면 도와드립니다.",
      "",
      VERBATIM.bookingNotice,
    ),
    variables: ALIMTALK_VARIABLES,
    // R3 [P2-H]: 문자의 "자세한 내용 <origin>/guide" 에 해당하는 링크를 **버튼으로** 담는다(본문 URL 금지 규칙은 그대로).
    buttons: [webLink("예약확인", RESERVATION_CHECK_PATH), webLink("이용안내", GUIDE_PATH)],
  },
];

/**
 * 심사 제출본의 `#{…}` 자리를 채운다. 채우지 못한 자리가 남으면 throw — `#{접수번호}` 가 그대로 나간 문자는
 * 고객에게는 오류로 보이고, 카카오에는 템플릿 불일치로 보인다.
 */
export function renderAlimtalk(event: NotifyEvent, values: Record<string, string>): string {
  const template = ALIMTALK_TEMPLATES.find((t) => t.event === event);
  // 문구에 "이벤트" 라는 낱말을 쓰지 않는다 — 광고 표현 정적 검사(tests/notify-templates.test.ts §5)가 소스 전체를 본다.
  if (!template) throw new Error(`renderAlimtalk: 등록되지 않은 알림 종류다 (${event})`);
  const missing = template.variables.filter((v) => typeof values[v] !== "string" || values[v] === "");
  if (missing.length > 0) {
    throw new Error(`renderAlimtalk: 채우지 못한 변수가 있다 (${missing.join(", ")}) — 미치환 자리를 그대로 보내지 않는다`);
  }
  return template.variables.reduce((body, name) => body.split(`#{${name}}`).join(values[name]), template.body);
}
