/**
 * 카피 대조용 정규화 — **대조할 사본에만** 쓴다. 저장·표시되는 원문은 바꾸지 않는다 (P6-12 GPT 검증 후속).
 *
 * 왜: 규칙(lib/copy/rules.ts)은 한글·반각 숫자·보통 공백을 전제로 쓰였다. 그런데 사장님 글은 카카오톡·웹에서
 * 복사해 붙이는 경우가 많고, 그때 **보기엔 같지만 코드포인트가 다른** 글자가 딸려 온다. Codex 재현(2026-09-17):
 * `업계 １위`(전각 숫자) · `무​사고`(U+200B) · `운행  경력`(공백 둘) → 경고 0건.
 *
 * 세 단계, 순서가 의미를 가진다:
 *   1. **NFKC** — 호환 분해 + 정규 합성. 전각 라틴·숫자(`１`→`1`), 전각 공백(U+3000→U+0020), 반각 가나 등을 표준형으로.
 *      NFC 도 포함하므로 자모 분해(NFD)로 들어온 한글도 음절로 합쳐진다.
 *   2. **기본 무시 코드포인트 제거** — Unicode 속성 `Default_Ignorable_Code_Point`(UAX #44 · DerivedCoreProperties.txt).
 *      "렌더러가 보이지 않게 그려야 하는 글자" 의 표준 목록이라 직접 목록을 만들지 않는다. 포함 예:
 *      U+00AD(소프트 하이픈) · U+034F · U+061C · U+115F/U+1160/U+3164/U+FFA0(한글 채움 문자) · U+180B–U+180F ·
 *      U+200B–U+200F(ZWSP·ZWNJ·ZWJ·LRM·RLM) · U+202A–U+202E · U+2060–U+206F · U+FE00–U+FE0F(이체 선택자) · U+FEFF(BOM) · U+E0000 대역.
 *      NFKC **뒤에** 지운다 — NFKC 가 U+FFA0 을 U+1160 으로 바꾸므로 순서를 뒤집으면 남는다.
 *   3. **공백 일관화** — CRLF→LF, 줄 안의 공백 연속(NBSP·탭 포함)은 공백 하나, 줄바꿈을 포함한 공백 연속은 줄바꿈 하나.
 *      줄바꿈은 **남긴다**: 규칙 일부가 `[^\n]{0,8}` 로 한 줄 안에서만 잡도록 쓰였고, 줄을 합치면 줄 너머로 오탐이 생긴다.
 *
 * 순수 모듈 — 낱말 0 · Next·env·server-only 없음. 클라이언트 번들에 실려도 목록이 새지 않는다.
 */

const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const HORIZONTAL_WS = /[^\S\n]+/g;
const WS_WITH_NEWLINE = / ?\n[\s]*/g;

export function normalizeForCopyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(DEFAULT_IGNORABLE, "")
    .replace(/\r\n?/g, "\n")
    .replace(HORIZONTAL_WS, " ")
    .replace(WS_WITH_NEWLINE, "\n");
}
