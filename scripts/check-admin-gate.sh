#!/usr/bin/env bash
# scripts/check-admin-gate.sh
#
# 관리자 인가 게이트 **구조** 검사 (플랜 v4 P5-4 · P5-3 독립 리뷰 §재-2).
#
# 왜 줄 단위가 아니라 구조인가
# ---------------------------------------------------------------------------
# P5-3 이 만든 검사는 "줄 하나가 통째로 `await requireAdmin();` 인가" 였다. 리뷰어가 그 검사를 통과하면서
# 게이트를 무력화하는 형태 다섯 가지를 지목했다:
#   (가) if (…) { await requireAdmin(); }        ← 줄 자체는 무조건인데 블록이 조건부다
#        try { await requireAdmin(); } catch {}  ← redirect() 는 throw 로 동작한다. catch 가 그것을 삼키면
#                                                  게이트가 "있는 채로" 화면이 렌더된다
#   (나) 게이트 위의 early return                ← 존재와 줄 모양만 보고 위치를 보지 않았다
#   (다) route.ts                                ← Route Handler 는 레이아웃을 타지 않는데 검사 대상이 아니었다
#   (라) use server 파일 전부                    ← 그 export 는 전부 공개 POST 엔드포인트다. 화면 게이트를 한 번도
#                                                  거치지 않고 직접 호출할 수 있다. 폴더가 아니라 지시어로 찾는다
#   (마) app/admin/(protected) 하드코딩          ← 그룹 밖에 만든 화면은 레이아웃 보호도 검사도 없다
#
# 그래서 판정을 **함수 본문의 첫 문장**으로 옮겼다. export 된 async 함수의 본문을 잘라(주석·문자열은 지운다)
# 첫 번째 문장이 `await requireAdmin();` 인지 본다. 이 한 줄 규칙이 (가)(나)를 동시에 닫는다 —
# if 로 감싸도, try 로 감싸도, 앞에 return 을 놓아도 "첫 문장" 이 아니게 되기 때문이다.
# 대상은 app/admin 전체 + actions/admin 전체 + lib/admin + components/admin 이다((다)(라)(마)).
#
# 예외는 딱 셋이고 전부 **인증 이전** 이다(아래 PUBLIC_ROUTES·UNGATED_ACTIONS). 예외를 늘리는 것이
# 게이트를 우회하는 가장 쉬운 방법이므로 tests/admin-gate.test.ts 가 목록의 내용을 그대로 단언한다.
#
# 검사 항목
#   1. **use server 파일 전부** — 폴더 이름이 아니라 **지시어**로 찾는다(독립 리뷰 F1). 네 디렉터리 어디에 있든
#      use server 한 줄이 있으면 그 파일의 export 는 공개 POST 엔드포인트이므로 액션 규칙을 적용한다:
#      모든 export 가 `export async function`(타입 export 는 예외) · 본문 첫 문장이 게이트.
#      그리고 use server 는 **actions/admin/ 밖에서는 금지**다 — 인라인 서버액션(함수 안의 지시어)도 같은 검사에 걸린다.
#   2. app/admin/**/page|layout|default|template — 기본 export 가 async 함수이고 본문 첫 문장이 게이트
#   3. app/admin/**/route      — HTTP 메서드 export **각각** 이 본문 첫 문장에 게이트
#   4. 공개 라우트를 감싸는 바깥 레이아웃 — 게이트를 걸면 로그인 화면이 자기 자신으로 무한 리다이렉트한다.
#      그래서 "예외의 조상 레이아웃" 은 게이트를 **걸지 않아야** 한다. 예외 목록에서 자동으로 유도한다(경로 하드코딩 없음).
#   5. 네 디렉터리 공통 — 삭제된 우회 심볼 0 · 코드의 NODE_ENV/process.env 분기 0 ·
#      requireAdmin 은 반드시 lib/auth/requireAdmin 에서 온다(같은 이름의 가짜 게이트 금지) ·
#      try/catch 블록 안의 게이트 호출 0
#   6. generateStaticParams 금지 — 관리자 화면을 프리렌더하겠다는 뜻이다
#
# 검사하지 않는 것: 서비스 롤(scripts/check-admin-no-service-role.sh 가 본다 — 둘은 서로 다른 층이다).
# `미리보기` 기능 자체는 막지 않는다(P5-4 팝업 미리보기는 정당한 기능이다). 금지하는 것은 삭제된 우회 심볼 5종뿐이다.
#
# 종료코드: 0 통과 · 1 위반(파일:줄 출력) · 2 실행 오류
# 로컬 실행: bash scripts/check-admin-gate.sh   (= npm run check:admin-gate)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
SELF="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
cd "${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}" \
  || { echo "check-admin-gate: 프로젝트 루트로 이동 실패"; exit 2; }

TAG="check-admin-gate"
TARGETS=(app/admin actions/admin lib/admin components/admin)

# 'use server' 지시어 한 줄 — 파일 맨 위(모듈 전체)든 함수 안(인라인 서버액션)이든 같은 모양이다.
USE_SERVER_RE="^[[:space:]]*['\"]use server['\"];?[[:space:]]*$"

# ── 예외 목록 — 전부 **인증 이전** 이다. 늘리면 tests/admin-gate.test.ts 가 실패한다 ──────
PUBLIC_ROUTES=(
  "app/admin/login/page.tsx"          # 로그인 화면 — 세션이 없는 사람이 보는 유일한 관리자 화면이다
  "app/admin/auth/callback/route.ts"  # 매직링크 세션 교환 — 세션을 만드는 자리라 세션을 요구할 수 없다
)
UNGATED_ACTIONS=(
  "actions/admin/auth.ts"             # 로그인 링크 요청 — 인증 전이므로 requireAdmin 을 부를 수 없다. 대신 허용 목록·레이트리밋·허니팟이 지킨다
)

# 삭제된 개발용 우회 심볼(P5-3 독립 리뷰 F1). 이름을 조립해 이 파일 자신이 검사에 걸리지 않게 한다.
BYPASS_SYMBOLS="preview""Admin|ADMIN""_PREVIEW|adminPreview""Allowed|isAdmin""Preview|PREVIEW""_ADMIN_ROWS"

existing=()
for t in "${TARGETS[@]}"; do
  [ -d "$t" ] && existing+=("$t")
done

if [ ${#existing[@]} -eq 0 ]; then
  echo "$TAG: 검사 대상 경로 없음 (대상 목록: ${TARGETS[*]}). 통과 처리."
  exit 0
fi

echo "$TAG: 검사 대상 = ${existing[*]}"
echo "$TAG: 예외(인증 전) = ${PUBLIC_ROUTES[*]} ${UNGATED_ACTIONS[*]}"

violations=0
report() {
  echo "$TAG: $1"
  violations=$((violations + 1))
}

# ── 예외 목록 자체의 무결성 (독립 리뷰 F2) ──────────────────────────────
# 게이트를 우회하는 가장 싼 방법은 규칙을 깨는 것이 아니라 **예외를 한 줄 더하는 것**이다.
# 배열을 나중에 덧붙이거나(`+=`) 같은 이름으로 다시 대입하면 tests/admin-gate.test.ts 의 목록 단언을
# 지나칠 수 있으므로, 스크립트가 자기 자신을 먼저 본다. 여기서 걸리면 검사 이전에 실행 오류(2)다.
if grep -qE '(PUBLIC_ROUTES|UNGATED_ACTIONS)[[:space:]]*\+=' "$SELF"; then
  echo "$TAG: 예외 목록을 += 로 덧붙였다 — 목록은 한 곳에서 한 번만 정의한다."
  exit 2
fi
list_assigns=$(grep -cE '^(PUBLIC_ROUTES|UNGATED_ACTIONS)=\(' "$SELF")
if [ "$list_assigns" != "2" ]; then
  echo "$TAG: 예외 목록 대입이 2개가 아니다 (발견 ${list_assigns}개) — 목록은 한 곳에서 한 번만 정의한다."
  exit 2
fi

# ── 예외 목록이 낡지 않았는가 ────────────────────────────────────────────
# 예외가 가리키는 파일이 사라졌다면 목록이 현실과 갈라진 것이다. 그대로 두면 다음 사람이
# "예외니까 괜찮다" 고 읽는 이름만 남는다.
if [ -d "app/admin" ]; then
  for rel in "${PUBLIC_ROUTES[@]}"; do
    [ -f "$rel" ] || report "예외 목록의 $rel 이 없다 — 목록이 낡았거나 파일이 옮겨졌다."
  done
fi
if [ -d "actions/admin" ]; then
  for rel in "${UNGATED_ACTIONS[@]}"; do
    [ -f "$rel" ] || report "예외 목록의 $rel 이 없다 — 목록이 낡았거나 파일이 옮겨졌다."
  done
fi

in_list() {
  local needle="$1"; shift
  local item
  for item in "$@"; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

# ── 구조 분석기 ──────────────────────────────────────────────────────────
# awk 로 주석·문자열을 지운(공백으로 바꾼) 사본을 만든 뒤 함수 본문을 잘라 첫 문장을 본다.
# 지우면서 **길이와 줄바꿈 위치를 유지**하므로 위반 위치의 줄 번호가 원본과 같다.
analyze() {
  local file="$1" rel="$2" mode="$3" exempt="$4" useserver="${5:-0}" indir="${6:-0}"
  awk -v rel="$rel" -v mode="$mode" -v exempt="$exempt" -v useserver="$useserver" -v indir="$indir" '
    function clean(s,   i, n, c, d, st, out, esc, prevc) {
      n = length(s); st = 0; out = ""; esc = 0; prevc = ""
      # st: 0 코드 · 1 줄주석 · 2 블록주석 · 3 "..." · 4 \047...\047 · 5 `...`
      for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        d = (i < n) ? substr(s, i + 1, 1) : ""
        if (st == 0) {
          if (esc) { out = out " "; esc = 0; prevc = c; continue }
          if (c == "\\") { esc = 1; out = out " "; prevc = c; continue }
          if (c == "/" && d == "/") { st = 1; out = out " "; prevc = c; continue }
          if (c == "/" && d == "*") { st = 2; out = out " "; prevc = c; continue }
          if (c == "\"") { st = 3; out = out c; prevc = c; continue }
          if (c == "\047") { st = 4; out = out c; prevc = c; continue }
          if (c == "`") { st = 5; out = out c; prevc = c; continue }
          out = out c; prevc = c; continue
        }
        if (st == 1) {
          if (c == "\n") { st = 0; out = out "\n" } else out = out " "
          prevc = c; continue
        }
        if (st == 2) {
          if (c == "\n") out = out "\n"; else out = out " "
          if (c == "/" && prevc == "*") st = 0
          prevc = c; continue
        }
        # 문자열 세 종류
        if (esc) { out = (c == "\n") ? out "\n" : out " "; esc = 0; prevc = c; continue }
        if (c == "\\") { esc = 1; out = out " "; prevc = c; continue }
        if ((st == 3 && c == "\"") || (st == 4 && c == "\047") || (st == 5 && c == "`")) {
          st = 0; out = out c; prevc = c; continue
        }
        if (c == "\n") { out = out "\n"; if (st != 5) st = 0; prevc = c; continue }
        out = out " "; prevc = c
      }
      return out
    }

    function matchPair(s, open, oc, cc,   i, n, depth, c) {
      n = length(s); depth = 0
      for (i = open; i <= n; i++) {
        c = substr(s, i, 1)
        if (c == oc) depth++
        else if (c == cc) { depth--; if (depth == 0) return i }
      }
      return 0
    }

    # 시그니처 시작 위치에서 본문 여는 중괄호를 찾는다. 반환 타입 안의 중괄호(Promise<{ ok: boolean }>)는 건너뛴다.
    function bodyOpen(s, sigStart,   p, i, n, c, angle, endParen) {
      p = index(substr(s, sigStart), "(")
      if (p == 0) return 0
      p = sigStart + p - 1
      endParen = matchPair(s, p, "(", ")")
      if (endParen == 0) return 0
      n = length(s); angle = 0
      for (i = endParen + 1; i <= n; i++) {
        c = substr(s, i, 1)
        if (c == "<") angle++
        else if (c == ">") { if (angle > 0) angle-- }
        else if (c == ";") return 0
        else if (c == "{") {
          if (angle > 0) { i = matchPair(s, i, "{", "}"); if (i == 0) return 0 }
          else return i
        }
      }
      return 0
    }

    # 본문의 첫 문장이 게이트인가. 주석은 이미 공백이 됐으므로 공백을 건너뛴 첫 글자부터가 첫 문장이다.
    function gatedFirst(s, ob,   rest) {
      rest = substr(s, ob + 1)
      sub(/^[ \t\r\n]+/, "", rest)
      if (rest ~ /^await[ \t\r\n]+requireAdmin\(\)[ \t\r\n]*;/) return 1
      if (rest ~ /^const[ \t]+[A-Za-z_$][A-Za-z0-9_$]*[ \t]*=[ \t]*await[ \t\r\n]+requireAdmin\(\)[ \t\r\n]*;/) return 1
      return 0
    }

    function lineOf(p,   parts, k) {
      if (p <= 1) return 1
      k = split(substr(txt, 1, p - 1), parts, "\n")
      return (k < 1) ? 1 : k
    }

    function bad(p, msg) {
      printf "%s:%d  %s\n", rel, lineOf(p), msg
      violations++
    }

    function nameAt(line,   s) {
      s = line
      sub(/^[ \t]*export[ \t]+(default[ \t]+)?(async[ \t]+)?function[ \t]*\*?[ \t]*/, "", s)
      if (match(s, /^[A-Za-z_$][A-Za-z0-9_$]*/)) return substr(s, 1, RLENGTH)
      return ""
    }

    # try / catch / finally 블록의 범위를 모은다 — 그 안의 게이트 호출은 throw 가 삼켜질 수 있다.
    function collectTrySpans(   i, n, p, abs, before, after, j, k, m, end) {
      n = length(txt); i = 1
      while (1) {
        p = index(substr(txt, i), "try")
        if (p == 0) break
        abs = i + p - 1
        before = (abs > 1) ? substr(txt, abs - 1, 1) : " "
        after = substr(txt, abs + 3, 1)
        if (before !~ /[A-Za-z0-9_$]/ && after !~ /[A-Za-z0-9_$]/) {
          j = abs + 3
          while (j <= n && substr(txt, j, 1) ~ /[ \t\r\n]/) j++
          if (substr(txt, j, 1) == "{") {
            end = matchPair(txt, j, "{", "}")
            while (end > 0) {
              k = end + 1
              while (k <= n && substr(txt, k, 1) ~ /[ \t\r\n]/) k++
              if (substr(txt, k, 5) == "catch" || substr(txt, k, 7) == "finally") {
                m = k
                while (m <= n && substr(txt, m, 1) != "{") m++
                if (m > n) break
                end = matchPair(txt, m, "{", "}")
              } else break
            }
            if (end > 0) { nspans++; spanStart[nspans] = abs; spanEnd[nspans] = end }
          }
        }
        i = abs + 3
      }
    }

    function inTrySpan(p,   k) {
      for (k = 1; k <= nspans; k++) if (p >= spanStart[k] && p <= spanEnd[k]) return 1
      return 0
    }

    { src = src $0 "\n" }

    END {
      txt = clean(src)
      violations = 0
      nlines = split(txt, L, "\n")
      pos = 1
      for (i = 1; i <= nlines; i++) { lstart[i] = pos; pos += length(L[i]) + 1 }
      # 지시어·모듈 경로는 문자열이라 clean() 이 내용을 지운다 — 그 둘은 원문 줄로 본다.
      nraw0 = split(src, RAW0, "\n")

      # ── 공통 5: 코드의 환경변수 분기 ──────────────────────────────────
      for (i = 1; i <= nlines; i++) {
        if (L[i] ~ /NODE_ENV/ || L[i] ~ /process[ \t]*\.[ \t]*env/) {
          bad(lstart[i], "관리자 경로에 환경변수 분기가 있다 (NODE_ENV/process.env) — 개발 전용 우회가 여기서 시작된다")
        }
      }

      # ── 공통 5: 가짜 게이트 · 출처 확인 ───────────────────────────────
      # 모듈 경로는 문자열이라 clean() 이 지운다 — import 검사만 원문(src)으로 한다.
      #
      # 독립 리뷰 M2: 경로만 보면 `import { resolveAdminSession as requireAdmin } from "@/lib/auth/requireAdmin"`
      # 가 통과한다. 그 함수는 **redirect 하지 않고 null 을 돌려주므로**(lib/auth/requireAdmin.ts:85-88)
      # 첫 문장 게이트가 그대로 no-op 이 되고 tsc 도 조용하다. 그래서 **이름 그대로의 바인딩**을 요구하고
      # `as requireAdmin` 별칭은 어떤 형태든 거부한다.
      hasCall = (txt ~ /requireAdmin[ \t]*\(/)
      if (txt ~ /function[ \t]+requireAdmin/ || txt ~ /(const|let|var)[ \t]+requireAdmin[ \t]*=/) {
        bad(1, "이 파일이 requireAdmin 을 스스로 정의한다 — 게이트는 lib/auth/requireAdmin 의 것 하나뿐이어야 한다")
      } else if (src ~ /as[ \t\r\n]+requireAdmin/) {
        bad(1, "다른 이름을 requireAdmin 으로 별칭했다 — 게이트 이름은 lib/auth/requireAdmin 의 것만 쓴다 (resolveAdminSession 은 redirect 하지 않는다)")
      } else if (hasCall) {
        if (src !~ /from[ \t]*["\047]@\/lib\/auth\/requireAdmin["\047]/) {
          bad(1, "requireAdmin 을 부르면서 @/lib/auth/requireAdmin 에서 가져오지 않는다")
        } else if (src !~ /[{,][ \t\r\n]*requireAdmin[ \t\r\n]*[,}]/) {
          bad(1, "requireAdmin 이 이름 그대로의 named import 가 아니다")
        }
      }

      # ── (b) use server 는 actions/admin/ 에만 (독립 리뷰 F1·M3) ───────
      # 모듈 맨 위든 함수 안(인라인 서버액션)이든 이 지시어 한 줄이면 공개 POST 엔드포인트가 생긴다.
      # 쓰기 액션이 한 곳에만 있다는 규약을 가정하지 않고 여기서 강제한다.
      if (useserver == "1" && indir != "1") {
        for (i = 1; i <= nraw0 && i <= nlines; i++) {
          if (RAW0[i] ~ /^[ \t]*["\047]use server["\047];?[ \t\r]*$/) {
            bad(lstart[i], "관리자 경로의 use server 지시어는 actions/admin/ 안에만 둔다 — 이 export 들은 화면을 거치지 않는 공개 POST 엔드포인트가 된다")
          }
        }
      }

      # ── 공통 5: try/catch 안의 게이트 ─────────────────────────────────
      collectTrySpans()
      i = 1
      while (1) {
        p = index(substr(txt, i), "requireAdmin")
        if (p == 0) break
        abs = i + p - 1
        if (substr(txt, abs + 12, 1) ~ /[ \t]*\(/ || substr(txt, abs + 12, 1) == "(") {
          if (inTrySpan(abs)) {
            bad(abs, "게이트 호출이 try/catch 블록 안이다 — redirect() 는 throw 라 catch 가 게이트를 삼킨다")
          }
        }
        i = abs + 12
      }

      # ── 공개 라우트의 조상 레이아웃: 게이트를 걸면 로그인이 무한 리다이렉트한다 ──
      if (mode == "shell") {
        if (hasCall) bad(1, "공개 라우트(로그인·콜백)를 감싸는 레이아웃이 게이트를 건다 — 로그인 화면이 자기 자신으로 리다이렉트한다")
        exit_code()
      }

      # ── export 목록 ───────────────────────────────────────────────────
      ROUTE_METHODS = "|GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|"
      CONFIG_EXPORTS = "|dynamic|dynamicParams|revalidate|fetchCache|runtime|preferredRegion|maxDuration|metadata|viewport|experimental_ppr|"
      foundDefault = 0
      methodCount = 0

      # 게이트를 요구하는 모드는 셋뿐이다. lib/admin·components/admin(mode=scan)의 export 는
      # 엔드포인트가 아니므로 여기서 보지 않는다 — 그쪽은 위의 공통 검사만 받는다.
      if (mode != "actions" && mode != "route" && mode != "page") exit_code()

      # 독립 리뷰 M1: `export[ \t]` 는 공백을 요구해서 `export{foo}` 를 통째로 놓쳤다 — 단어 경계로 본다.
      for (i = 1; i <= nlines; i++) {
        if (L[i] !~ /^[ \t]*export([ \t]|\{|\*|$)/) continue
        line = L[i]
        nm = nameAt(line)

        if (line ~ /^[ \t]*export[ \t]+default[ \t]/) {
          foundDefault = 1
          if (mode != "page") {
            bad(lstart[i], "이 파일에는 기본 export 가 있을 수 없다")
            continue
          }
          # 공개 예외(로그인 화면)는 세션 없이 렌더돼야 한다 — 모양도 게이트도 요구하지 않는다.
          if (exempt == "1") continue
          if (line !~ /^[ \t]*export[ \t]+default[ \t]+async[ \t]+function[ \t]/) {
            bad(lstart[i], "기본 export 가 `export default async function` 이 아니다 — 게이트를 구조적으로 확인할 수 없다")
            continue
          }
          ob = bodyOpen(txt, lstart[i])
          if (ob == 0) { bad(lstart[i], "함수 본문을 찾지 못했다"); continue }
          if (!gatedFirst(txt, ob)) bad(lstart[i], "본문 첫 문장이 `await requireAdmin();` 이 아니다")
          continue
        }

        if (nm == "generateStaticParams") {
          bad(lstart[i], "generateStaticParams 는 관리자 경로에 있을 수 없다 — 프리렌더된 HTML 은 게이트를 한 번도 거치지 않는다")
          continue
        }

        if (line ~ /^[ \t]*export[ \t]+async[ \t]+function[ \t]/) {
          if (mode == "route") {
            if (index(ROUTE_METHODS, "|" nm "|") == 0) {
              bad(lstart[i], "라우트 파일의 함수 export 는 HTTP 메서드여야 한다: " nm)
              continue
            }
            methodCount++
          } else if (mode == "page") {
            # 화면 파일에서 요청마다 서버에서 도는 것은 기본 export 와 메타데이터 생성기뿐이다.
            if (nm != "generateMetadata" && nm != "generateViewport") continue
          }
          # 액션 파일(mode=actions)의 export 는 전부 공개 POST 엔드포인트다 — 이름과 무관하게 게이트가 필요하다.
          if (exempt == "1") continue
          ob = bodyOpen(txt, lstart[i])
          if (ob == 0) { bad(lstart[i], nm " — 함수 본문을 찾지 못했다"); continue }
          if (!gatedFirst(txt, ob)) bad(lstart[i], nm " — 본문 첫 문장이 `await requireAdmin();` 이 아니다")
          continue
        }

        # 함수가 아닌 export
        # 타입 export 는 런타임에 사라진다 — 엔드포인트가 아니므로 액션·라우트 양쪽에서 똑같이 허용한다
        # (독립 리뷰 M4: 한쪽만 막으면 헛경보가 되고, 헛경보를 내는 게이트는 다음 사람이 꺼 버린다).
        if (line ~ /^[ \t]*export[ \t]+(type|interface)[ \t]/) continue
        if (mode == "actions") {
          bad(lstart[i], "use server 파일의 export 는 `export async function` 뿐이어야 한다 — 그 밖의 export 는 구조를 확인할 수 없다")
          continue
        }
        if (mode == "route") {
          if (nm != "" && index(CONFIG_EXPORTS, "|" nm "|") > 0) continue
          if (match(line, /^[ \t]*export[ \t]+(const|let|var)[ \t]+[A-Za-z_$][A-Za-z0-9_$]*/)) {
            s2 = line
            sub(/^[ \t]*export[ \t]+(const|let|var)[ \t]+/, "", s2)
            match(s2, /^[A-Za-z_$][A-Za-z0-9_$]*/)
            cn = substr(s2, 1, RLENGTH)
            if (index(CONFIG_EXPORTS, "|" cn "|") > 0) continue
            bad(lstart[i], "라우트 파일의 export 는 HTTP 메서드 또는 세그먼트 설정뿐이다: " cn)
            continue
          }
          bad(lstart[i], "라우트 파일에서 확인할 수 없는 export 형태다")
        }
      }

      if (mode == "actions" && indir == "1" && nlines >= 1) {
        first = ""
        for (i = 1; i <= nraw0; i++) { if (RAW0[i] ~ /[^ \t\r]/) { first = RAW0[i]; break } }
        if (first !~ /^[ \t]*["\047]use server["\047];?[ \t\r]*$/) {
          bad(1, "actions/admin 의 파일은 첫 문장이 use server 여야 한다")
        }
      }
      if ((mode == "page") && !foundDefault) bad(1, "기본 export 를 찾지 못했다 — 화면 파일은 기본 export 가 있어야 한다")
      if ((mode == "route") && methodCount == 0 && exempt != "1") bad(1, "HTTP 메서드 export 를 찾지 못했다")

      exit_code()
    }

    function exit_code() {
      exit (violations > 0) ? 1 : 0
    }
  ' "$file"
}

# ── 파일 순회 ────────────────────────────────────────────────────────────
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  rel="${rel#./}"
  base=$(basename "$rel")
  stem="${base%.*}"
  mode="scan"
  exempt="0"
  indir="0"

  # 이 파일이 서버액션 모듈인가 — **폴더 이름이 아니라 지시어로** 판정한다 (독립 리뷰 F1).
  # `lib/admin/writes.ts`·`components/admin/act.ts`·`app/admin/**/actions.ts` 어디에 있어도
  # use server 한 줄이면 그 export 는 전부 공개 POST 엔드포인트다.
  use_server="0"
  grep -qE "$USE_SERVER_RE" "$rel" 2>/dev/null && use_server="1"

  case "$rel" in
    actions/admin/*)
      mode="actions"
      indir="1"
      in_list "$rel" "${UNGATED_ACTIONS[@]}" && exempt="1"
      ;;
    app/admin/*)
      case "$stem" in
        route) mode="route" ;;
        page) mode="page" ;;
        layout|default|template) mode="page" ;;
      esac
      in_list "$rel" "${PUBLIC_ROUTES[@]}" && exempt="1"
      # 공개 라우트를 감싸는 레이아웃(= 예외의 조상)은 게이트를 걸 수 없다. 경로를 하드코딩하지 않고
      # 예외 목록에서 유도한다 — 예외가 옮겨 가면 이 판정도 함께 따라간다.
      if [ "$stem" = "layout" ] || [ "$stem" = "template" ] || [ "$stem" = "default" ]; then
        dir=$(dirname "$rel")
        for pub in "${PUBLIC_ROUTES[@]}"; do
          case "$pub" in
            "$dir"/*) mode="shell" ;;
          esac
        done
      fi
      ;;
  esac

  # (a) actions/admin 밖에 있어도 use server 파일이면 게이트 검사를 받는다.
  #     page·layout·route 는 자기 모드를 지킨다 — 그쪽은 기본 export 검사가 더 정확하고,
  #     아래 (b) 위반이 어차피 같은 파일에서 함께 보고된다.
  if [ "$use_server" = "1" ] && [ "$mode" = "scan" ]; then
    mode="actions"
  fi

  out=$(analyze "$rel" "$rel" "$mode" "$exempt" "$use_server" "$indir")
  status=$?
  if [ "$status" -ne 0 ] && [ -n "$out" ]; then
    while IFS= read -r linetext; do
      [ -n "$linetext" ] && report "$linetext"
    done <<< "$out"
  elif [ "$status" -gt 1 ]; then
    echo "$TAG: 분석 중 오류 — $rel"
    exit 2
  fi
done < <(find "${existing[@]}" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) | sort)

# ── 삭제된 우회 심볼 — 주석까지 포함해 원문 그대로 본다 ──────────────────
# 되살릴 수 있는 조각을 주석으로 남겨 두지 않는다(P5-3 독립 리뷰 F1).
bypass=$(grep -rnIE --exclude-dir=node_modules --exclude-dir=.next -e "$BYPASS_SYMBOLS" "${existing[@]}" 2>/dev/null)
grep_exit=$?
if [ "$grep_exit" -eq 0 ]; then
  while IFS= read -r linetext; do
    [ -n "$linetext" ] && report "삭제된 개발용 우회 심볼: $linetext"
  done <<< "$bypass"
elif [ "$grep_exit" -gt 1 ]; then
  echo "$TAG: grep 실행 중 오류 (exit ${grep_exit})."
  exit 2
fi

if [ "$violations" -gt 0 ]; then
  echo "$TAG: 위반 ${violations}건 — 관리자 경로의 인가 게이트가 구조적으로 보장되지 않는다."
  echo "$TAG: 규칙: export 된 async 함수의 **첫 문장**이 \`await requireAdmin();\` 이어야 한다(조건·try·early return 금지)."
  exit 1
fi

echo "$TAG: OK — 관리자 경로의 모든 화면·라우트·서버액션이 첫 문장에서 게이트를 통과한다."
exit 0
