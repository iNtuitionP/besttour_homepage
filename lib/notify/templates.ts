/**
 * 문자·알림톡 문안 (플랜 v4 P4-3 · ADR-7 · CLAUDE.md §3).
 *
 * 아웃박스(outbox.ts)는 `template` **키**만 저장하고, 발송기(worker.ts)는 그 키를 그대로 sender 에게 넘긴다.
 * 문안이 사는 곳은 여기 하나다. 제공자 호출(P4-2)도, env 도, DB 도 여기 없다 — 값을 받아 문자열을 내는 순수 모듈이다.
 * 그래서 렌더 결과의 바이트 수를 테스트가 정확히 셀 수 있고, 발송 없이도 문안을 검증할 수 있다.
 *
 * 지키는 것 네 가지
 * ---------------------------------------------------------------------------
 * 1. **verbatim 은 한 바이트도 바뀌지 않는다.** 접수 안내 문구("확인 후 연락드리겠습니다.")는 원장
 *    (../legal/disclosures VERBATIM.bookingNotice)에서 가져다 그대로 끼운다. 길이가 모자라면 **다른 문장을 줄인다** — 이 문장은
 *    SMS 판에도 그대로 남는다(tests/notify-templates.test.ts §1 이 hex 로 대조한다).
 *    **접수 문자·접수 알림톡에만 넣는다.** 확정 문자·확정 알림톡에는 넣지 않는다(사장님 요청 7 · 결정 3-2, 2026-10-10 · T2-2) —
 *    이미 확정된 예약에 "확인 후 연락드리겠습니다" 가 붙으면 아직 확정 전인 것처럼 읽혀 뜻이 뒤집힌다.
 * 2. **정보성 문자에 광고 표현 0.** 할인·이벤트·특가 같은 낱말이 하나라도 섞이면 정보통신망법 §50 상 광고성 정보가 되어
 *    제목의 `(광고)` 표기와 무료 수신거부 번호 고지 의무가 생긴다 — 우리는 그 둘을 만들지 않았고, 만들 계획도 없다.
 *    `marketing_consent` 를 받은 사람에게도 **이 템플릿으로는** 광고를 보내지 않는다(광고 발송은 별도 템플릿·별도 태스크).
 *    반대로 `(광고)`·수신거부 문구를 정보성 문자에 미리 붙여 두지도 않는다 — 붙이는 순간 광고로 읽힌다.
 * 3. **법정 문구·회사 정보 리터럴 0.** 대표전화·결제 안내·상호를 여기 다시 타이핑하지 않는다. 전부 원장 상수다.
 *    안내 문장(법정 문구가 아닌 것)은 여기 두어도 된다 — 그것이 이 파일의 일이다.
 * 4. **개인정보는 사장님 템플릿에만.** 고객 문자는 `CustomerVars`(접수번호·원점 — 접수번호는 T2-5 부터 고객 문안에 쓰지 않는다)만 받는다 — 타입에 이름·번호가 없어
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
 * 실제 결과: 고객 접수 문자는 verbatim(UTF-8 36바이트 — 2026-10-10 새 문장) · 예약확인 링크 · 문의 전화를 다 담으면
 * 90바이트를 넘고, 고객 확정 문자는 약관 제8조 고지 줄 때문에, 사장님 문자 2종은 필수 항목이 많아서 **전부 LMS 로 나간다.**
 * 줄일 수 있는 것은 이미 줄였고, 남은 것은 규약이 요구하는 내용뿐이다(옛 verbatim 은 81바이트였다).
 *
 * 블록 서식 (T2-4 · 사장님 요청 8 · 결정 12 — 2026-10-10 사용자 승인 초안 그대로)
 * ---------------------------------------------------------------------------
 * 손님 접수·확정 · 사장님 접수 알림(문자·메일 폴백) · 알림톡 2종이 같은 틀이다: 첫 줄 `[브랜드] 제목` → `■ 섹션` → `- 라벨: 값`.
 * 기호는 KS X 1001 에 있는 것(■ · - · → · 가운뎃점)만 쓰고 이모지는 쓰지 않는다 — 제공자가 EUC-KR 로 바꿀 때 깨지지 않게.
 * 위 사정(어느 문안도 90바이트에 들어가지 않는다) 때문에 **SMS 판과 LMS 판이 같은 본문**이다 — 보낼 한 통이 곧 승인 초안이다.
 * LMS 제목은 따로 두지 않았다(위험 #12 — 둔다면 `subject` 가 아니라 별도 필드여야 한다. `subject` 는 메일 가드가 본다).
 */
import { CANCELLATION, COMPANY, PAYMENT, VERBATIM, WITHDRAWAL } from "../legal/disclosures";
import { domesticPhoneText } from "../phone-format";
import { formatPublicDate, type PublicDateLabels } from "../public-date";
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

/** 예약확인 화면 경로 — app/[locale]/(site)/reservation/check/page.tsx. 휴대폰 번호 + 예약자 이름으로 조회한다(T2-5). */
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

/** 발신 브랜드 표기. 원장의 브랜드명으로 만든다 — 상호를 여기 다시 적지 않는다. (2026-10-10 간판 변경: [베스트투어] → [베스트모빌리티]) */
const BRAND = `[${COMPANY.brandName}]`;

/**
 * 계약 주체 줄 — 고객 확정 문자·알림톡의 **맨 아래**에 붙는다(사장님 요청 14 · 결정 12 · T2-1, 2026-10-10).
 * 접두가 간판 브랜드([베스트모빌리티])로 바뀌어도 계약 상대가 법정 상호(합자회사 베스트투어 — 원장 COMPANY.legalName)라는 사실이
 * 확정 통지에 남게 한다. 입금 계좌 줄의 예금주((주)베스트모빌리티)와 함께 읽혀 계약 주체·대금 수령 주체가 갈린다는 것도 드러난다
 * (사이트 푸터의 RELATED_COMPANY.note 와 같은 사실). 상호는 원장에서 조립한다 — 여기 다시 적지 않는다.
 */
export const CONTRACT_PARTY_LINE = `운영: ${COMPANY.legalName}`;

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
  /**
   * reservations.public_code — 8자 내부 식별자. T2-5(결정 5)부터 **고객 문안에는 쓰지 않는다**(예약확인은 휴대폰 번호 + 예약자 이름).
   * 사장님 알림(OwnerVars 가 상속)과 사장님 발송 실패 알림이 어느 예약인지 가리키는 데 쓴다.
   */
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
  /**
   * 접수 경로(0023). `quick`(홈 간편 견적 — P3-8)은 차종·여행 구분·출발 시각·왕복 구분·대수를 받지 않았다 —
   * 문안은 제목에 "(간편 접수)" 를 적고 날짜만 싣는다. `wizard`(옛 6단계 접수분)는 "(상세 접수)" 와 시각·차량·대수를 싣는다.
   * (T2-4 · 사장님 요청 11 — 옛 "전화로 확인할 것" 줄은 뺐다.)
   */
  intake: "wizard" | "quick";
  /** 표시용 차량 라벨(vehicles.name_ko). 코드가 아니라 사람이 읽는 값이다. 간편 접수는 null(차종 미정). */
  vehicleLabel: string | null;
  /** 위저드: KST 벽시계 `YYYY-MM-DD HH:mm`(kstWallClock). 간편: KST 달력 날짜 `YYYY-MM-DD`(시각은 자리값이라 싣지 않는다). */
  departAtKst: string;
  /** 간편 접수의 도착일 `YYYY-MM-DD` — 출발일과 같은 날이면 null. 위저드는 언제나 null(옛 문안은 귀가 일시를 싣지 않았다). */
  returnDateKst: string | null;
  originLabel: string;
  destinationLabel: string;
  /** 간편 접수는 null(대수 미정). */
  busCount: number | null;
  /** 미입력이면 null — 그 줄에서 인원만 뺀다(간편 접수는 필수라 언제나 값이 있다). */
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

// ── 블록 서식 조각 (T2-4) ──────────────────────────────────────────────────

/** 섹션 머리 `■ 제목`. ■ 는 KS X 1001(0xA1E1)에 있다. */
const section = (title: string): string => `■ ${title}`;
/** 항목 `- 값`. */
const item = (text: string): string => `- ${text}`;
/** 라벨 항목 `- 라벨: 값`. */
const labeled = (label: string, value: string): string => item(`${label}: ${value}`);

/**
 * 한 통의 본문이 SMS 판·LMS 판 두 벌로 같다(헤더 "블록 서식" — 어느 문안도 90바이트에 들어가지 않는다).
 * 선택 규칙(renderTemplate)은 그대로 두고 두 판에 같은 본문을 넣는다 — 그래서 보낼 한 통이 언제나 승인 초안이다.
 */
const sameBody = (body: string): MessageVariants => ({ sms: body, lms: body });

/** 같은 문자에서 줄을 나누거나 줄을 재배치할 수 있는 코드 포인트(C0·DEL·C1 밖의 것). C0·DEL·C1 은 아래 범위 검사가 잡는다. */
const LINE_FORGERS = new Set([
  0x2028, // LINE SEPARATOR
  0x2029, // PARAGRAPH SEPARATOR
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, // 제로폭 · 방향 표시
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // 방향 덮어쓰기
  0x2060, 0x2066, 0x2067, 0x2068, 0x2069, // 단어 잇기 · 방향 고립
  0xfeff, // BOM
]);

/**
 * 한 줄로 접는다 — 줄바꿈·탭·제어문자(C0·DEL·C1)·줄 구분자·방향 제어 문자를 공백으로 바꾸고, 이어진 공백은 하나로, 양끝은 걷는다.
 * **줄 위조 방지**(T2-4 · 계획 위험 표): 이름 입력(lib/types.ts — 길이 말고 문자 제한이 없다)에 줄바꿈을 넣어 `■ 운행` · `접수번호 …` 같은
 * 가짜 줄을 사장님 알림에 끼워 넣지 못하게 한다. 저장값은 바꾸지 않는다 — 보내는 글자만 접는다(이미 저장된 행에도 듣는다).
 */
export function oneLine(raw: string): string {
  let out = "";
  for (const ch of raw ?? "") {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || (c >= 0x7f && c <= 0x9f) || LINE_FORGERS.has(c) ? " " : ch;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/**
 * 문자의 날짜 틀 — 공개 화면 날짜 헬퍼(lib/public-date.ts formatPublicDate — KST 벽시계를 그대로 읽는다)에 넘긴다.
 * 승인 초안 모양 "11월 3일(화)"(괄호 앞 붙임 — 문자는 한 줄이 짧아서)이라 카탈로그 common.dates 의 틀("11월 3일 (화)")과 빈칸 하나가 다르다.
 * **연도는 싣지 않는다**(dayYear = day): 이 모듈에는 시계가 없다(순수 — 같은 입력은 언제나 같은 바이트). 그래서 헬퍼의 "올해" 판정도
 * 고정 시각(NO_CLOCK)으로 막아 둔다 — 어느 쪽 틀이 골라져도 글자는 같다. 날짜를 잘못 읽을 일은 요일과 관리자 링크가 막는다.
 */
const SMS_DATE_LABELS: PublicDateLabels = {
  weekdays: ["일", "월", "화", "수", "목", "금", "토"],
  months: Array.from({ length: 12 }, (_, i) => String(i + 1)),
  day: "{month}월 {day}일({weekday})",
  dayYear: "{month}월 {day}일({weekday})",
  date: "{month}월 {day}일",
  time: "{hour}:{minute}",
  dateTime: "{date} {time}",
};
const NO_CLOCK = new Date(0);

/** KST 벽시계(`YYYY-MM-DD` · `YYYY-MM-DD HH:mm`) → "11월 3일(화)" · 시각을 달면 "10월 3일(토) 08:00". 읽을 수 없으면 원래 값 그대로. */
const smsDate = (kst: string, withTime: boolean): string =>
  formatPublicDate(kst, SMS_DATE_LABELS, { style: "schedule", time: withTime, now: NO_CLOCK }) ?? kst;

const route = (v: OwnerVars): string => `${oneLine(v.originLabel)} → ${oneLine(v.destinationLabel)}`;

/** 운행 날짜 — 간편 접수는 날짜만(같은 날이면 "… 당일", 다르면 "… ~ …" · 저장된 00:00 은 자리값), 위저드는 출발 일시. */
const tripDate = (v: OwnerVars): string => {
  if (v.intake !== "quick") return smsDate(v.departAtKst, true);
  const from = smsDate(v.departAtKst, false);
  return v.returnDateKst === null ? `${from} 당일` : `${from} ~ ${smsDate(v.returnDateKst, false)}`;
};

/** 제목의 접수 경로 — 관리자 상세의 낱말과 같다(admin 카탈로그 intakeWizard "상세 접수" · quickBadge "간편 접수"). */
const INTAKE_LABEL: Record<OwnerVars["intake"], string> = { quick: "간편 접수", wizard: "상세 접수" };

/** 사장님 알림의 첫 줄 — 문자·메일 본문의 맨 위이자 메일 제목의 앞부분. */
const ownerHeadline = (v: OwnerVars): string => `${BRAND} 새 견적 신청 (${INTAKE_LABEL[v.intake]})`;

/**
 * 사장님 접수 알림 — 간편 접수 · 위저드 접수 · 메일 폴백이 같은 본문(T2-4 · 결정 12 · 승인 초안).
 *   [브랜드] 새 견적 신청 (간편 접수|상세 접수)
 *   ■ 고객  - 이름 / 010-xxxx-xxxx            (이름은 한 줄로 접는다 · 국내 휴대폰은 국내 표기, 해외 번호는 그대로 — 마스킹하지 않는다)
 *   ■ 운행  - 날짜 · 구간 · (위저드만) 차량 대수 · 인원(미입력이면 줄을 뺀다)
 *   관리자에서 보기 / 링크 / 접수번호(내부 식별자 — 사장님 알림에만 남는다)
 * 간편 접수는 차종·대수·시각을 받지 않았으므로 그 줄이 없다 — 지어내지 않는다. 옛 "전화로 확인할 것" 줄은 뺐다(사장님 요청 11).
 * verbatim 은 넣지 않는다: "확인 후 연락드리겠습니다" 는 고객에게 하는 약속이고, 사장님에게 되돌려 보내면 뜻이 뒤집힌다.
 */
function ownerVariants(v: OwnerVars): MessageVariants {
  const wizard = v.intake !== "quick";
  return sameBody(
    lines(
      ownerHeadline(v),
      "",
      section("고객"),
      item(`${oneLine(v.name)} / ${oneLine(domesticPhoneText(v.phone))}`),
      section("운행"),
      labeled("날짜", tripDate(v)),
      labeled("구간", route(v)),
      wizard ? labeled("차량", `${oneLine(v.vehicleLabel ?? "")} ${v.busCount}대`) : null,
      v.passengers === null ? null : labeled("인원", `${v.passengers}명`),
      "",
      "관리자에서 보기",
      adminLink(v),
      `접수번호 ${v.publicCode}`,
    ),
  );
}

/**
 * 예약확인 방법 한 항목 — 손님 접수 문자·접수 알림톡의 `■ 예약 확인` 블록(T2-5 · 결정 5 → T2-4 블록 서식).
 * 예약확인은 **휴대폰 번호와 예약자 이름**으로 조회한다(app/[locale]/(site)/reservation/check). 접수번호는 손님에게 보이지 않는
 * 내부 식별자다(사장님 알림·실패 알림에만 있다). T2-4 전에는 문장 꼬리 CHECK_GUIDE_TAIL("…확인하실 수 있습니다.")이었다.
 */
export const CHECK_GUIDE_ITEM = "휴대폰 번호와 예약자 이름으로 조회";

/**
 * 고객 접수 확인 — 승인 초안: [브랜드] 견적 신청 접수 / verbatim / ■ 예약 확인(주소 · 조회 방법) / ■ 문의(전화).
 * verbatim("확인 후 연락드리겠습니다.")은 여기 남긴다(T2-2 판단, 2026-10-10): 접수 직후에 보내는 문자라 "확인한 뒤 연락한다" 는 뜻이
 * 사실과 맞는다. 사이트의 완료 화면·예약 확인 카드(접수 상태)와 같은 말이다. 줄 전체로 한 번 — 바이트 그대로.
 * 주소는 지금 문자와 같은 형식(origin + 경로 = `https://…`)을 유지한다 — 문자앱이 링크로 알아본다(초안은 `https://` 를 줄여 적었다).
 * 전화는 원장 COMPANY.consultTel — 손님에게 "여기로 전화하라" 고 안내하는 번호다(사이트의 전화번호는 이것 하나 — P7-5).
 */
function createdCustomerVariants(v: CustomerVars): MessageVariants {
  return sameBody(
    lines(
      `${BRAND} 견적 신청 접수`,
      "",
      VERBATIM.bookingNotice,
      "",
      section("예약 확인"),
      item(checkLink(v)),
      item(CHECK_GUIDE_ITEM),
      section("문의"),
      item(COMPANY.consultTel),
    ),
  );
}

/**
 * 확정 문자·알림톡의 제목 — 첫 줄 `[브랜드] 예약 확정 안내`(승인 초안). T2-4 전에는 문장 "예약이 확정되었습니다." 였다.
 * verbatim("확인 후 연락드리겠습니다.")은 확정 문자·알림톡에 넣지 않는다 — 확정 통지에 붙으면 아직 확정 전인 것처럼 읽힌다
 * (사장님 요청 7 · 결정 3-2, 2026-10-10 · T2-2). tests/notify-templates.test.ts §1 · tests/booking-notice-t2-2.test.ts 가 그 부재를 잠근다.
 */
export const CONFIRMED_HEADLINE = "예약 확정 안내";

/** 확정 통지의 `■ 대금` · `■ 취소·환불` 블록 — 문자·알림톡이 같다. 줄은 전부 원장에서 온다(지어내지 않는다). */
const confirmedNoticeBlocks = (): string[] => [
  section("대금"),
  item(PAYMENT.smsDeposit),
  item(PAYMENT.smsBalance),
  item(PAYMENT.smsAccount),
  // 예금주는 계좌 항목의 이어지는 줄(들여쓰기 두 칸) — 승인 초안 모양
  `  ${PAYMENT.smsAccountHolder}`,
  "",
  section("취소·환불"),
  // 원장 smsItem = smsLine 에서 머리말 "취소·환불 : " 만 뺀 같은 문장 — 섹션 제목과 낱말이 두 번 나오지 않게(T2-4 후속, 컨트롤러 원장 추가).
  item(CANCELLATION.smsItem),
  item(WITHDRAWAL.smsLine),
];

/**
 * 고객 확정 안내 — 승인 초안: [브랜드] 예약 확정 안내 / ■ 대금 / ■ 취소·환불 / ■ 예약 확인·변경 / 운영: 합자회사 베스트투어.
 * 접수번호 줄은 없다(T2-5). 운행일·구간·인원은 넣지 않는다(결정 12 · 위험 #11 — 관리자가 고칠 수 없는 접수값이 확정 내용처럼 나간다).
 *
 * 약관 제8조가 약속한 "예약 확정 통지에서의 고지"(P1-7 R2 [P1-4] · 위험 #9): verbatim 만 빠지고 대금 · 입금 계좌 · 취소·환불 ·
 * 청약철회 제한 · 이용안내(절대 URL) 줄은 모두 남는다. 대금 줄은 원장 PAYMENT.sms*(약관 제6조와 같은 뜻 — 컨트롤러 원장 작성),
 * 취소 줄은 원장 CANCELLATION.smsItem(smsLine 에서 머리말만 뺀 같은 문장), 청약철회 줄은 원장 WITHDRAWAL.smsLine 그대로. 맨 아래는 계약 주체 줄(CONTRACT_PARTY_LINE — T2-1) — 서명처럼 마지막에 둔다.
 * 이 줄들을 빼서 90바이트 SMS 에 맞추지 않는다 — 확정 통지는 **LMS 로만** 나간다(renderTemplate 의 선택 규칙 그대로 · 테스트가 잠근다).
 */
function confirmedCustomerVariants(v: CustomerVars): MessageVariants {
  return sameBody(
    lines(
      `${BRAND} ${CONFIRMED_HEADLINE}`,
      "",
      ...confirmedNoticeBlocks(),
      "",
      section("예약 확인·변경"),
      labeled("확인", checkLink(v)),
      labeled("변경·취소", COMPANY.consultTel),
      labeled("이용안내", guideLink(v)),
      "",
      CONTRACT_PARTY_LINE,
    ),
  );
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
 * verbatim 은 넣지 않는다 — "확인 후 연락드리겠습니다" 는 **고객에게 하는 약속**이지 사장님께 하는 보고가 아니다
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
  // 사장님 번호가 없을 때의 폴백(outbox.ts planNotifications). 본문은 같고 제목만 더 붙는다 — 제목 = 본문 첫 줄 + 접수번호(T2-4).
  "created.owner.email": (v) => ({
    ...ownerVariants(v),
    subject: `${ownerHeadline(v)} ${v.publicCode}`,
  }),
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
 * created 의 심사 제출본은 이렇게 생겼다(접두는 원장 brandName — 2026-10-10 간판 변경 · T2-4 블록 서식 — 문자와 같은 순서):
 *   [베스트모빌리티] 견적 신청 접수
 *
 *   확인 후 연락드리겠습니다.
 *
 *   ■ 예약 확인
 *   - 아래 '예약확인' 버튼
 *   - 휴대폰 번호와 예약자 이름으로 조회
 *   ■ 문의
 *   - #{상담전화}
 *
 * 문자의 주소 줄 자리에는 **버튼 이름**을 적는다(아래 본문 URL 금지 규칙) — 그 이름은 buttons 의 name 과 같은 상수에서 온다.
 * 아직 카카오 심사 전이라 재심사 비용 없이 바꿀 수 있다(계획 T2-4).
 *
 * T2-5(결정 5, 2026-10-10): 접수번호 줄과 변수 `#{접수번호}` 를 뺐다 — 손님은 휴대폰 번호와 이름으로 조회한다(접수번호는 내부 식별자).
 * 아직 카카오 심사 전이라 변수 목록을 바꿀 수 있다. 남은 변수는 `#{상담전화}` 하나다.
 *
 * 링크는 본문 URL 이 아니라 **버튼(웹링크)** 으로 붙인다 — 심사에서 본문 URL 은 광고성으로 걸리기 쉽고, 버튼은
 * 템플릿 등록 시 고정 URL 로 심사받는다. 그래서 본문에는 경로를 적지 않는다. **버튼 정의는 이 파일의 `buttons` 다**
 * (R3 [P2-H] — 예전에는 "콘솔에서 등록한다" 는 주석뿐이어서 초안만으로는 심사에 낼 수 없었다). 콘솔 등록 때 이 값을 그대로 옮긴다.
 * 대체(실패 시 문자) 문안은 위 renderTemplate 의 같은 이벤트 문안을 그대로 쓴다.
 *
 * P1-7 R2 [P1-4] — 확정 알림톡에도 문자와 같은 원장 줄(대금 · 입금 계좌 · 취소·환불 · 청약철회 제한)을 같은 블록(confirmedNoticeBlocks)으로 둔다.
 * 문자의 "이용안내" 링크(GUIDE_PATH)는 알림톡에서는 버튼(웹링크)으로 등록한다(위 규칙 — P4-2 연동 때 콘솔에).
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

const ALIMTALK_VARIABLES = ["상담전화"] as const;

/** 버튼 이름 — 버튼 정의와 본문의 "아래 '…' 버튼" 이 같은 상수를 쓴다(이름이 갈리면 손님이 버튼을 못 찾는다). */
const CHECK_BUTTON = "예약확인";
const GUIDE_BUTTON = "이용안내";
const below = (button: string): string => `아래 '${button}' 버튼`;

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
    // 문자 접수본과 같은 순서(T2-4) — 주소 줄 자리에 버튼 이름, 전화 자리에 #{상담전화}.
    body: lines(
      `${BRAND} 견적 신청 접수`,
      "",
      VERBATIM.bookingNotice,
      "",
      section("예약 확인"),
      item(below(CHECK_BUTTON)),
      item(CHECK_GUIDE_ITEM),
      section("문의"),
      item("#{상담전화}"),
    ),
    variables: ALIMTALK_VARIABLES,
    buttons: [webLink(CHECK_BUTTON, RESERVATION_CHECK_PATH)],
  },
  {
    event: "confirmed",
    // 문자 확정본과 같은 순서다(T2-4): 제목 → ■ 대금 → ■ 취소·환불 → ■ 예약 확인·변경 → 맨 아래 계약 주체 줄(T2-1).
    // verbatim("확인 후 연락드리겠습니다.")은 넣지 않는다 — 확정 통지에 붙으면 아직 확정 전인 것처럼 읽힌다(T2-2 · 결정 3-2). 채널이 달라도 같다.
    name: "예약 확정 안내",
    body: lines(
      `${BRAND} ${CONFIRMED_HEADLINE}`,
      "",
      ...confirmedNoticeBlocks(),
      "",
      section("예약 확인·변경"),
      labeled("확인", below(CHECK_BUTTON)),
      labeled("변경·취소", "#{상담전화}"),
      labeled("이용안내", below(GUIDE_BUTTON)),
      "",
      CONTRACT_PARTY_LINE,
    ),
    variables: ALIMTALK_VARIABLES,
    // R3 [P2-H]: 문자의 "이용안내: <origin>/guide" 에 해당하는 링크를 **버튼으로** 담는다(본문 URL 금지 규칙은 그대로).
    buttons: [webLink(CHECK_BUTTON, RESERVATION_CHECK_PATH), webLink(GUIDE_BUTTON, GUIDE_PATH)],
  },
];

/**
 * 심사 제출본의 `#{…}` 자리를 채운다. 채우지 못한 자리가 남으면 throw — `#{상담전화}` 가 그대로 나간 문자는
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
