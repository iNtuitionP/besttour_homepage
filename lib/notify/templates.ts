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
import { COMPANY, PAYMENT, VERBATIM } from "../legal/disclosures";
import type { NotifyEvent } from "../types";
import { TEMPLATE_KEYS, type TemplateKey } from "./outbox";

// =============================================================================
// 상수
// =============================================================================

/** 단문(SMS) 상한. UTF-8 바이트로 잰다 — 헤더 "SMS / LMS 선택" 참조. */
export const SMS_BYTE_LIMIT = 90;

/** 장문(LMS) 상한. 넘으면 자르지 않고 throw 한다 — verbatim 을 잘라 보내는 것보다 보내지 않는 편이 낫다. */
export const LMS_BYTE_LIMIT = 2000;

/** 예약확인 화면 경로 — app/[locale]/(site)/reservation/check/page.tsx. 접수번호 + 휴대폰 뒷 4자리로 조회한다. */
export const RESERVATION_CHECK_PATH = "/reservation/check";

/** 관리자 예약 목록 경로 — app/admin/(protected)/reservations. 상세는 `${…}/{reservationId}`. */
export const ADMIN_RESERVATIONS_PATH = "/admin/reservations";

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

/** 키 → 그 키가 요구하는 입력. 고객 키에 OwnerVars 를 넘길 수는 있어도 그 반대는 컴파일이 막는다. */
export interface TemplateVarsByKey {
  "created.owner.sms": OwnerVars;
  "created.owner.email": OwnerVars;
  "created.customer.sms": CustomerVars;
  "confirmed.customer.sms": CustomerVars;
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
 * 고객 접수 확인 — 접수번호 + verbatim + 예약확인 안내 + 대표전화(브리프 Part 1).
 * 예약확인은 접수번호와 휴대폰 뒷 4자리로 조회한다(app/[locale]/(site)/reservation/check). 문구는 그 화면과 같은 말을 쓴다.
 */
function createdCustomerVariants(v: CustomerVars): MessageVariants {
  return {
    sms: lines(`${BRAND} 접수 ${v.publicCode}`, VERBATIM.bookingNotice, `확인 ${checkLink(v)} · 문의 ${COMPANY.tel}`),
    lms: lines(
      `${BRAND} 견적 신청이 접수되었습니다.`,
      "",
      `접수번호 ${v.publicCode}`,
      VERBATIM.bookingNotice,
      "",
      `접수 내용은 ${checkLink(v)} 에서 접수번호와 휴대폰 뒷 4자리로 확인하실 수 있습니다.`,
      `문의 ${COMPANY.tel}`,
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
 */
function confirmedCustomerVariants(v: CustomerVars): MessageVariants {
  return {
    sms: lines(`${BRAND} 확정 ${v.publicCode}`, PAYMENT.line, `문의 ${COMPANY.tel}`, VERBATIM.bookingNotice),
    lms: lines(
      `${BRAND} ${CONFIRMED_HEADLINE}`,
      "",
      `접수번호 ${v.publicCode}`,
      PAYMENT.line,
      "",
      `예약 내용은 ${checkLink(v)} 에서 접수번호와 휴대폰 뒷 4자리로 확인하실 수 있습니다.`,
      `예약 변경·취소는 ${COMPANY.tel} 로 전화 주시면 도와드립니다.`,
      "",
      VERBATIM.bookingNotice,
    ),
  };
}

/** 키 → 두 벌을 만드는 함수. 키는 TEMPLATE_KEYS 그대로다 — 새 키를 만들지 않는다. */
type BuilderMap = { [K in TemplateKey]: (vars: TemplateVarsByKey[K]) => MessageVariants };

const BUILDERS: BuilderMap = {
  "created.owner.sms": ownerVariants,
  // 사장님 번호가 없을 때의 폴백(outbox.ts planNotifications). 본문은 같고 제목만 더 붙는다.
  "created.owner.email": (v) => ({ ...ownerVariants(v), subject: `${BRAND} 새 예약 접수 ${v.publicCode}` }),
  "created.customer.sms": createdCustomerVariants,
  "confirmed.customer.sms": confirmedCustomerVariants,
};

const isTemplateKey = (key: string): key is TemplateKey => (TEMPLATE_KEYS as readonly string[]).includes(key);

/** 두 벌을 그대로 돌려준다 — 바이트 표를 만들거나 두 판을 나란히 검사할 때. */
export function renderVariants<K extends TemplateKey>(key: K, vars: TemplateVarsByKey[K]): MessageVariants {
  if (!isTemplateKey(key)) {
    throw new Error(`renderVariants: 알 수 없는 템플릿 키다 (${String(key)}) — 키는 outbox.ts TEMPLATE_KEYS 뿐이다`);
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
 *   문의 #{대표전화}
 *
 * 링크는 본문 URL 이 아니라 **버튼(웹링크)** 으로 붙인다 — 심사에서 본문 URL 은 광고성으로 걸리기 쉽고, 버튼은
 * 템플릿 등록 시 고정 URL 로 심사받는다. 그래서 본문에는 경로를 적지 않았다. 버튼 정의는 발송 연동(P4-2)에서
 * 제공자 콘솔에 등록한다. 대체(실패 시 문자) 문안은 위 renderTemplate 의 같은 이벤트 문안을 그대로 쓴다.
 */
export interface AlimtalkTemplate {
  event: NotifyEvent;
  /** 사람이 목록에서 구분하는 이름. 카카오 템플릿 코드는 등록 시 발급받는 값이라 여기서 지어내지 않는다. */
  name: string;
  /** 심사 제출본. `#{변수}` 자리는 renderAlimtalk 이 채운다. */
  body: string;
  variables: readonly string[];
}

const ALIMTALK_VARIABLES = ["접수번호", "대표전화"] as const;

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
      "문의 #{대표전화}",
    ),
    variables: ALIMTALK_VARIABLES,
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
      "",
      "예약 내용은 예약확인 화면에서 접수번호와 휴대폰 뒷 4자리로 확인하실 수 있습니다.",
      "예약 변경·취소는 #{대표전화} 로 전화 주시면 도와드립니다.",
      "",
      VERBATIM.bookingNotice,
    ),
    variables: ALIMTALK_VARIABLES,
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
