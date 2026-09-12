# CLAUDE.md — 베스트투어 홈페이지

## 1. 프로젝트 개요

- 베스트투어(전세버스 대절 알선업체) 홈페이지 리디자인/실구현. Next.js 15(고정) + Supabase(Postgres·Auth) + Vercel 배포.
- **확정 기준(스펙 §12, 2026-08-31 승격)**: 실시간 가격 계산 전면 제거. 홈은 지도 히어로 + **도시 단위 대표 노선 16개**(showcase_routes, 스펙 §13.2)를 정적 표시만 하고, 위저드는 가격 없이 접수만 받는다.
- 예약 흐름: 방문자 접수 → 사장님이 admin에서 확정 → 문자(Solapi) 통지. 온라인 결제 없음.

## 1-A. 🚨 최우선 조치 (2026-09-06 실측)

- **도메인 bestour.co.kr — 2026-09-12 갱신 완료(사장님, 카페24 경유).** 만료 위험 해소. whois 등록대행자는 가비아였으나 실제 갱신은 카페24에서 됐다 → **사장님이 카페24 계정에 접근 가능해진 것으로 보임**. 그렇다면 DNS(NS·A·MX)도 카페24에서 직접 바꿀 수 있어 P0-9 ③(Cloudflare NS 이전)의 필요성이 낮아진다 — 전환 전 확인.
- **접근권 현황 (2026-09-10)**: 사장님은 **카페24 로그인 불가**(옛 사이트는 타 업체 제작), **가비아 비회원 연장도 거부됨**(리셀러 경유 등록 추정). 등록인은 whois상 합자회사 베스트투어이므로 사업자등록증으로 통제권 회복 가능 — 가비아 고객센터 1544-4370. ~~통제권 확보가 최우선~~ → **갱신 완료로 만료 위험은 해소.** 남은 것은 DNS 변경 권한 확인(카페24 로그인 가능 여부). 가능하면 Cloudflare 이전 없이 카페24에서 A 레코드만 바꾸는 단순 경로로.
- **회사 메일은 DNS상 살아 있다** — MX `uws64-098.cafe24.com`. 단 카페24 로그인이 불가해 **실사용 여부 미확인**(모든 공개 연락처가 naver.com). 카페24 해지는 어차피 불가. 스펙 §13.4의 "메일 없음" 기술은 **정정됨**.
- DNS 현황: A `183.111.174.56`(카페24) · NS 4개(`ns1/ns2.cafe24.com`, `ns1/ns2.cafe24.co.kr`) · SPF `v=spf1 ip4:183.111.174.89 ~all` **있음** · **DMARC 없음** · DNSSEC 미서명. 전환은 **A 레코드만 Vercel로** 바꾸고 MX는 건드리지 않는다.
- **와일드카드 CNAME 함정**: `*.bestour.co.kr` 이 apex로 응답한다(실측 `zzq7random.bestour.co.kr` → 183.111.174.56). CNAME 이 있는 이름에는 MX/TXT를 둘 수 없어(RFC 1034) `_dmarc`·`_acme-challenge`·DKIM 이 조용히 실패한다. 서브도메인 인증을 쓰려면 **명시적 레코드로 덮어써야** 한다.

## 2. 명령어

```
npm run dev            # 로컬 개발 서버 (next dev --turbopack)
npm test               # vitest run — 단위/통합 테스트
npm run build          # 프로덕션 빌드 (next build --turbopack)
npm run check:pricing  # 가격 코드 회귀 게이트 — 금지 심볼 grep, 검출 시 CI 실패
bash scripts/check-temp-values.sh        # 임시값([TEMP] 마커) 전수 조회 — **P0-5부터 exit 1 게이트** (오픈 전 실값 교체 또는 명시적 유지 결정 필요)
bash scripts/check-legal-disclosures.sh  # 법정 문구 원장(lib/legal/disclosures.ts) 존재·금지어 검사 — P0-5 신설
bash scripts/check-mockup-drift.sh       # 목업 커밋 해시 고정 + public/brand↔mockups/assets/brand 해시 대조 — P0-5 신설
```

## 3. 절대 규칙 (Global Constraints — 위반 시 리뷰 반려)

- **가격 계산 코드 금지.** `estimate()`, 배율 곱셈, `est_price`, `price_state`, `route_prices`, `PRICE_DISPLAY_MODE` 등 어떤 형태로도 작성하지 않는다. `lib/pricing.ts`는 만들지 말 것 — `check:pricing` CI 게이트가 grep으로 검출한다. 가격은 `showcase_routes` 테이블의 정적값 표시뿐이며, 실값 미수령 시 라벨 숨김 폴백(노선·핀만 표시)이 원칙 — 임시 가격 노출 상태로 정식 오픈 금지(런치 게이트).
- **BM 비노출 카피** (soul §10.2): "나가는 버스", "태우고 나가", "공차", "회송" 등 원가 구조를 드러내는 표현 절대 금지. 확정 표기는 **"공항 픽업·샌딩 (송영 전문)"**.
- **verbatim 문구 2개** — 원문 그대로, 임의 수정 금지:
  - 접수·확정: "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다."
  - Top-5 고지: "대표 노선 예시 견적 · 45인승 당일왕복 기준 · 실제 견적은 상담 후 확정"
- 운행 일시는 **KST 벽시계**로 수신(예: `2026-09-01T08:00`, `Z` UTC 입력 금지)하고 서버에서 `Asia/Seoul`로 해석한다. 장소·여행구분은 `lib/codes.ts`의 canonical code로 저장 — 번역 문자열을 저장하지 않는다.
- Supabase **service role 키는 서버 전용**(클라이언트 노출 금지). 공개 뮤테이션(예약 접수 등)은 반드시 **zod 검증 + Upstash RateLimit + Cloudflare Turnstile + 허니팟** 전부 통과 후 처리한다.
- **실증 불가 수치 금지.** "누적 4,800건", "한해 70만 명", "오늘 접수 17건" 같이 사장님이 근거를 제시하지 못한 숫자는 쓰지 않는다(표시광고법 §5 실증책임). 쓸 수 있는 것: **2013년부터**(등록증 개업일), 통신판매업 신고번호, "공항 픽업·샌딩 (송영 전문)".
- **"면허"가 아니라 "등록".** 여객자동차 운수사업법상 전세버스는 등록제다. "면허 보유" 표기 금지. 차량 대수도 주장하지 않는다(협력사 차량이 섞여 실증 불가).
- **금지어 — 타사 상호.** 옛 사이트 하위 페이지에 남아 있던 **"전세버스하나관광"**은 어떤 파일에도 들어오면 안 된다(`check-legal-disclosures.sh`가 grep). 옛 사이트 카피를 옮길 때 특히 주의.
- **법정 문구는 `lib/legal/disclosures.ts` 단일 원장**(상수만, 함수 export 0개)에서만 가져온다. 컴포넌트·페이지에 사업자정보·취소환불·개인정보 고지 한글 리터럴을 직접 쓰지 않는다.
- 커밋 트레일러: **세션의 시스템 지시를 따른다** (`Co-Authored-By: Claude <모델명> <noreply@anthropic.com>` — 모델명은 세션마다 다르므로 여기 고정하지 않는다).

## 4. 원본 (픽셀·카피 소스)

- 기준 목업(★): `mockups/variant-08-map-hero.html`(v8.1, 지도 히어로) · `mockups/wizard-b.html`(무가격 위저드) · `mockups/admin.html`(관리자). 픽셀·카피 임의 변경 금지. **목업은 별도 UIUX 세션 소유**(2026-09-06부터) — 구현 세션은 읽기만 하고, 이식은 **목업 커밋 해시를 브리프에 고정**해 따라간다(플랜 ADR-8).
- **팔레트는 브랜드 실측값**(2026-09-06 가이드 스와치 측정, `docs/brand/README.md`): MAIN `#6F1C7C` · SUB `#C8A359` · POINT `#7B7A7A`. 구 임시 팔레트(`#3B1F5C #7C3AED …`)는 폐기. **`styles/semantic.css`가 유일한 색 교체 지점**이며 컴포넌트는 `styles/tokens.css`의 원시 토큰(`--brand-700` 등)을 직접 쓰지 않고 역할 토큰(`--text-primary`, `--action-primary-bg` 등)만 쓴다. `#7B7A7A`는 보더·아이콘 전용, 본문 보조 텍스트는 `--gray-text`(`#6C6B6B`).
- `mockups/variant-07-final.html`, `mockups/wizard.html`(실시간 계산 UI 포함)은 **참고 아카이브로 강등** — 여기서 프론트 코드를 이식하지 말 것.

## 5. 문서 지도

- **스펙 §12 최우선**: `docs/superpowers/specs/2026-08-07-bestour-redesign-uiux-design.md` (§10·§11은 §12와 충돌하지 않는 범위에서만 유효)
- **플랜 v4.2 (최우선)**: `docs/superpowers/plans/2026-09-06-bestour-implementation-v4.md` — ADR 10건·Phase P0~P7·계약·오픈 게이트·§10 사장님 답변 45항목 대조. v3.1을 대체한다.
- **옛 사이트 콘텐츠 인벤토리**: `docs/ops/legacy-content-inventory.md` — 인사말·보험 문구·차량 소개 원문(옮길 때 §1 금지어·§2 주의사항 필독)
- **UIUX 세션 인계 브리프**: `docs/handoff/2026-09-06-uiux-session-brief.md` — 파일 소유권 경계
- **SDD 레저 v4**: `.superpowers/sdd/2026-09-06-bestour-implementation-v4/` (브리프·보고서), 진행 기록은 아래 레저 파일에 계속 누적
- 구 플랜 v3.1: `docs/superpowers/plans/2026-08-15-bestour-implementation-master.md` (참고용, v4와 충돌 시 v4 우선)
- **디자인/카피 원본**: `mockups/soul.md` (§10.2 BM 비노출, §11 지도+무가격 확정 기준)
- **SDD 레저**(태스크 진행 기록): `.superpowers/sdd/2026-08-15-bestour-implementation-master/progress.md`

## 6. AI 하네스 (자동 게이트 — `.claude/settings.json`)

문서 규칙에만 기대지 않고 기계적으로 강제되는 층입니다. 훅 스크립트는 `.claude/hooks/`.

| 훅 | 동작 | 막는 사고 |
|---|---|---|
| SessionStart | `git fetch` 후 origin이 앞서면 경고 + 미커밋 변경 + 레저 최근 줄을 컨텍스트에 주입 | 다른 세션 작업을 모른 채 진행 |
| PreToolUse (Write\|Edit) | 아카이브 목업(variant-07-final·wizard·variant-01~06) 편집 **차단** | 폐기된 방향 부활, 아카이브 이식 |
| PreToolUse (Bash) | `cd`/`pushd`가 섞인 복합 명령 안의 `git push` **차단** (단독 실행 또는 `git -C` 요구) | 엉뚱한 원격으로 push |
| PostToolUse (Write\|Edit) | app/lib/actions/components/tests 편집 직후 `check-no-pricing.sh` 자동 실행, 위반 시 즉시 통보 | 가격 계산 코드 부활 (CI보다 왼쪽에서 차단) |
| CI `legal-disclosures` (P0-5) | `check-legal-disclosures.sh` — 원장 파일이 생기는 순간부터 필수 문구 존재·`면허`·`전세버스하나` 금지어 검사 | 법정 문구 누락, 타사 상호 유입 |
| CI `mockup-drift` (P0-5) | `check-mockup-drift.sh` — 브리프에 고정한 목업 해시와 현재 해시 대조, 브랜드 자산 두 사본 해시 대조 | 목업이 바뀐 줄 모르고 이식, 자산 사본 불일치 |
| CI `temp-values` (P0-5) | `check-temp-values.sh` exit 1 승격 — 단 CLAUDE.md 등 규약 설명 문장은 제외 | 임시값이 오픈까지 살아남음 |

**창작 금지 규약(L5)**: 확인되지 않은 값(사장님 미수령 데이터 등)에는 반드시 `[TEMP]` 마커를 주석으로 남긴다. Phase 게이트에서 `bash scripts/check-temp-values.sh`로 전수 확인하고, 정식 오픈 전 실값 교체 또는 명시적 유지 결정을 기록한다. 마커 없는 값 창작은 금지.

**독립 리뷰·서명 규칙 (2026-09-11 신설)**: 법정 문안·개인정보·되돌릴 수 없는 작업(마이그레이션·파기·발송)을 만든 태스크는
**구현자 보고서와 게이트 통과만으로 완료가 아니다.** 컨트롤러가 보고서에 서명표를 채워 승인·조건부·반려를 판정하고 근거를 적는다.
컨트롤러가 브리프를 직접 쓴 태스크는 **자기 검수에 해당하므로** 별도 독립 리뷰어(수정 권한 없음, 모든 지적에 파일:줄·실행출력 근거 필수)를 붙인다.
근거: 2026-09-11 독립 리뷰가 게이트 4종·테스트 515건을 전부 통과한 법정 문안에서 치명 2건(국외이전 필수항목 누락·국내 리전을 국외로 고지)을 찾았다.
빈 값 숨김이 누락을 화면에서 지우고 테스트가 그것을 green 으로 단언했기 때문에, 기계 게이트만으로는 구조적으로 잡을 수 없었다.

**서브에이전트 규칙**: 구현자는 커밋·푸시하지 않는다(컨트롤러 담당). 브리프 파일로 요구사항을 받고, 보고서 파일로 결과를 남긴다. UI 태스크는 리뷰어가 browse로 실측한다. **병렬 발행 전 브리프의 파일 목록을 교차검사한다 — 겹치면 직렬**(2026-09-11 P0-0/P0-3 충돌 위험에서 배움). 브리프 범위 밖 파일을 건드렸으면 보고서에 이유를 적는다.

## 7. 테스트 정책

- **TDD** 원칙 — 테스트 먼저 작성 후 구현.
- DB가 필요한 테스트를 CI에서 skip하지 말 것 — 로컬 `supabase start` 스택으로 실행 예정(env 없다고 전부 skip 금지).
- UI 태스크는 gstack `/browse`로 실측 검증(콘솔 에러 0, 375px 가로 스크롤 없음, 인터랙션 동작 확인) 없이 완료로 간주하지 않는다.
