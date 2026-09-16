/**
 * 통합 카피 금지 목록 — **여기가 단일 원장이다** (P6-6 신설 · P6-12 에서 `tests/helpers/` 로부터 이동).
 *
 * 왜 생겼나: 2026-09-15 독립 감사(P6-6-audit.md)가 같은 종류의 목록이 세 벌로 갈라져 있고
 * 서로 범위가 다르다는 것을 찾았다. 가장 엄격한 목록(`PRICE_TABLE` 의 `저렴`·`최저`)이
 * `pages.fares` 한 곳에만 걸려 있어서, 프로젝트가 스스로 "비교 광고 표현"이라 판정한 문장이
 * 홈(`home.*`)과 위저드(`quote.*`)에서는 다섯 군데 그대로 배포되고 있었다.
 * 목록을 여기 하나로 모아 **새 네임스페이스가 자동으로 무검사가 되는 구조**를 끝낸다.
 *
 * 왜 `lib/` 로 옮겼나 (P6-12 · known-defects D4): 사장님이 관리자 화면에서 쓰는 글(공지·팝업·사진 설명·앨범 이름)은
 * DB 행이라 소스 게이트가 보지 못한다. 저장할 때 **경고**를 띄우려면 앱 코드가 이 목록을 읽어야 하는데,
 * `tests/` 아래 모듈은 앱이 import 할 수 없다. 두 벌을 만들면 P6-6 이 없앤 사고가 되살아나므로 **옮기고**,
 * `tests/helpers/forbidden-copy.ts` 는 이 파일을 그대로 re-export 한다(기존 테스트 무수정).
 *
 * 쓰는 곳
 *   - tests/copy-rules.test.ts  — ko.json **전 네임스페이스** · en.json · components/** · app/[locale]/** (전역)
 *   - tests/home.test.ts        — components/home/** + ko.json home.*      (기존 단언 구조 유지)
 *   - tests/pages.test.ts       — 서브페이지 소스 + ko.json pages.*        (기존 단언 구조 유지)
 *                                 + PRICE_LITERALS 는 pages.fares 에만
 *   - lib/admin/copyCheck.ts    — 관리자 저장 시 경고(OWNER_COPY_RULES). **앱에서 이 파일을 import 하는 유일한 곳**이다.
 *
 * 규약 0 — **`server-only` 를 붙이지 않는다.** 위 세 테스트가 mock 없이 import 한다(붙이면 vitest 에서 import 즉시 throw).
 * 대신 앱 쪽 유일한 소비자 `lib/admin/copyCheck.ts` 가 `server-only` 라 클라이언트 번들로 새는 경로를 빌드가 막고,
 * tests/admin-copy-warning.test.ts 가 "이 파일을 값으로 import 하는 앱 파일은 copyCheck.ts 하나" 를 단언한다.
 *
 * 규약 1 — **금지어 리터럴을 적지 마라.** 이 파일은 `lib/` 아래라
 * `scripts/check-legal-disclosures.sh` (c) 금지어 검사 **와 (d) 실증 불가 주장 검사**의 대상이다.
 * 코드 줄에 리터럴로 두면 게이트가 자기 자신을 잡는다. 그래서 금지어는 `cp()` 로 코드포인트에서 조립하고,
 * (d) 목록과 겹치는 라벨·패턴은 **끊어 적는다** — 문자열 이어 붙이기(`"4" + ",800"`), 정규식의 `\x2C`·빈 그룹 `(?:)`.
 * 런타임 값은 원문과 같다. (유니코드 이스케이프는 쓰지 마라 — 편집 도구가 원문 글자로 풀어 버린 적이 있다, P6-12.)
 * 주석 줄(`//` `*`)은 게이트가 제외하므로 설명에는 그대로 쓸 수 있다.
 *
 * 규약 2 — **빈 배열은 곧 전면 통과다.** 소비하는 테스트는 반드시 길이 하한을 먼저 단언한다.
 * 목록이 실수로 비면 모든 검사가 green 이 되는 사고 모양을 이 프로젝트가 이미 겪었다.
 *
 * 규약 3 — **정규식에 `g` 플래그를 쓰지 마라.** `lastIndex` 가 남아 같은 규칙을 두 번째 돌릴 때
 * 조용히 빗나간다. 여기 규칙은 전부 무상태다.
 */
import { COMPANY } from "@/lib/legal/disclosures";

import type { OwnerCopyKind } from "./kinds";

export { OWNER_COPY_KINDS, type OwnerCopyKind } from "./kinds";

/** [사람이 읽는 라벨, 패턴] — 실패 메시지에 라벨이 찍힌다. */
export type CopyRule = readonly [label: string, pattern: RegExp];

/** 코드포인트 조립 — 규약 1. */
const cp = (...codes: number[]) => String.fromCharCode(...codes);

// ── (1) 금지어 — 부분 문자열. CLAUDE.md §3 · soul §10.2 ────────────────────────
// 면허("등록"이 맞다) · 전세버스하나(타사 상호) · 나가는 버스 · 태우고 나가 · 공차 · 회송(BM 비노출)
const W_LICENSE = cp(0xba74, 0xd5c8);
const W_RIVAL = cp(0xc804, 0xc138, 0xbc84, 0xc2a4, 0xd558, 0xb098);
const W_BM_OUTBOUND = cp(0xb098, 0xac00, 0xb294, 0x20, 0xbc84, 0xc2a4);
const W_BM_TAKEOUT = cp(0xd0dc, 0xc6b0, 0xace0, 0x20, 0xb098, 0xac00);
const W_BM_EMPTY = cp(0xacf5, 0xcc28);
const W_BM_RETURN = cp(0xd68c, 0xc1a1);

/** 금지어와 그 분류 — 금지어의 정의는 이 표 하나다(FORBIDDEN_WORDS 는 여기서 파생한다). */
export const FORBIDDEN_WORD_KINDS: ReadonlyArray<readonly [word: string, kind: OwnerCopyKind]> = [
  [W_LICENSE, "license"],
  [W_RIVAL, "rival"],
  [W_BM_OUTBOUND, "internal"],
  [W_BM_TAKEOUT, "internal"],
  [W_BM_EMPTY, "internal"],
  [W_BM_RETURN, "internal"],
];

export const FORBIDDEN_WORDS: readonly string[] = FORBIDDEN_WORD_KINDS.map(([word]) => word);

// ── (2) 실증 불가 수치·주장 — 표시광고법 §5(실증책임) ──────────────────────────
// tests/home.test.ts(8건) + tests/pages.test.ts(17건) 의 합집합. 어느 한쪽에만 있던 것은 우연이었다.
// "2013년부터"는 원장 COMPANY.establishedYear 보간으로만 허용하므로, 리터럴 2013 과 "13년"(앞에 숫자 없는)을 잡는다.
/** 사장님 글에서는 빼는 규칙의 라벨(아래 (6) OWNER_TEXT_EXEMPT) — 문자열을 두 번 적지 않으려고 상수로 둔다. */
const L_YEAR_2013 = "2013 하드코딩 (원장 establishedYear 보간만 허용)";
const L_FOREIGN_TOURISTS = "외국인 관광객 (수치 문장)";

export const UNPROVEN_CLAIMS: readonly CopyRule[] = [
  // 이 줄의 `"4" + ",800"`·`/4\x2C800/` 과 아래 `무사고` 줄의 `"무" + "사고"`·`(?:)` 는 규약 1 의 조립이다(4,800 · 누적 견적 · 무사고).
  ["4" + ",800 (목업의 누적" + " 견적 건수)", /4\x2C800/],
  ["70만 (옛 사이트의 외국인 관광객 수)", /70만/],
  ["만 명", /만\s*명/],
  ["13년 (운행 연차)", /(?<!\d)13년/],
  ["17건 (목업의 오늘 접수 건수)", /17건/],
  ["연중무휴", /연중무휴/],
  ["누적", /누적/],
  ["운행 경력", /운행 경력/],
  [L_YEAR_2013, /(?<![\w-])2013(?![\w-])/],
  ["무" + "사고", /무(?:)사고/],
  ["사고 없", /사고\s*없/],
  ["큰 사고", /큰 사고/],
  ["차량 대수 주장", /\d+\s*대\s*(보유|의 차량|규모)/],
  ["연식", /연식/],
  ["년식", /년식/],
  [L_FOREIGN_TOURISTS, /외국인 관광객/],
  ["국토여행 (BM 노출)", /국토여행/],
  // 보험 — 원장 INSURANCE.body 와 그 출처(옛 사이트 bo_page=intro10)에는 "종합보험"이라는 **상품명**도,
  // "전 차량"이라는 **전칭**도 없다. 협력사 차량이 섞여 대수를 주장하지 못하는 것과 같은 이유로 전칭도 주장할 수 없다.
  // `전 차량` 은 앞 글자가 한글이면 제외한다 — "이전 차량"·"운전 차량" 오탐 방지.
  ["종합보험 (원장 INSURANCE 에 없는 상품명)", /종합보험/],
  ["전 차량 (전칭 — 협력사 차량이 섞여 실증 불가)", /(?<![가-힣])전\s*차량/],
  // `개 시도` 를 통째로 넣으면 "N개 시도(attempt)"와 충돌한다(감사 §6). 광역자치단체 개수를 세는 자리수만 잡는다 —
  // 16 은 세종이 빠진 틀린 숫자이고, 17 로 고치는 것도 또 다른 실증 대상이라 둘 다 막는다.
  ["N개 시도 (광역자치단체 개수 주장)", /1[5-9]\s*개\s*시도/],
  // ── P6-10 (감사 R-5·R-7·R-3) ────────────────────────────────────────────────
  // 소요시간 주장 — 같은 폼을 카탈로그가 "6단계"라고 부른다(quote.title). 1분을 측정한 기록이 없고,
  // 손님이 재 보면 어긋난다. `1분` 단독은 정당한 시간 안내(귀가 = 출발 + 1분 같은 경계 설명)와 부딪히므로
  // **견적 문맥에서만** 잡는다. 앞이 숫자면 제외 — "11분"·"21분"은 다른 말이다.
  ["1분 견적 (측정되지 않은 소요시간)", /(?<![\d.])1\s*분\s*(견적|신청|완료|만에)/],
  ["단 N분 (소요시간 주장)", /단\s*\d+\s*분/],
  // 기간 주장 — 쓸 수 있는 연도 표현은 원장 COMPANY.establishedYear 보간뿐이다(CLAUDE.md §3).
  // 확인시트 B1(운행 시작 연도)·E4 는 기간을 주지 않았다(감사 R-7).
  ["오래 맡아온 / 오래 해온 (기간 주장)", /오래\s*(맡아|해\s*온|이어|모셔)/],
  ["오랜 경력·세월·노하우 (기간 주장)", /오랜\s*(경력|세월|기간|노하우|시간|전통)/],
  ["수십 년 (기간 주장)", /수십\s*년/],
  // 요금 투명성 — 이 사이트는 요금을 싣지 않는다(스펙 §12 무가격 확정, 사장님 결정).
  // /fares 가 보여 주는 것은 원장 QUOTE_BASIS 의 산정 기준과 대표 노선 예시뿐이고 금액 셀은 0이다.
  // "요금이 투명하다"는 사이트의 실제와 정면으로 부딪히고, 손님이 요금표를 찾다가 못 찾는다.
  ["투명한 요금·가격·운임 주장", /투명(한|하게|성|합니다)[^\n]{0,8}(요금|가격|운임|견적)/],
  ["요금·가격이 투명하다 주장", /(요금|가격|운임)[^\n]{0,6}투명/],
  // ── P6-12 (P6-10 이 범위 밖으로 남긴 카피 2건) ──────────────────────────────
  // 경험 암시 — "외국인 투어로 다져온 운행 기준"은 수치가 없을 뿐 "오래 맡아온"과 같은 결이다: 다지려면 시간이 걸렸다는 말이고,
  // 그 시간을 댈 자료가 없다(확인시트 B1·E4). `쌓아 온` 은 같은 뜻의 흔한 변형이라 함께 잡는다.
  // 앞이 한글이면 제외하지 않는다 — "다져온"은 단독 어간으로만 쓰인다. 오탐 실측은 tests/admin-copy-warning.test.ts.
  ["다져온 / 쌓아 온 (경험·기간 암시)", /(다져|쌓아)\s*온/],
  // 전칭 — "시스템 완비"는 **모든 차량에** 갖춰져 있다는 주장이다. 같은 카탈로그의 home.fleet.disc 가
  // "배차 차량에 따라 일부 다를 수 있습니다"라고 스스로 부정하고(감사 R-8), 협력사 차량이 섞여 실증할 수 없다.
  ["완비 (전칭 — 모든 차량에 갖췄다는 주장)", /완비/],
];

// ── (3) 비교·최상급 광고 표현 ──────────────────────────────────────────────────
// 여기가 이번 태스크의 핵심이다. 지금까지 `pages.fares` 한 곳에만 걸려 있었다.
// 사장님 확인시트 A2 는 "공항 노선이 항상 유리하다"를 고르지 않고 조건부 선택지를 골랐다 —
// 광고주 본인이 실증해 주지 않은 가격 우위를 사이트가 단정할 수 없다.
// `최대`·`최고`는 단독으로 쓰면 "최대 {n}명" 같은 정당한 입력 안내를 잡는다(감사 §6-5).
// 그래서 **접두어를 붙인 형태만** 넣는다.
export const COMPARATIVE_CLAIMS: readonly CopyRule[] = [
  ["저렴", /저렴/],
  // P6-12 — `최저기온`·`최저 기온` 은 날씨 안내다(사장님 공지 "최저기온 영하 10도 예보"). 가격 주장이 아니므로 뺀다.
  ["최저 / 최저가", /최저(?!\s*기온)/],
  ["최저가" + " 보장", /최저가\s*보장/],
  ["최다", /최다/],
  ["업계 N위", /업계\s*\d+\s*위/],
  ["국내" + " 최대 / 국내 최고", /국내\s*최[대고]/],
  ["가격 경쟁력", /가격\s*경쟁력/],
  ["반값", /반값/],
  ["싸게 (비싸게는 제외)", /(?<!비)싸게/],
  // ── P6-10 (감사 R-2) ───────────────────────────────────────────────────────
  // 인기·순위 주장. 차종별 이용 빈도를 집계한 자료가 없다(확인시트 B2 미기입).
  // `가장` 단독은 정당한 안내("가장 가까운 여행 구분을 하나 골라주세요")를 잡으므로 **뒤따르는 낱말로 좁힌다**.
  ["가장 많이 / 가장 인기 (순위 주장 — 집계가 없다)", /가장\s*(많이|인기|잘\s*나가)/],
  // 최상급. `최적화`(기술 용어)는 제외한다 — lib/notify/solapi.ts 주석에 실재한다.
  ["최적 (최상급 — '최적화'는 제외)", /최적(?!화)/],
];

// ── (3-EN) 영문 대응 — messages/en.json 용 ─────────────────────────────────────
// en.json 은 지금 `{}` 다(i18n/messages.ts 의 shallow 병합 TEMP — /en 도 ko 카탈로그로 렌더된다).
// 그래서 한글 목록으로는 **영문 주장을 구조적으로 못 잡는다**. 영문 카피를 지어내지 않고 검사만 먼저 건다 —
// 영문이 채워지는 순간부터 같은 규칙이 적용되게 하려는 것이다(감사 §6-9).
export const COMPARATIVE_CLAIMS_EN: readonly CopyRule[] = [
  ["cheap / cheaper / cheapest", /\bcheap(er|est)?\b/i],
  ["lowest", /\blowest\b/i],
  ["largest", /\blargest\b/i],
  ["No.1 / #1", /(\bno\.\s*1\b|#\s*1\b)/i],
  ["accident-free", /\baccident[-\s]?free\b/i],
  ["best price", /\bbest\s+price\b/i],
  ["unbeatable", /\bunbeatable\b/i],
  ["guaranteed (price)", /\bprice\s+guarantee(d)?\b/i],
  // P6-10 — 한글 쪽에서 뺀 넷의 영문 대응. en.json 이 채워질 때 같은 주장이 영문으로 되돌아오는 경로를 막는다.
  ["most popular / most used", /\bmost\s+(popular|used|requested|booked)\b/i],
  ["transparent pricing / rates", /\btransparent\s+(pric|rate|fare)/i],
  ["one-minute quote", /\b(one|1)[-\s]minute\b/i],
];

// ── (4) 금액 리터럴 — `pages.fares` 전용 ───────────────────────────────────────
// 전역으로 올리지 않는다: 대표 노선 16개 가격은 사장님이 준 정당한 값이고(감사 §5-1),
// admin 도움말은 금액 입력 예시를 보여 줘야 한다. 무가격 규칙이 걸리는 곳은 /fares 하나다.
// **사장님 글에도 걸지 않는다**(아래 (6)) — "행사 기간 요금 안내"는 정당한 공지다.
export const PRICE_LITERALS: readonly CopyRule[] = [
  ["원 단위 금액", /\d{1,3}(,\d{3})+\s*원/],
  ["만원 리터럴", /\d+(\.\d+)?\s*만\s*원/],
  ["km당", /km\s*당/i],
  ["초과", /초과/],
  ["요금표", /요금표/],
  ["할인율", /\d+\s*%/],
];

// ── (5) 연락처·등록번호 리터럴 — `messages/**` 에 0건이어야 한다 ────────────────
// 원장(lib/legal/disclosures.ts)이 단일 출처다. 카탈로그에는 `{tel}` 보간만 둔다.
// 값을 원장에서 그대로 읽어 오므로 원장이 바뀌면 이 목록도 같이 바뀐다 — 손으로 베낀 리터럴이 아니다.
// **사장님 글에도 걸지 않는다**(아래 (6)) — "대표전화로 연락 주세요"는 정당한 공지다.
export const CONTACT_LITERALS: ReadonlyArray<readonly [label: string, literal: string]> = [
  ["COMPANY.tel", COMPANY.tel],
  ["COMPANY.mobile", COMPANY.mobile],
  ["COMPANY.fax", COMPANY.fax],
  ["COMPANY.bizRegNo", COMPANY.bizRegNo],
  ["COMPANY.mailOrderNo", COMPANY.mailOrderNo],
  ["COMPANY.privacyOfficer.phone", COMPANY.privacyOfficer.phone],
  ["COMPANY.email", COMPANY.email],
  ["COMPANY.bankAccount", COMPANY.bankAccount],
];

/**
 * 명시적 허용 목록 — 규칙에 걸리지만 정당한 경우.
 *
 * `path` 는 ko.json 잎의 점 경로(예: `admin.popups.hint.imagePath`), `label` 은 위 목록의 라벨과 정확히 같아야 한다.
 * **항목마다 `reason` 한 줄 필수** — 사유 없는 항목은 리뷰에서 반려한다(tests/copy-rules.test.ts 가 단언한다).
 *
 * 2026-09-16 현재 **0건**이다. 카피를 고쳐서 예외를 만들지 않았다는 뜻이다 —
 * 예외를 늘리는 방향이 아니라 주장을 빼는 방향으로 해결했다(P6-6 원칙: 빼는 것은 안전하고, 넣는 것은 근거가 필요하다).
 */
export interface CopyAllowEntry {
  readonly path: string;
  readonly label: string;
  readonly reason: string;
}
export const COPY_ALLOWLIST: readonly CopyAllowEntry[] = [];

// ── (6) 사장님 글(관리자 입력) 적용 범위 — P6-12 · known-defects D4 ─────────────
// 규칙은 **위 목록에서 파생**한다. 여기 새 낱말을 적지 않는다 — 적는 것은 "무엇을 빼는가"와 "그 이유"뿐이다.
//
// 대조하는 것: (1) 금지어 · (2) 실증 불가 · (3) 비교·최상급 — 셋 다.
// 대조하지 않는 것:
//   · (3-EN) — 관리자 화면은 한국어 전용이다. 영문 규칙은 en.json 카탈로그 몫이다.
//   · (4) 금액 — 소스 카피의 무가격 규칙(/fares)이다. "성수기 요금 안내"·"주차료 별도"는 사장님이 쓸 수 있는 사실 안내다.
//   · (5) 연락처 — 카탈로그가 원장 보간을 쓰게 하려는 규칙이다. 공지에 "대표전화 1566-6188"을 적는 것은 정당하다.
//   · 아래 OWNER_TEXT_EXEMPT 의 두 규칙 — 소스 카피에서만 의미가 있다.

/** 사장님 글에서는 대조하지 않는 (2) 규칙. 항목마다 이유 필수(tests/admin-copy-warning.test.ts 가 단언). */
export const OWNER_TEXT_EXEMPT: ReadonlyArray<{ readonly label: string; readonly reason: string }> = [
  {
    label: L_YEAR_2013,
    reason:
      "소스 카피가 원장 COMPANY.establishedYear 를 보간하도록 강제하는 규칙이다. 사장님께는 운영 매뉴얼 4장이 '2013년부터'를 쓰셔도 되는 표현으로 안내한다(등록증 개업일 — CLAUDE.md §3).",
  },
  {
    label: L_FOREIGN_TOURISTS,
    reason:
      "옛 사이트의 관광객 수 문장을 잡으려던 규칙이다. '외국인 관광객 단체 예약'은 이 회사의 본업 안내라 사장님 공지에서는 오탐이 된다. 수치 주장은 '70만'·'만 명' 규칙이 따로 잡는다.",
  },
];

/**
 * 금지어를 사장님 글에 걸 때만 쓰는 좁힘. 앞 글자가 이 중 하나면 그 금지어로 보지 않는다.
 * `운전면허`는 기사님 개인의 자격이지 회사의 사업 형태가 아니다 — "대형 운전면허를 가진 기사님"은 사실 안내다.
 * 회사가 가진 것처럼 쓰는 표현(면허 보유·면허 업체)은 그대로 잡힌다.
 */
export const OWNER_WORD_NOT_AFTER: ReadonlyArray<readonly [word: string, notAfter: string]> = [
  [W_LICENSE, cp(0xc6b4, 0xc804)], // 운전
];

export interface OwnerCopyRule {
  readonly kind: OwnerCopyKind;
  /** 개발자용 라벨 — 화면에 싣지 않는다(화면은 kind 로 문구를 고른다). */
  readonly label: string;
  readonly pattern: RegExp;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 금지어 → 정규식. 띄어쓰기를 빼고 써도 잡는다("나가는버스"). 좁힘이 있으면 부정 후방탐색으로 붙인다. */
function wordPattern(word: string): RegExp {
  const body = word.split(" ").map(escapeRe).join("\\s*");
  const guards = OWNER_WORD_NOT_AFTER.filter(([w]) => w === word).map(([, before]) => `(?<!${escapeRe(before)})`);
  return new RegExp(`${guards.join("")}${body}`);
}

const EXEMPT_LABELS: ReadonlySet<string> = new Set(OWNER_TEXT_EXEMPT.map((e) => e.label));

/** 사장님 글에 거는 규칙 전부 — 위 (1)(2)(3) 에서 파생한다. 정의가 아니라 **파생**이라 목록은 여전히 한 벌이다. */
export const OWNER_COPY_RULES: readonly OwnerCopyRule[] = [
  ...FORBIDDEN_WORD_KINDS.map(([word, kind]) => ({ kind, label: word, pattern: wordPattern(word) })),
  ...UNPROVEN_CLAIMS.filter(([label]) => !EXEMPT_LABELS.has(label)).map(([label, pattern]) => ({
    kind: "unproven" as const,
    label,
    pattern,
  })),
  ...COMPARATIVE_CLAIMS.map(([label, pattern]) => ({ kind: "comparative" as const, label, pattern })),
];
