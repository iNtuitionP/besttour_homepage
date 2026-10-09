#!/usr/bin/env bash
# scripts/check-mockup-drift.sh
#
# 목업 드리프트 게이트 (ADR-8: 목업 추종은 해시 고정으로).
#
# (a) 기준 목업 3종(variant-08-map-hero.html · wizard-b.html · admin.html)의 sha256 을
#     베이스라인 JSON 에 고정하고 현재 mockups/ 와 비교한다. 다르면 실패 —
#     목업이 바뀌었으니 이식 브리프를 갱신하고 베이스라인을 올려야 한다.
#     베이스라인 갱신은 오직 `--update` 로만 한다(일반 실행이 자동 갱신하면 게이트가 아니다).
#     베이스라인 파일이 없으면 첫 실행 안내를 출력하고 통과한다.
# (b) 브랜드 자산 두 사본(public/brand/*.png ↔ mockups/assets/brand/*.png)의
#     파일명·sha256 이 1:1 이어야 한다. 한쪽에만 있거나 해시가 다르면 실패.
#
# 해시 규약: HTML 목업은 CR(\r) 을 제거한 뒤 sha256 을 구한다. 이 저장소는 core.autocrlf=true 인
# Windows 작업 트리(CRLF)와 Linux CI(LF)가 공존하므로, 원시 바이트 해시로는 같은 파일이 플랫폼마다
# 다르게 나온다. 줄바꿈만 다른 변경은 드리프트로 보지 않는다. PNG 는 원시 바이트 해시다.
# 손으로 대조하려면: tr -d '\r' < mockups/파일.html | sha256sum
#
# 구현 메모: 외부 프로세스 호출을 최소화했다(베이스라인 파싱은 bash 정규식, PNG 는 sha256sum 1회 일괄).
# Windows Git Bash 는 fork 1회가 약 0.1초라 호출 수가 곧 실행 시간이다.
#
# 종료코드: 0 통과 · 1 드리프트 또는 자산 불일치 · 2 실행 오류(목업 부재 상태의 --update, 알 수 없는 인자)
# 로컬 실행: bash scripts/check-mockup-drift.sh            # 검사
#           bash scripts/check-mockup-drift.sh --update   # 베이스라인 고정(의도한 목업 변경 후에만)
# CI 실행:  .github/workflows/ci.yml — mockup-drift 잡

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}" \
  || { echo "check-mockup-drift: 프로젝트 루트로 이동 실패"; exit 2; }

TAG="check-mockup-drift"
BASELINE="scripts/gates/mockup-baseline.json"
MOCKUP_DIR="mockups"
MOCKUPS=(variant-08-map-hero.html wizard-b.html admin.html)
BRAND_A="public/brand"
BRAND_B="mockups/assets/brand"

report() { echo "$TAG: $*"; }

# CR 제거 후 sha256. 결과는 전역 HASH 에 담는다(명령 치환의 서브셸 fork 를 아끼기 위해).
hash_text() {
  HASH=""
  read -r HASH _ < <(tr -d '\r' < "$1" | sha256sum)
  if [ -z "$HASH" ]; then
    report "해시 계산 실패: $1"
    exit 2
  fi
}

MODE="check"
case "${1:-}" in
  "") ;;
  --update) MODE="update" ;;
  *)
    report "알 수 없는 인자: $1 (사용법: bash scripts/check-mockup-drift.sh [--update])"
    exit 2
    ;;
esac

# ── --update: 현재 해시로 베이스라인을 쓴다 ──────────────────────────────
if [ "$MODE" = "update" ]; then
  missing=0
  for m in "${MOCKUPS[@]}"; do
    if [ ! -f "$MOCKUP_DIR/$m" ]; then
      report "목업 파일 없음: $MOCKUP_DIR/$m — 베이스라인을 쓰지 않습니다."
      missing=1
    fi
  done
  [ "$missing" -ne 0 ] && exit 2

  mkdir -p "$(dirname "$BASELINE")"
  {
    echo "{"
    n=${#MOCKUPS[@]}
    i=0
    for m in "${MOCKUPS[@]}"; do
      i=$((i + 1))
      sep=","
      [ "$i" -eq "$n" ] && sep=""
      hash_text "$MOCKUP_DIR/$m"
      printf '  "%s": "%s"%s\n' "$m" "$HASH" "$sep"
    done
    echo "}"
  } > "$BASELINE"
  report "베이스라인 갱신 → $BASELINE"
  cat "$BASELINE"
  exit 0
fi

# ── 검사 모드 ────────────────────────────────────────────────────────────
fail=0

# (a) 목업 해시
if [ ! -f "$BASELINE" ]; then
  report "베이스라인 없음 ($BASELINE) — 첫 실행이면 'bash scripts/check-mockup-drift.sh --update' 로 현재 해시를 고정하세요. (a) 통과 처리."
else
  report "베이스라인 = $BASELINE"
  baseline_json=""
  IFS= read -r -d '' baseline_json < "$BASELINE" || true
  drift=0
  for m in "${MOCKUPS[@]}"; do
    key="\"$m\""
    expected=""
    if [[ $baseline_json =~ "$key"[[:space:]]*:[[:space:]]*\"([0-9a-fA-F]{64})\" ]]; then
      expected="${BASH_REMATCH[1],,}"
    fi
    if [ -z "$expected" ]; then
      report "베이스라인에 항목 없음: $m — '--update' 로 다시 고정하세요."
      fail=1
      continue
    fi
    if [ ! -f "$MOCKUP_DIR/$m" ]; then
      report "목업 파일 없음: $MOCKUP_DIR/$m (베이스라인에는 있음)"
      fail=1
      continue
    fi
    hash_text "$MOCKUP_DIR/$m"
    if [ "$HASH" != "$expected" ]; then
      report "드리프트: $m"
      echo "  baseline = $expected"
      echo "  current  = $HASH"
      drift=1
      fail=1
    else
      report "일치: $m ($HASH)"
    fi
  done
  if [ "$drift" -ne 0 ]; then
    report "목업이 바뀌었다 — 이식 브리프를 갱신하고 베이스라인을 올려라 (bash scripts/check-mockup-drift.sh --update)."
  fi
fi

# (b) 브랜드 자산 두 사본 대조 — sha256sum 1회로 양쪽을 모두 해시한다.
shopt -s nullglob
pngs=("$BRAND_A"/*.png "$BRAND_B"/*.png)
shopt -u nullglob

if [ ${#pngs[@]} -eq 0 ]; then
  report "브랜드 자산 없음 ($BRAND_A, $BRAND_B 에 *.png 없음) — (b) 통과 처리."
else
  declare -A hash_a=()
  declare -A hash_b=()
  while read -r h p; do
    p="${p#\*}" # sha256sum 바이너리 모드 표시(*) 제거 — Windows 에서 붙는다
    name="${p##*/}"
    case "$p" in
      "$BRAND_A"/*) hash_a["$name"]=$h ;;
      "$BRAND_B"/*) hash_b["$name"]=$h ;;
    esac
  done < <(sha256sum "${pngs[@]}")

  ok=0
  bad=0
  for name in "${!hash_a[@]}"; do
    if [ -z "${hash_b[$name]+x}" ]; then
      report "자산 불일치: $name — $BRAND_A 에만 있음 ($BRAND_B 에 없음)"
      bad=$((bad + 1))
    elif [ "${hash_a[$name]}" != "${hash_b[$name]}" ]; then
      report "자산 불일치: $name — 해시 다름"
      echo "  $BRAND_A/$name = ${hash_a[$name]}"
      echo "  $BRAND_B/$name = ${hash_b[$name]}"
      bad=$((bad + 1))
    else
      ok=$((ok + 1))
    fi
  done
  for name in "${!hash_b[@]}"; do
    if [ -z "${hash_a[$name]+x}" ]; then
      report "자산 불일치: $name — $BRAND_B 에만 있음 ($BRAND_A 에 없음)"
      bad=$((bad + 1))
    fi
  done
  report "브랜드 자산 대조: 일치 ${ok}건, 불일치 ${bad}건"
  [ "$bad" -ne 0 ] && fail=1
fi

if [ "$fail" -ne 0 ]; then
  report "실패 — 위 항목을 확인하세요."
  exit 1
fi

report "OK — 목업 해시·브랜드 자산 일치."
exit 0
