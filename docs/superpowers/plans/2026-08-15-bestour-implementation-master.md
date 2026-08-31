# 베스트투어 실구현 마스터 플랜 (v3 — 2026-08-31 무가격+지도 방향 승격 반영)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> v3 변경: 스펙 §12 승격(실시간 가격 계산 전면 제거, v8.1 지도 히어로 + wizard-b 무가격 위저드가 기준) 반영. v2의 estimate 엔진·route_prices·PRICE_DISPLAY_MODE 폐기, showcase_routes 신설, Phase 0(UIUX 확정판 정리·아티팩트 재발행) 추가, 배포·런치까지 포함. v2에서 승계된 리뷰 결정(Server Actions/Upstash+Turnstile/after()/KST/canonical codes/상태 머신/개인정보 요건)은 전부 유지.

**Goal:** 승격된 기준안(v8.1 + wizard-b + admin)을 실제 서비스로 구현·배포한다 — 무가격 견적 접수, 문자 알림, 관리자 운영, bestour.co.kr 오픈까지.

**Architecture:** Next.js App Router(폼 뮤테이션 = Server Actions, 캐시 읽기 = Route Handler) + Supabase(Postgres·Auth·Storage) + Solapi(after()로 응답 후 발송). **가격 계산 로직이 없다** — 홈은 showcase_routes 테이블의 Top-5 예시 견적을 표시만 하고, 위저드는 가격 없이 접수만 받는다. 운행 일시는 KST 벽시계 수신·Asia/Seoul 해석, 장소·여행구분은 canonical code 저장.

**Tech Stack:** Next.js 15(고정), Supabase(@supabase/supabase-js, @supabase/ssr), next-intl(KO 기본/EN), solapi, zod, @upstash/ratelimit, Cloudflare Turnstile, vitest, CSS Modules + 토큰(Tailwind 미사용), Pretendard 서브셋 self-host.

**Spec:** docs/superpowers/specs/2026-08-07-bestour-redesign-uiux-design.md (**§12 최우선**, §10·§11은 §12와 충돌하지 않는 범위에서 유효) + mockups/soul.md(§11 확정) + 기준 목업 3종(variant-08-map-hero.html, wizard-b.html, admin.html)

## Global Constraints

- 기준 목업 = v8.1·wizard-b·admin. 픽셀·카피 임의 변경 금지. 팔레트 `#3B1F5C` `#7C3AED` `#F3EFFA` `#1A1523` `#FAF9FC` `#D4A843`
- **가격을 계산하는 코드 금지.** 가격은 showcase_routes의 정적 값 표시뿐. "예상가" 자동 산출·배율 곱셈 로직을 만들지 않는다
- Top-5 표시에는 고지 문구 필수(verbatim): "대표 노선 예시 견적 · 45인승 당일왕복 기준 · 실제 견적은 상담 후 확정"
- Top-5 실값 미수령 시 **가격 라벨 숨김 폴백**(노선·핀만 표시) — 임시 가격으로 정식 오픈 금지 (런치 게이트)
- BM 비노출 카피 규칙(soul §10.2) 한/영 공통 유지. "공항 픽업·샌딩 (송영 전문)" 표기
- 접수·확정 문구 verbatim: "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다."
- 차량 5종·회사 정보 soul 원문 그대로. 6개 메뉴 보존. 375px 가로 스크롤 금지
- 공개 뮤테이션 = zod + Upstash RL + Turnstile + 허니팟. service role 서버 전용
- 운행 일시 KST 벽시계(`2026-09-01T08:00`) 수신, 서버 Asia/Seoul 해석. `Z` UTC 입력 금지
- 장소/여행구분 canonical code 저장(lib/codes.ts). 번역 문자열 저장 금지
- 모든 커밋 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## 실행 하네스 (전 Phase 공통 — 이 플랜의 품질 체계)

| 게이트 | 도구 | 시점 |
|---|---|---|
| 태스크 실행 | superpowers:subagent-driven-development — 태스크별 프레시 구현자 + 레저(.superpowers/sdd/) | 매 태스크 |
| 태스크 리뷰 | 구현자와 별도의 리뷰어 서브에이전트 — 스펙 준수 + 품질, UI 태스크는 browse 실측(콘솔 0·375px·인터랙션) | 매 태스크 직후 |
| 픽스 루프 | 리뷰 발견 → 구현자 resume → 스코프 재검증 (최대 5라운드) | 발견 시 |
| 단위/통합 테스트 | vitest + CI(GitHub Actions, `supabase start` 로컬 스택 — env 없어 전부 skip 금지) | 매 커밋/푸시 |
| Phase 게이트 | Phase 완료 시 phase 수용 기준 실측 + 레저 기록. Phase 0 뒤에는 **사장님 컨펌 게이트**(아티팩트 링크) | Phase 경계 |
| 라이브 QA | /qa (gstack browse) — 프리뷰 URL에서 접수→DB→문자 E2E, 모바일 반응형 | Phase B·D 완료 시 |
| 아웃사이드 보이스 | codex exec 교차 리뷰 — 플랜 개정 시 1회 + 최종 브랜치 리뷰 시 1회 | 플랜/머지 경계 |
| 최종 브랜치 리뷰 | 머지 전 whole-branch 리뷰(최상위 모델) + 픽스 웨이브 1회 + 스코프 재검증 | E 직전 |
| 배포 | Vercel preview(PR별) → production(main 머지). 도메인 전환은 E의 체크리스트(MX 백업·TTL 단축·롤백)로만 | 상시/런치 |

## 0. 저장소 구조 (v2에서 변경분만)

```
actions/reservations.ts      # createReservation, lookupReservations (가격 필드 없음)
actions/admin.ts             # 상태 변경·재발송·팝업/공지/갤러리 CRUD + showcaseRoutes 편집
app/api/live-feed/route.ts   # 유일한 Route Handler
components/KrMap.tsx         # mockups/assets/kr-map.svg 이식 + Top-5 핀/곡선/라벨 렌더
lib/ codes.ts kst.ts mask.ts notify.ts rate-limit.ts turnstile.ts public-code.ts
     (v2의 pricing.ts 없음 — 만들지 말 것)
supabase/migrations/0001_init.sql, 0002_admin_policies.sql
```

## 1. DB 스키마 (v2 대비 변경)

**제거**: route_prices 테이블, reservations의 est_price·price_state·price_breakdown, price_state enum, price_rules의 배율 행 사용처(테이블은 남겨도 무방하나 시드하지 않음).
**vehicles.base_price 제거**(가격 계산 없음 — capacity·이름·정렬만 유지).
**신설**:

```sql
create table showcase_routes (              -- 홈 지도 Top-5 예시 견적 (admin 편집)
  id serial primary key,
  origin_code text not null, destination_code text not null,
  price_from int check (price_from is null or price_from > 0),  -- null = 라벨 숨김 폴백
  highlight boolean not null default false,  -- 인천공항→서울 골드 강조
  sort int not null default 0, active boolean not null default true
);
alter table showcase_routes enable row level security;
create policy showcase_read on showcase_routes for select using (active);
-- 시드: 임시 5행 (ICN→SEL 350000 highlight, SEL→BSN 1200000, SEL→GW 700000, SEL→DJN 600000, SEL→JB 800000)
-- ※ 임시값 — 사장님 실값 수령 전 프로덕션에서는 price_from을 null로 두는 것이 런치 게이트
```

reservations는 v2 스키마에서 가격 3필드만 뺀 형태(public_code·email·waypoint_codes·nights·CHECK 제약·보존 1년 전부 유지). notifications_log·popups·notices·gallery·0002 단일 관리자 정책 변경 없음.

## 2. 계약 (v2 대비 변경)

- `ReservationInput`: v2에서 그대로, 단 서버가 가격을 계산·저장하지 않음. `createReservation` 반환: `{ ok: true; publicCode: string }` (estPrice 없음).
- `ReservationPublic`: estPrice·priceState 필드 제거.
- `lib/pricing.ts`·estimate 계약 **폐기** — v2의 A3 태스크와 관련 테스트 전부 삭제 대상.
- 신규: `getShowcaseRoutes(): Promise<ShowcaseRoute[]>` (공개 읽기, 60초 캐시), `updateShowcaseRoute(id, { priceFrom, active })` (admin action, 5행 고정 편집 — 행 추가/삭제 UI는 만들지 않음: 사장님 운영 부담 최소화 원칙).
- 상태 머신·재발송·notify 계약은 v2 그대로.

## 3. 환경 변수

v2 §4에서 `PRICE_DISPLAY_MODE` 제거. 나머지 동일 (Supabase 3종, Upstash 2종, Turnstile 2종, Solapi 2종+SMS_SENDER+OWNER_PHONE, 채널 URL 2종).

## 4. 사장님 데이터 체크리스트 (v3)

| 데이터 | 막히는 것 | 없을 때 |
|---|---|---|
| **Top-5 대표 노선 실제 가격** | E 정식 오픈 (런치 게이트) | price_from=null → 라벨 숨김, 노선만 표시 |
| 창업연도·실적 수치 | B 홈 카피 | 임시값 + 내부 표시 |
| 발신번호 서류 / 사업자등록증·카카오 채널 | C | SMS 스텁 / SMS만 |
| 카카오·톡톡 URL | B | "준비 중" 안내 |
| 도메인 계정(+MX 목록) / 개인정보 책임자·보존 기간 | E | Vercel 도메인 검수 / 표준 초안 |
| 고화질 사진·공지 이관·영문 표기 | B·E | 기존 스크랩·초안 |

## 5. Phase 분해

| Phase | 산출물 | 완료 기준 (게이트) |
|---|---|---|
| **0. UIUX 확정판** | v8.1·wizard-b browse 실측 리뷰(첫 QA — 콘솔 0·375px·지도/핀 렌더·위저드 6단계 검증) → 발견 수정 → 뷰어(index.html + 아티팩트 464f96b6) 재구성: ★기준안 v8.1/wizard-b/admin 상단, v7 계열 아카이브 라벨 → 같은 URL 재발행 | browse 리뷰 clean + 아티팩트 갱신 + **사장님 컨펌 게이트**(링크 전달, 승인 후 A 착수 — 단 A는 UI 무관이므로 병렬 착수 허용, B는 컨펌 후) |
| **A. 기반** | 스캐폴드(v2 A1 방식: _scaffold 우회+next@15 고정+intl matcher 제외) + 스키마 v3 + codes/kst/mask(TDD, v2 테스트에서 pricing 제외 전부) + createReservation/lookup Server Actions(허니팟→Turnstile→RL→zod→KST→insert→after 발송 no-op, **가격 없음**) + live-feed(+시드 sample 라벨) + showcase_routes 읽기 + Vercel/CI | 프리뷰 URL 실접수→DB 행+public_code, vitest 전 경로(역순 날짜·zod 상한·RL·봇·허니팟·발송 격리 포함) 통과, CI green(skip 아님) |
| **B. 공개 사이트** | v8.1 이식(KrMap 컴포넌트: kr-map.svg+핀·곡선·라벨·polyfill 없음, showcase 데이터 연동+고지 문구+라벨 숨김 폴백), wizard-b 이식(6단계·다중 경유지·전화 검증·완료 verbatim), 서브페이지 5종, KO/EN(next-intl), 팝업 노출, 피드, 문의 3종, Turnstile 위젯, next/image, Pretendard 서브셋 | 목업 대조 스크린샷 동일, EN 전환, Lighthouse 모바일 90+, /qa 통과 |
| **C. 알림** | notify.ts(Solapi·전화 정규화), created/confirmed 발송(문자 본문 = wizard-b 완료 화면 미리보기 문구·경로 포함·**가격 없음**), 중복 발송 가드, admin 재발송, mock 3경로 테스트 | 실기기 수신, 실패 로그·재발송 동작 |
| **D. admin** | @supabase/ssr 세션+0002 정책, 예약 현황(상태 머신), 팝업/공지/갤러리 CRUD, **Top-5 가격 편집**(5행 고정: 가격 입력·라벨 숨김 토글만) | 사장님 E2E(로그인→확정→문자→팝업→홈 노출→Top-5 가격 수정→홈 반영), 비관리자 차단 |
| **E. 이관·런치** | 콘텐츠 이관, 개인정보처리방침, SEO/hreflang/OG/sitemap, 도메인 전환(MX 백업·TTL·롤백), **런치 게이트: Top-5 실값 입력 또는 라벨 숨김 확정**, 구 게시판 중단 안내, Vercel Analytics | bestour.co.kr 서비스 개시 체크리스트 전항 통과 |

의존: 0 → (A 병렬 가능) → B, C는 A 후 B와 병렬, D는 A·C 후, E는 전부 후. 최종 브랜치 리뷰(+codex)는 E 직전.

### 데이터 플로우 (v3)

```
[방문자] ─ 홈 ─→ GET showcase_routes (60s 캐시) ─→ KrMap 핀+가격 라벨(또는 숨김)
[방문자] ─ wizard-b 6단계 ─→ createReservation ─ 허니팟→Turnstile→RL→zod→KST
              └ insert(가격 필드 없음) → after(): 사장님/고객 문자 → notifications_log
[사장님] ─ /admin ─→ 예약 확정(상태 머신·중복 가드·문자) · Top-5 가격 편집 · 팝업/공지/갤러리
```

## 6. v2에서 폐기되는 것 (구현 금지 목록)

- lib/pricing.ts / estimate() / EstimateResult / route_prices / PRICE_DISPLAY_MODE / 위젯·위저드의 실시간 계산 JS / est_price·price_state·price_breakdown 컬럼 / v2 A3 태스크와 그 테스트 전부
- v7·wizard.html의 계산 UI를 이식하는 실수 방지: 프론트 이식 원본은 **v8.1·wizard-b만**

## NOT in scope

- 온라인 결제 / 자동 재시도 큐 / 3개 국어+ / 모바일 앱·외부 API / 그누보드 견적 게시글 이관(개인정보) — v2와 동일
- **노선·차량별 요금표 관리 UI** — §12 승격으로 명시 제외 (Top-5 예시 5행 편집만 제공)

## 실패 모드 (v3 변경분)

| 코드패스 | 시나리오 | 대비 |
|---|---|---|
| showcase 조회 실패 | DB 장애 시 홈 지도 빈 라벨 | 정적 폴백(노선명만) + 캐시, 콘솔 무에러 |
| Top-5 임시값 노출 | 실값 없이 오픈 | 런치 게이트 + price_from null 폴백 (E 체크리스트) |
| KrMap SVG 렌더 | 구형 브라우저·저사양 | 인라인 SVG(외부 요청 없음), 모바일은 카드 리스트 보완(soul §11) |
| 가격 문의 폭주 | 가격 없어 전화·접수 증가 | 의도된 동작 — 문의 3종·응대 시간 표기로 흡수 |

## Implementation Tasks (플랜 개정 산출)

- [x] T1 (P1) — 스펙 §12·soul §11 승격 기록 (이 커밋)
- [ ] T2 (P1) — Phase 0 실행: v8.1·wizard-b browse 리뷰 → 뷰어·아티팩트(464f96b6) 재구성·재발행 → 사장님 컨펌 요청
- [ ] T3 (P1) — Phase A~E를 SDD로 실행 (착수 시 Phase별 상세 태스크는 v2 A1~A7 형식을 v3 §1·§2 계약으로 치환해 브리프 생성)
- [ ] T4 (P2) — 사장님 Top-5 실값 수령 시 showcase 시드 교체 + 런치 게이트 해제
- [ ] T5 (P3) — 오픈 후 계측(Vercel Analytics)으로 "가격 문의 전환" 측정 → 가격 표시 재도입 여부 데이터로 재논의

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 (v2) | CLEAR — v3에 승계 | v2 9건 반영 유지, v3 델타는 Codex 교차 검토로 커버 |
| Codex Review | outside voice | Independent 2nd opinion | 2 | v2: 15건 수용 / v3 델타: 본 커밋 후 1회 실행 예정 | §12 승격 델타 스코프 |
| CEO/Design/DX | — | — | 0 | — | 목업 단계 시각 QA로 갈음 |

- **VERDICT:** v3 개정 완료 — Codex 델타 검토 1회 후 Phase 0 착수 가능

NO UNRESOLVED DECISIONS
