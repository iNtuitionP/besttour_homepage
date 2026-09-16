#!/usr/bin/env bash
# scripts/check-legal-disclosures.sh
#
# 법정 문구 원장 게이트 (ADR-5) + 금지어 게이트 (CLAUDE.md §3 · soul §10.2).
#
# check-no-pricing.sh 가 "있으면 안 되는 것"을 막는다면, 이 게이트는 "있어야 하는 것"을
# 반대편에서 잠근다. 원칙: 대상 파일이 없으면 통과, 생기는 순간부터 검사한다.
#
# 검사 항목:
#   (a) lib/legal/disclosures.ts 가 있으면 — verbatim 2문구가 바이트 단위 그대로 코드 줄에 존재해야 한다.
#   (b) lib/legal/disclosures.ts 가 있으면 — 함수 export 0개 (상수 객체/문자열/배열만 허용).
#   (c) 항상 — app lib actions components tests i18n messages styles supabase 에 금지어 0건.
#       금지어: 면허("등록"이 맞다) · 전세버스하나(타사 상호) · 나가는 버스 · 태우고 나가 · 공차 · 회송(BM 비노출)
#       `supabase` 는 P6-6 에서 더했다 — 시드 SQL 에 한글 카피가 들어가는데(0001 차종명 · 0002 지명)
#       지금까지 **어느 게이트도 스캔하지 않았다**(감사 P6-6-audit.md §6-8).
#   (d) 항상 — app lib actions components i18n messages styles supabase 에 실증 불가 주장 0건. **tests 제외.**
#       주장: 4,800 · 누적 견적 · 누적 운행 · 업계 1위 · 국내 최대 · 최저가 보장 · 무사고
#       왜 (c) 와 대상이 다른가: 테스트는 "이 문자열이 없어야 한다"를 단언하려고 **정당하게** 그 문자열을 담는다.
#       (c) 의 금지어는 tests 가 코드포인트로 조립해 우회하지만(tests/helpers/forbidden-copy.ts), 실증 불가 주장까지
#       전부 조립하게 만들면 테스트가 읽히지 않는다. 그래서 (d)는 배포 표면만 본다 — tests 쪽은 vitest 가 잠근다
#       (tests/copy-rules.test.ts 가 같은 목록을 ko.json 전 네임스페이스·en.json·컴포넌트에 건다).
#       오탐이 0 인 것만 넣는다: `4800`(쉼표 없음, 픽셀·타임아웃 값)·`최다`(일반 어휘)·`개 시도`("N개 시도(attempt)")는 넣지 않는다.
#
# 주석 줄 제외: `//`, `/*`, `*`, `#` 로 시작하는 줄은 (a)(b)(c)(d) 모두에서 뺀다.
#   - (b)(c)(d): 금지어·패턴을 설명하는 주석은 오탐이다.
#   - (a): 주석에만 있는 verbatim 은 배포되지 않으므로 충족으로 치지 않는다.
#   한계: 줄 끝 주석(`code; // ...`)과 `*` 없이 이어지는 블록 주석 내부 줄은 코드 줄로 취급된다.
#
# 구현 메모: (a)(b) 는 외부 프로세스 없이 bash 만으로 줄을 훑는다. Windows Git Bash 는 fork 1회가
# 약 0.1초라서 grep 을 줄마다/규칙마다 부르면 테스트 픽스처 수십 건이 분 단위로 느려진다.
#
# 종료코드: 0 통과 · 1 위반(파일:줄 출력) · 2 실행 오류
# 로컬 실행: bash scripts/check-legal-disclosures.sh
# CI 실행:  .github/workflows/ci.yml — legal-disclosures 잡

set -uo pipefail

# CLAUDE_PROJECT_DIR 가 있으면 그것을 루트로(픽스처 위장 가능), 없으면 스크립트 위치 기준 레포 루트.
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}" \
  || { echo "check-legal-disclosures: 프로젝트 루트로 이동 실패"; exit 2; }

TAG="check-legal-disclosures"
TARGET="lib/legal/disclosures.ts"

# verbatim 2건 — CLAUDE.md §3. 원문 그대로, 임의 수정 금지.
VERBATIM=(
  '사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다.'
  '대표 노선 예시 견적 · 45인승 당일왕복 기준 · 실제 견적은 상담 후 확정'
)

# (b) 함수 export 패턴 — 한 줄 단위 ERE. 순서대로:
#   export [default] [async] function …
#   export const|let|var NAME[: Type] = (        (괄호로 시작하는 화살표 함수 / 함수 표현식)
#   export const|let|var NAME[: Type] = async …
#   export … =>                                   (한 줄 화살표 함수 전반)
FUNC_RULES=(
  '^[[:space:]]*export[[:space:]]+(default[[:space:]]+)?(async[[:space:]]+)?function([^A-Za-z0-9_$]|$)'
  '^[[:space:]]*export[[:space:]]+(const|let|var)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*([[:space:]]*:[^=]*)?[[:space:]]*=[[:space:]]*\('
  '^[[:space:]]*export[[:space:]]+(const|let|var)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*([[:space:]]*:[^=]*)?[[:space:]]*=[[:space:]]*async([^A-Za-z0-9_$]|$)'
  '^[[:space:]]*export([^A-Za-z0-9_$]|$).*=>'
)

# (c) 금지어 — 부분 문자열 일치.
FORBIDDEN='면허|전세버스하나|나가는 버스|태우고 나가|공차|회송'
SCAN_TARGETS=(app lib actions components tests i18n messages styles supabase)

# (d) 실증 불가 주장 — 부분 문자열 일치. 대상에서 tests 를 뺀다(헤더 (d) 참조).
UNPROVABLE='4,800|누적 견적|누적 운행|업계 1위|국내 최대|최저가 보장|무사고'
UNPROVABLE_TARGETS=(app lib actions components i18n messages styles supabase)

COMMENT_LINE='^[[:space:]]*(//|/\*|\*|#)'

report() { echo "$TAG: $*"; }
is_comment() { [[ $1 =~ $COMMENT_LINE ]]; }

fail=0

# ── (a)(b) 원장 파일 ─────────────────────────────────────────────────────
if [ ! -f "$TARGET" ]; then
  report "대상 없음 — $TARGET 이(가) 아직 없습니다. (a) 필수 문구·(b) 함수 export 검사는 파일이 생기는 순간부터 적용됩니다."
else
  report "대상 = $TARGET"

  found=()
  for ((k = 0; k < ${#VERBATIM[@]}; k++)); do found[k]=0; done
  func_hits=()
  n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    is_comment "$line" && continue
    for ((k = 0; k < ${#VERBATIM[@]}; k++)); do
      [[ $line == *"${VERBATIM[k]}"* ]] && found[k]=1
    done
    for rule in "${FUNC_RULES[@]}"; do
      if [[ $line =~ $rule ]]; then
        func_hits+=("$TARGET:$n:$line")
        break
      fi
    done
  done < "$TARGET"

  for ((k = 0; k < ${#VERBATIM[@]}; k++)); do
    if [ "${found[k]}" -eq 0 ]; then
      report "필수 문구 누락 — $TARGET 의 코드 줄에 다음 문구가 바이트 단위 그대로 있어야 합니다:"
      echo "  \"${VERBATIM[k]}\""
      fail=1
    fi
  done
  if [ ${#func_hits[@]} -gt 0 ]; then
    report "함수 export 검출 — ADR-5: 원장은 상수만 허용합니다 (export function / export const x = ( / = async / =>):"
    printf '%s\n' "${func_hits[@]}"
    fail=1
  fi
fi

# ── (c) 금지어 — 파일 존재 여부와 무관하게 항상 ─────────────────────────
existing=()
for t in "${SCAN_TARGETS[@]}"; do
  [ -e "$t" ] && existing+=("$t")
done

if [ ${#existing[@]} -eq 0 ]; then
  report "금지어 검사 대상 경로 없음 (대상 목록: ${SCAN_TARGETS[*]}). 통과 처리."
else
  report "금지어 검사 대상 = ${existing[*]}"
  report "금지어 = ${FORBIDDEN}"
  raw=$(grep -rnIHE --exclude-dir=node_modules --exclude-dir=.next -e "$FORBIDDEN" "${existing[@]}" 2>/dev/null)
  word_hits=()
  if [ -n "$raw" ]; then
    while IFS= read -r hit; do
      [ -z "$hit" ] && continue
      rest="${hit#*:}"
      content="${rest#*:}"
      is_comment "$content" || word_hits+=("$hit")
    done <<< "$raw"
  fi
  if [ ${#word_hits[@]} -gt 0 ]; then
    report "금지어 검출 — 주석 줄은 제외한 결과입니다. 카피를 고치세요 (면허→등록, BM 비노출 표현은 삭제):"
    printf '%s\n' "${word_hits[@]}"
    fail=1
  fi
fi

# ── (d) 실증 불가 주장 — tests 제외 (헤더 (d) 참조) ─────────────────────
existing_u=()
for t in "${UNPROVABLE_TARGETS[@]}"; do
  [ -e "$t" ] && existing_u+=("$t")
done

if [ ${#existing_u[@]} -eq 0 ]; then
  report "실증 불가 주장 검사 대상 경로 없음 (대상 목록: ${UNPROVABLE_TARGETS[*]}). 통과 처리."
else
  report "실증 불가 주장 검사 대상 = ${existing_u[*]} (tests 제외)"
  report "실증 불가 주장 = ${UNPROVABLE}"
  raw_u=$(grep -rnIHE --exclude-dir=node_modules --exclude-dir=.next -e "$UNPROVABLE" "${existing_u[@]}" 2>/dev/null)
  claim_hits=()
  if [ -n "$raw_u" ]; then
    while IFS= read -r hit; do
      [ -z "$hit" ] && continue
      rest="${hit#*:}"
      content="${rest#*:}"
      is_comment "$content" || claim_hits+=("$hit")
    done <<< "$raw_u"
  fi
  if [ ${#claim_hits[@]} -gt 0 ]; then
    report "실증 불가 주장 검출 — 주석 줄은 제외한 결과입니다. 표시광고법 §5 는 광고주에게 실증책임을 지웁니다:"
    printf '%s\n' "${claim_hits[@]}"
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  report "실패 — 위 항목을 수정하세요."
  exit 1
fi

report "OK — 필수 문구·함수 export·금지어·실증 불가 주장 검사 통과."
exit 0
