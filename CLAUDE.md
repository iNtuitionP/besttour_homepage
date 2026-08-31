# CLAUDE.md — 베스트투어 홈페이지

## 1. 프로젝트 개요

- 베스트투어(전세버스 대절 알선업체) 홈페이지 리디자인/실구현. Next.js 15(고정) + Supabase(Postgres·Auth) + Vercel 배포.
- **확정 기준(스펙 §12, 2026-08-31 승격)**: 실시간 가격 계산 전면 제거. 홈은 지도 히어로 + Top-5 예시 견적(showcase_routes)을 정적 표시만 하고, 위저드는 가격 없이 접수만 받는다.
- 예약 흐름: 방문자 접수 → 사장님이 admin에서 확정 → 문자(Solapi) 통지. 온라인 결제 없음.

## 2. 명령어

```
npm run dev            # 로컬 개발 서버 (next dev --turbopack)
npm test               # vitest run — 단위/통합 테스트
npm run build          # 프로덕션 빌드 (next build --turbopack)
npm run check:pricing  # 가격 코드 회귀 게이트 — 금지 심볼 grep, 검출 시 CI 실패
```

## 3. 절대 규칙 (Global Constraints — 위반 시 리뷰 반려)

- **가격 계산 코드 금지.** `estimate()`, 배율 곱셈, `est_price`, `price_state`, `route_prices`, `PRICE_DISPLAY_MODE` 등 어떤 형태로도 작성하지 않는다. `lib/pricing.ts`는 만들지 말 것 — `check:pricing` CI 게이트가 grep으로 검출한다. 가격은 `showcase_routes` 테이블의 정적값 표시뿐이며, 실값 미수령 시 라벨 숨김 폴백(노선·핀만 표시)이 원칙 — 임시 가격 노출 상태로 정식 오픈 금지(런치 게이트).
- **BM 비노출 카피** (soul §10.2): "나가는 버스", "태우고 나가", "공차", "회송" 등 원가 구조를 드러내는 표현 절대 금지. 확정 표기는 **"공항 픽업·샌딩 (송영 전문)"**.
- **verbatim 문구 2개** — 원문 그대로, 임의 수정 금지:
  - 접수·확정: "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다."
  - Top-5 고지: "대표 노선 예시 견적 · 45인승 당일왕복 기준 · 실제 견적은 상담 후 확정"
- 운행 일시는 **KST 벽시계**로 수신(예: `2026-09-01T08:00`, `Z` UTC 입력 금지)하고 서버에서 `Asia/Seoul`로 해석한다. 장소·여행구분은 `lib/codes.ts`의 canonical code로 저장 — 번역 문자열을 저장하지 않는다.
- Supabase **service role 키는 서버 전용**(클라이언트 노출 금지). 공개 뮤테이션(예약 접수 등)은 반드시 **zod 검증 + Upstash RateLimit + Cloudflare Turnstile + 허니팟** 전부 통과 후 처리한다.
- 커밋 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## 4. 원본 (픽셀·카피 소스)

- 기준 목업(★): `mockups/variant-08-map-hero.html`(v8.1, 지도 히어로) · `mockups/wizard-b.html`(무가격 위저드) · `mockups/admin.html`(관리자). 픽셀·카피 임의 변경 금지, 팔레트는 `#3B1F5C #7C3AED #F3EFFA #1A1523 #FAF9FC #D4A843` 고정.
- `mockups/variant-07-final.html`, `mockups/wizard.html`(실시간 계산 UI 포함)은 **참고 아카이브로 강등** — 여기서 프론트 코드를 이식하지 말 것.

## 5. 문서 지도

- **스펙 §12 최우선**: `docs/superpowers/specs/2026-08-07-bestour-redesign-uiux-design.md` (§10·§11은 §12와 충돌하지 않는 범위에서만 유효)
- **플랜 v3.1**: `docs/superpowers/plans/2026-08-15-bestour-implementation-master.md` — Global Constraints·실행 하네스·Phase 분해·계약
- **디자인/카피 원본**: `mockups/soul.md` (§10.2 BM 비노출, §11 지도+무가격 확정 기준)
- **SDD 레저**(태스크 진행 기록): `.superpowers/sdd/2026-08-15-bestour-implementation-master/progress.md`

## 6. 테스트 정책

- **TDD** 원칙 — 테스트 먼저 작성 후 구현.
- DB가 필요한 테스트를 CI에서 skip하지 말 것 — 로컬 `supabase start` 스택으로 실행 예정(env 없다고 전부 skip 금지).
- UI 태스크는 gstack `/browse`로 실측 검증(콘솔 에러 0, 375px 가로 스크롤 없음, 인터랙션 동작 확인) 없이 완료로 간주하지 않는다.
