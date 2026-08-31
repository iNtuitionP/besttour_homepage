#!/usr/bin/env bash
# scripts/check-no-pricing.sh
#
# 가격 계산 코드 회귀 게이트.
#
# 이 스캐폴드 단계에서는 실시간/추정 가격 계산 로직을 애플리케이션 코드에
# 절대 들이지 않는다는 방침(플랜 §0)을 강제한다. 아래 금지 심볼 중 하나라도
# 검사 대상 경로에서 발견되면 실패(exit 1)한다.
#
# 검사 대상(존재하는 경로만 검사):
#   app/ lib/ actions/ components/ middleware.ts tests/
#
# 금지 심볼:
#   estimate(  price_state  est_price  route_prices  PRICE_DISPLAY_MODE
#
# 테스트 픽스처 예외: 현재 없음. 특정 테스트 픽스처가 금지 심볼을 의도적으로
# 다뤄야 하는 경우가 생기면, 여기에 --exclude/--exclude-dir 규칙을 추가할 것
# (지금은 자리만 남겨둔다).
#
# 로컬 실행: bash scripts/check-no-pricing.sh
# CI 실행:  package.json의 "check:pricing" 스크립트에서 호출.

set -euo pipefail

# 스크립트 위치와 무관하게 레포 루트에서 실행되도록 고정한다.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PATTERN='estimate\(|price_state|est_price|route_prices|PRICE_DISPLAY_MODE'
TARGETS=(app lib actions components middleware.ts tests)

existing=()
for t in "${TARGETS[@]}"; do
  if [ -e "$t" ]; then
    existing+=("$t")
  fi
done

if [ ${#existing[@]} -eq 0 ]; then
  echo "check-no-pricing: 검사 대상 경로가 하나도 존재하지 않습니다 (대상 목록: ${TARGETS[*]}). 통과 처리."
  exit 0
fi

echo "check-no-pricing: 검사 대상 = ${existing[*]}"
echo "check-no-pricing: 금지 패턴 = ${PATTERN}"

set +e
matches=$(grep -rnIE "$PATTERN" "${existing[@]}" 2>/dev/null)
grep_exit=$?
set -e

if [ "$grep_exit" -eq 0 ]; then
  echo "check-no-pricing: 금지된 가격 계산 심볼이 발견되었습니다:"
  echo "$matches"
  exit 1
elif [ "$grep_exit" -eq 1 ]; then
  echo "check-no-pricing: OK — 금지 심볼 없음."
  exit 0
else
  echo "check-no-pricing: grep 실행 중 오류가 발생했습니다 (exit ${grep_exit})."
  exit 2
fi
