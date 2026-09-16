/**
 * 통합 카피 금지 목록 — **여기가 단일 원장이다** (P6-6).
 *
 * 왜 생겼나: 2026-09-15 독립 감사(P6-6-audit.md)가 같은 종류의 목록이 세 벌로 갈라져 있고
 * 서로 범위가 다르다는 것을 찾았다. 가장 엄격한 목록(`PRICE_TABLE` 의 `저렴`·`최저`)이
 * `pages.fares` 한 곳에만 걸려 있어서, 프로젝트가 스스로 "비교 광고 표현"이라 판정한 문장이
 * 홈(`home.*`)과 위저드(`quote.*`)에서는 다섯 군데 그대로 배포되고 있었다.
 * 목록을 여기 하나로 모아 **새 네임스페이스가 자동으로 무검사가 되는 구조**를 끝낸다.
 *
 * 쓰는 곳
 *   - tests/copy-rules.test.ts  — ko.json **전 네임스페이스** · en.json · components/** · app/[locale]/** (전역)
 *   - tests/home.test.ts        — components/home/** + ko.json home.*      (기존 단언 구조 유지)
 *   - tests/pages.test.ts       — 서브페이지 소스 + ko.json pages.*        (기존 단언 구조 유지)
 *                                 + PRICE_LITERALS 는 pages.fares 에만
 *
 * 규약 1 — **금지어 리터럴을 적지 마라.** 이 파일도 `tests/` 아래라
 * `scripts/check-legal-disclosures.sh` (c) 금지어 검사의 대상이다. 코드 줄에 금지어를 리터럴로 두면
 * 게이트가 자기 자신을 잡는다. 그래서 `cp()` 로 코드포인트에서 조립한다(기존 tests/pages.test.ts 규약).
 * 주석 줄(`//` `*`)은 게이트가 제외하므로 설명에는 그대로 쓸 수 있다.
 *
 * 규약 2 — **빈 배열은 곧 전면 통과다.** 소비하는 테스트는 반드시 길이 하한을 먼저 단언한다.
 * 목록이 실수로 비면 모든 검사가 green 이 되는 사고 모양을 이 프로젝트가 이미 겪었다.
 *
 * 규약 3 — **정규식에 `g` 플래그를 쓰지 마라.** `lastIndex` 가 남아 같은 규칙을 두 번째 돌릴 때
 * 조용히 빗나간다. 여기 규칙은 전부 무상태다.
 */
import { COMPANY } from "@/lib/legal/disclosures";

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

export const FORBIDDEN_WORDS: readonly string[] = [
  W_LICENSE,
  W_RIVAL,
  W_BM_OUTBOUND,
  W_BM_TAKEOUT,
  W_BM_EMPTY,
  W_BM_RETURN,
];

// ── (2) 실증 불가 수치·주장 — 표시광고법 §5(실증책임) ──────────────────────────
// tests/home.test.ts(8건) + tests/pages.test.ts(17건) 의 합집합. 어느 한쪽에만 있던 것은 우연이었다.
// "2013년부터"는 원장 COMPANY.establishedYear 보간으로만 허용하므로, 리터럴 2013 과 "13년"(앞에 숫자 없는)을 잡는다.
export const UNPROVEN_CLAIMS: readonly CopyRule[] = [
  ["4,800 (목업의 누적 견적 건수)", /4,800/],
  ["70만 (옛 사이트의 외국인 관광객 수)", /70만/],
  ["만 명", /만\s*명/],
  ["13년 (운행 연차)", /(?<!\d)13년/],
  ["17건 (목업의 오늘 접수 건수)", /17건/],
  ["연중무휴", /연중무휴/],
  ["누적", /누적/],
  ["운행 경력", /운행 경력/],
  ["2013 하드코딩 (원장 establishedYear 보간만 허용)", /(?<![\w-])2013(?![\w-])/],
  ["무사고", /무사고/],
  ["사고 없", /사고\s*없/],
  ["큰 사고", /큰 사고/],
  ["차량 대수 주장", /\d+\s*대\s*(보유|의 차량|규모)/],
  ["연식", /연식/],
  ["년식", /년식/],
  ["외국인 관광객 (수치 문장)", /외국인 관광객/],
  ["국토여행 (BM 노출)", /국토여행/],
  // 보험 — 원장 INSURANCE.body 와 그 출처(옛 사이트 bo_page=intro10)에는 "종합보험"이라는 **상품명**도,
  // "전 차량"이라는 **전칭**도 없다. 협력사 차량이 섞여 대수를 주장하지 못하는 것과 같은 이유로 전칭도 주장할 수 없다.
  // `전 차량` 은 앞 글자가 한글이면 제외한다 — "이전 차량"·"운전 차량" 오탐 방지.
  ["종합보험 (원장 INSURANCE 에 없는 상품명)", /종합보험/],
  ["전 차량 (전칭 — 협력사 차량이 섞여 실증 불가)", /(?<![가-힣])전\s*차량/],
  // `개 시도` 를 통째로 넣으면 "N개 시도(attempt)"와 충돌한다(감사 §6). 광역자치단체 개수를 세는 자리수만 잡는다 —
  // 16 은 세종이 빠진 틀린 숫자이고, 17 로 고치는 것도 또 다른 실증 대상이라 둘 다 막는다.
  ["N개 시도 (광역자치단체 개수 주장)", /1[5-9]\s*개\s*시도/],
];

// ── (3) 비교·최상급 광고 표현 ──────────────────────────────────────────────────
// 여기가 이번 태스크의 핵심이다. 지금까지 `pages.fares` 한 곳에만 걸려 있었다.
// 사장님 확인시트 A2 는 "공항 노선이 항상 유리하다"를 고르지 않고 조건부 선택지를 골랐다 —
// 광고주 본인이 실증해 주지 않은 가격 우위를 사이트가 단정할 수 없다.
// `최대`·`최고`는 단독으로 쓰면 "최대 {n}명" 같은 정당한 입력 안내를 잡는다(감사 §6-5).
// 그래서 **접두어를 붙인 형태만** 넣는다.
export const COMPARATIVE_CLAIMS: readonly CopyRule[] = [
  ["저렴", /저렴/],
  ["최저 / 최저가", /최저/],
  ["최저가 보장", /최저가\s*보장/],
  ["최다", /최다/],
  ["업계 N위", /업계\s*\d+\s*위/],
  ["국내 최대 / 국내 최고", /국내\s*최[대고]/],
  ["가격 경쟁력", /가격\s*경쟁력/],
  ["반값", /반값/],
  ["싸게 (비싸게는 제외)", /(?<!비)싸게/],
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
];

// ── (4) 금액 리터럴 — `pages.fares` 전용 ───────────────────────────────────────
// 전역으로 올리지 않는다: 대표 노선 16개 가격은 사장님이 준 정당한 값이고(감사 §5-1),
// admin 도움말은 금액 입력 예시를 보여 줘야 한다. 무가격 규칙이 걸리는 곳은 /fares 하나다.
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
