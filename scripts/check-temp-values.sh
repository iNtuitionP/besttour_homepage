#!/usr/bin/env bash
# scripts/check-temp-values.sh
#
# L5 창작 금지 규약: 임시값/가정값 마커를 전수 조회하고, 허용되지 않은 마커가 있으면 실패한다.
# 근거: 서브에이전트가 실제 데이터 없이 값을 지어낸 사고(운행 연차·누적 건수·공항 할인율·권역 배율)가
# 크로스파일 불일치로 이어졌다. 규약 = 확인되지 않은 값에는 [TEMP] 마커를 붙인다.
#
# P0-5 승격: 정보 제공용(항상 exit 0)에서 게이트(검출 시 exit 1)로 바뀌었다.
#   - 검사 대상: app lib i18n styles actions components tests supabase messages middleware.ts (존재하는 것만)
#   - 제외: CLAUDE.md, docs/**, .superpowers/** — 규약 자체를 설명하는 곳이라 마커 문자열이 들어 있다(오탐).
#     대상 목록에 넣지 않는 방식으로 제외한다.
#   - 허용 목록: scripts/gates/temp-allowlist.txt
#     한 줄에 `파일경로:줄패턴` (파일경로 = 루트 기준 상대경로 정확히, 줄패턴 = 그 줄 내용에 대한 ERE).
#     `#` 로 시작하는 줄은 사유/주석. 허용 목록에 있는 마커는 "허용된 임시값 N건"으로 따로 세고 실패시키지 않는다.
#
# 종료코드: 0 (마커 없음 또는 전부 허용) · 1 (허용되지 않은 마커 존재) · 2 (실행 오류)
# 로컬 실행: bash scripts/check-temp-values.sh
# CI 실행:  .github/workflows/ci.yml — temp-values 잡

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}" \
  || { echo "check-temp-values: 프로젝트 루트로 이동 실패"; exit 2; }

TAG="check-temp-values"
ALLOWLIST="scripts/gates/temp-allowlist.txt"
MARKERS='\[TEMP\]|TODO\(실값\)|__PLACEHOLDER__'
TARGETS=(app lib i18n styles actions components tests supabase messages middleware.ts)

existing=()
for p in "${TARGETS[@]}"; do
  [ -e "$p" ] && existing+=("$p")
done
if [ ${#existing[@]} -eq 0 ]; then
  echo "$TAG: 검사 대상 경로 없음 (대상 목록: ${TARGETS[*]}). 통과 처리."
  exit 0
fi
echo "$TAG: 검사 대상 = ${existing[*]}"

# ── 허용 목록 적재 ───────────────────────────────────────────────────────
allow_files=()
allow_pats=()
if [ -f "$ALLOWLIST" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      '' | '#'*) continue ;;
    esac
    case "$line" in
      *:*) ;;
      *)
        echo "$TAG: 허용 목록 형식 오류 — '파일경로:줄패턴' 이어야 합니다: $line"
        exit 2
        ;;
    esac
    f="${line%%:*}"
    f="${f#./}"
    allow_files+=("$f")
    allow_pats+=("${line#*:}")
  done < "$ALLOWLIST"
  echo "$TAG: 허용 목록 = $ALLOWLIST (${#allow_files[@]}건)"
fi

# ── 마커 조회 ────────────────────────────────────────────────────────────
hits=$(grep -rnIE --exclude-dir=node_modules --exclude-dir=.next -e "$MARKERS" "${existing[@]}" 2>/dev/null)
if [ -z "$hits" ]; then
  echo "$TAG: 임시값 마커 없음."
  exit 0
fi

allowed=()
denied=()
used=()
for ((i = 0; i < ${#allow_files[@]}; i++)); do used[i]=0; done

while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"
  file="${file#./}"
  rest="${hit#*:}"
  content="${rest#*:}"
  matched=0
  for ((i = 0; i < ${#allow_files[@]}; i++)); do
    if [ "$file" = "${allow_files[i]}" ] && [[ "$content" =~ ${allow_pats[i]} ]]; then
      matched=1
      used[i]=1
      break
    fi
  done
  if [ "$matched" -eq 1 ]; then
    allowed+=("$hit")
  else
    denied+=("$hit")
  fi
done <<< "$hits"

# ── 보고 ─────────────────────────────────────────────────────────────────
if [ ${#allowed[@]} -gt 0 ]; then
  echo "$TAG: 허용된 임시값 ${#allowed[@]}건 (허용 목록에 사유와 함께 등록된 정당한 임시 표시):"
  printf '  %s\n' "${allowed[@]}"
fi
for ((i = 0; i < ${#allow_files[@]}; i++)); do
  if [ "${used[i]}" -eq 0 ]; then
    echo "$TAG: (경고) 허용 목록 항목이 어떤 마커와도 매칭되지 않음 — 정리 대상: ${allow_files[i]}:${allow_pats[i]}"
  fi
done
if [ ${#denied[@]} -gt 0 ]; then
  echo "$TAG: 허용되지 않은 임시값 ${#denied[@]}건 — 실값으로 교체하거나, 정당한 임시 표시라면 $ALLOWLIST 에 사유와 함께 등록하세요."
  printf '  %s\n' "${denied[@]}"
  exit 1
fi

echo "$TAG: OK — 허용되지 않은 임시값 없음."
exit 0
