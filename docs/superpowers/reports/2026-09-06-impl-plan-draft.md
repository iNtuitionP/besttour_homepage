# 베스트투어 실구현 최종 계획 v4 (2026-09-06 합성판)

> 이 문서는 `docs/superpowers/plans/2026-08-15-bestour-implementation-master.md` (v3.1)을 **대체**한다. v3.1은 아카이브로 강등하되 삭제하지 않는다(Phase A 실행 이력이 레저와 연결되어 있다).
> **For agentic workers:** REQUIRED SUB-SKILL — `superpowers:subagent-driven-development`. 태스크 1개 = SDD 브리프 1개. 구현자는 커밋·푸시하지 않는다.

---

## 0. 이 계획의 전제와 범위 (무엇을 하지 않는지 포함)

### 0.1 합성의 근거

- 본 계획은 3개 초안과 3인 심사의 **합성 규칙**(최고점 초안을 뼈대로, 치명 결함 전부 해소, "전원 누락" 항목 필수 포함)에 따라 작성했다. 초안·심사 원문은 이 세션 환경에서 접근할 수 없었으므로, **1차 사료를 직접 재확인**해 뼈대를 다시 세웠다: 스펙 §12·§13 전문, `docs/superpowers/reports/2026-09-06-decision-memo.md` 전문(P0~P3 28항), `supabase/migrations/0001_init.sql`, `lib/*.ts` 실제 export, `middleware.ts`, `.github/workflows/ci.yml`, `scripts/*.sh`, `styles/tokens.css`, SDD 레저.
- 그 결과 **코드 실측으로 확인한 구조적 결함 8건**을 계획의 뼈대로 삼았다(§0.3). 이것이 "치명 결함 해소"의 실체이며, 심사 원문 없이도 검증 가능한 형태로 남긴다.

### 0.2 전제 (이 계획이 참인 것으로 삼는 것)

1. 스펙 §13 > §12 > 그 외. 충돌 시 §13이 이긴다.
2. 가격 계산 코드는 어떤 형태로도 만들지 않는다. 전자상거래법 §13②3호 대응은 **정적 안내 문구**로만 한다.
3. 대표 노선 16개와 그 가격은 **사장님이 확정한 실값**이다(스펙 §13.2). 따라서 이 값의 DB 시드는 `[TEMP]` 창작이 아니며, 마이그레이션 주석에 출처(스펙 §13.2)를 기록하는 조건으로 허용한다. 다만 `price_from IS NULL` 라벨 숨김 코드 경로는 폴백으로 계속 유지한다.
4. 목업(`mockups/**`)은 **다른 세션이 계속 바꾼다**. 이 계획은 목업이 흔들려도 코드가 깨지지 않는 경계를 먼저 만든다.
5. Phase A 일부(A1 스캐폴드·A2 스키마/계약·A3 KST/마스킹·A5 CI)는 **이미 완료**되어 있고 원격 DB에 0001이 적용되어 있다. 본 계획은 그 위에서 이어간다.

### 0.3 이 계획이 반드시 해소하는 구조적 결함 (코드 실측 기준)

| # | 결함 | 실측 근거 | 해소 위치 |
|---|---|---|---|
| D1 | **admin 인증을 심을 자리가 없다** | `middleware.ts:22` matcher가 `admin`을 제외. admin 라우트·세션 검사·정책 마이그레이션 전무 | D1 |
| D2 | **확정 16개 노선을 현 스키마로 표현할 수 없다** | `0001_init.sql`의 `origin_code/destination_code` CHECK가 REGIONS 17개 고정 → 세종 코드 부재, 서울→통영/포항이 `unique(origin,destination)`과 무관하게 **애초에 삽입 불가** | P0-4·P0-5 |
| D3 | **동의·보존 기록 컬럼 0개** | `reservations`에 `privacy_consent_at` 등 없음. 입증책임(PIPA §22③) 불이행 | L1 |
| D4 | **법정 표시 라우트 0개** | `app/`에 `layout/page/globals` 3개뿐. `/privacy`·`/terms`·`/guide` 없음 | L2~L5 |
| D5 | **위저드의 "이메일로 견적 받기" 약속에 대응하는 발송 경로가 전무** | 의존성에 메일 SDK 없음(`package.json`). 지키지 못하는 약속 | C4 |
| D6 | **파기 배치 없음** — `retention_until`도 컬럼도 크론도 없다 | 0001 전문 확인 | L1·E4 |
| D7 | **리다이렉트 0건** — `next.config.ts`가 빈 설정 | 구 그누보드 URL 12종이 전부 404가 된다 | E1 |
| D8 | **팔레트가 두 갈래로 갈라져 있다** | `styles/tokens.css`는 `--deep:#3B1F5C` 계열(CLAUDE.md §4 고정값), 실측 브랜드 MAIN은 `#6F1C7C`. 컴포넌트가 원시 토큰을 직접 쓰면 교체 시 전 파일 수정 | P0-2 |

### 0.4 범위 밖 (하지 않는다)

- **`mockups/**` 편집** — UIUX 세션 소유. 이 계획은 목업을 읽기만 한다.
- **팔레트 최종 결정** — 사장님 승인 + UIUX 세션 사안. 코드는 교체 지점만 1곳으로 만든다(P0-2).
- 온라인 결제, 자동 재시도 큐, 3개 국어 이상, 모바일 앱, 외부 API 공개.
- **노선·차량별 요금표 관리 UI**(§12 명시 제외).
- **도메인 갱신(2026-10-05 만료)** — 사장님이 직접 요청 예정(스펙 §13.11). 개발 일정에서 분리하되 §8 게이트에 리스크로 남긴다.
- **메일 서비스 이전**(카페24 → 타사) — 오픈 게이트 아님. MX는 건드리지 않는다.
- **그누보드 견적 게시글(개인정보 포함) 이관** — 이관하지 않는다. 백업만 사장님 PC에 보관.
- 카카오 알림톡 템플릿 심사 통과 자체(대행 불가) — SMS(LMS) 우선, 승인 후 전환 슬롯만 만든다.

---

## 1. 전략 요약

목업이 계속 흔들리고 사장님 회신이 절반만 들어온 상태이므로, **가장 늦게 흔들리는 것(법정 표시·DB 계약·인증 경계)을 먼저 고정하고 가장 자주 흔들리는 것(픽셀·카피)은 마지막에 흡수**한다. 그래서 Phase 순서를 v3.1의 "기반→공개사이트"에서 **"계약 동결(0) → 법정 골격(L) → 접수 파이프라인(A) → 공개 사이트(B)"** 로 바꾼다 — /privacy·/terms·/guide와 동의 고지는 히어로 디자인과 무관하게 지금 만들 수 있고, 오픈을 막는 것은 히어로가 아니라 이 6종이기 때문이다. 목업 변경은 **2계층 토큰 · messages 단일 카피 소스 · 섹션 컴포넌트 1:1 매핑** 세 경계로만 코드에 들어오게 하고, 드리프트는 `scripts/check-mockup-drift.sh`가 기계적으로 알린다. 확인되지 않은 값은 폴백을 만들되 **법정 표시 항목은 폴백을 만들지 않고 오픈을 막는다**(문구를 지어내면 그게 위반이다). 도메인 전환은 A 레코드 1줄 교체 + 와일드카드 포기로 축소하고, 코드 측 준비물(리다이렉트·robots·sitemap·소유확인)을 컷오버 이전에 전부 테스트로 못박는다.

---

## 2. 아키텍처 결정 (ADR)

### ADR-1. 목업은 이식하지 않는다 — 3경계로만 흡수한다
- **결정**: 목업 HTML을 컴포넌트로 옮겨 적지 않는다. ① **2계층 CSS 토큰**(`styles/tokens.css` = 목업 `:root` 미러 / `styles/semantic.css` = 컴포넌트가 쓰는 의미 토큰), ② **카피 단일 소스** `messages/{ko,en}.json`, ③ **섹션↔컴포넌트 1:1 매핑표** `docs/superpowers/contracts/mockup-map.md`. 이 3개 파일 밖에서 목업을 참조하지 않는다.
- **대안**: (a) 목업 HTML 직접 이식 — 목업이 바뀔 때마다 전 컴포넌트 재작업. (b) Tailwind 재작성 — 컨펌된 픽셀 보존 실패, §11 결정 위반.
- **근거**: UIUX 세션이 병행 수정 중이다. 픽셀 값은 토큰 1곳, 문장은 messages 1곳으로 들어오게 하면 목업 변경의 코드 영향이 "값 교체"로 축소된다. D8(팔레트 이원화)도 같은 장치로 해결된다 — 컴포넌트는 `--brand-main`만 쓰고, `#3B1F5C`냐 `#6F1C7C`냐는 `semantic.css` 한 줄이 결정한다.

### ADR-2. 법정 문서는 "코드로 관리 + 버전 스탬프"
- **결정**: `/privacy`·`/terms`·`/guide` 본문을 `content/legal/*.ts`에 TypeScript 상수로 두고 `LEGAL_VERSIONS = { privacy: '2026-09-XX', terms: '...', guide: '...' }`를 함께 export. 접수 시 서버가 현재 버전 문자열을 `reservations.privacy_policy_version`에 스탬프한다.
- **대안**: (a) DB 테이블에 저장 + admin 편집 — 사장님이 법정 문서를 편집하면 위반을 스스로 만든다. (b) 하드코딩만, 버전 없음 — 어느 시점 고객이 어떤 고지를 봤는지 입증 불가.
- **근거**: PIPA §22③ 입증책임은 처리자에게 있다. 변경 이력은 git이 갖고, 특정 접수건이 본 문서는 버전 문자열로 특정된다. 클라이언트가 보낸 버전과 서버 상수가 다르면 **재동의를 요구**해 낡은 탭에서의 접수를 막는다.

### ADR-3. 장소 코드 = 도시 단위 카탈로그(코드 소유 상수 + DB 테이블 이중화)
- **결정**: `lib/places.ts`에 `PLACES`(code·ko·en·lat·lon·kind: 'airport'|'metro'|'province'|'city')를 코드 소유 상수로 두고, 동일 목록을 `supabase/migrations/0003_places_catalog.sql`의 `places` 테이블로 시드한다. `showcase_routes`의 CHECK 제약을 `places(code)` FK로 교체. 기존 REGIONS 17개는 그대로 카탈로그에 포함(상위 호환).
- **대안**: (a) REGIONS 유지 — D2로 16개 노선 삽입 불가. (b) DB만 소유 — DB 장애 시 지도 폴백 렌더 불가(v3.1 §7-9가 요구한 정적 폴백 카탈로그가 사라짐).
- **근거**: 스펙 §13.2. 좌표는 이미 검증된 `lib/map-coords.ts`의 선형 변환식(`x=83.043592·lon−10348.318693`, `y=−103.311021·lat+3988.951380`)으로 도시 좌표를 산출하므로 새 창작이 아니다. `lib/codes.ts`의 `RegionCode`는 삭제하지 않고 `PlaceCode`의 부분집합으로 남긴다(기존 42개 테스트 보존).

### ADR-4. admin 인증 = 미들웨어 + 서버 레이아웃 이중 게이트, service role은 액션 내부에만
- **결정**: `middleware.ts` matcher에서 `admin` 제외를 **삭제**하고 `/admin/:path*`를 별도 matcher로 추가해 `@supabase/ssr` 세션 갱신·미인증 리다이렉트를 수행. 그 위에 `app/admin/layout.tsx`가 서버에서 세션 + `admin_users` 소속을 재검사(미들웨어 단독 신뢰 금지). service role 클라이언트는 `actions/admin/*.ts` 내부에서만 생성하며, 생성 직전에 반드시 `requireAdmin()`을 통과한다.
- **대안**: (a) Basic Auth — 감사 로그·계정 관리 불가. (b) RLS만으로 — admin 조회가 service role을 쓰는 설계라 RLS가 우회되어 아무것도 막지 못한다(현 설계의 실제 구멍).
- **근거**: D1. 미들웨어는 우회 가능한 층으로 취급하고, 권한 판정의 단일 진실은 서버 컴포넌트/액션에 둔다.

### ADR-5. 알림은 `after()` 비동기 + 멱등 가드, 그리고 **확정 문자 본문이 곧 계약내용 서면**
- **결정**: 접수 응답을 막지 않고 `after()`에서 Solapi 발송. `notifications_log (reservation_id, event)` 유니크 가드로 중복 발송 차단. **확정(confirmed) 문자·메일 본문에 거래조건 블록**(견적 산정 기준·계약금·지급수단/시기·취소환불 4단계·사업자 표시)을 포함한다. 정보성 템플릿과 광고성 템플릿은 파일·enum 수준에서 분리하며 정보성 본문에 프로모션 문구를 한 줄도 섞지 않는다.
- **대안**: 동기 발송 — 접수 지연·실패가 접수 자체를 실패시킨다. 서면 교부를 별도 PDF로 — 사장님 운영 부담 + 미이행 위험.
- **근거**: 전자상거래법 §13② 후단(공급 전 서면 교부, 위반 §45④4호). 정보통신망법 §50 — 광고성 혼입 시 전체가 광고로 전환된다.

### ADR-6. 도메인 전환 = A 레코드 1줄, 와일드카드 포기, MX 불변
- **결정**: 네임서버는 카페24에 둔다. Vercel에는 apex + www만 등록(와일드카드 포기). 코드 측 준비물은 `next.config.ts`의 쿼리 기반 `redirects()`(`statusCode: 301` 명시), `app/robots.ts`, `app/sitemap.ts`, `metadataBase`, `verification` 메타태그.
- **대안**: 네임서버 이전 — MX·SPF 수동 이설 필요, 롤백 24~48시간, 메일 사망 리스크.
- **근거**: 결정 메모 1-D. `permanent:true`는 308을 반환하고 네이버 크롤러의 308 처리가 미확인이므로 301을 명시한다. 소유확인은 **파일 방식이 아니라 메타태그**(전환 순간 파일 소유확인이 깨진다).

### ADR-7. 사진은 업로드 시점 변환(sharp) + 원본 비공개 버킷
- **결정**: 업로드 서버 액션(Node 런타임)에서 1600/800/400px WebP 3종을 생성해 공개 버킷 `gallery`에 저장하고, 원본은 비공개 버킷 `gallery-original`에 보관. DB `gallery`에는 경로·width·height·bytes만 기록.
- **대안**: (a) 렌더 시 변환(Supabase Image Transformation) — 요금제 종속 + egress 예측 불가. (b) Postgres에 바이너리 — §13.9가 명시적으로 금지.
- **근거**: 스펙 §13.9. width/height를 DB에 갖는 이유는 CLS 방지이며 이것이 Lighthouse 게이트와 직결된다.

### ADR-8. 보존·파기는 컬럼 + 앱 크론 (pg_cron 아님)
- **결정**: `reservations.retention_until`에 산출값을 저장(확정건 5년 / 미확정 접수건 1년, 처리방침에 명시한 값과 동일 상수에서 계산). `app/api/cron/purge/route.ts`를 Vercel Cron이 일 1회 호출하고 `CRON_SECRET` 헤더로 보호. 파기는 하드 삭제 + `notifications_log`의 개인식별 컬럼 마스킹.
- **대안**: pg_cron — 테스트·리뷰·롤백이 어렵고 마이그레이션 밖에서 상태가 생긴다.
- **근거**: PIPA §21①. 보유기간을 고지했으면 그 기간은 적법 보유이므로, **처리방침 문구와 코드 상수를 같은 파일에서 파생**시켜 둘이 어긋날 수 없게 한다(`content/legal/retention.ts`).

---

## 3. 단계별 실행 계획

의존: **0 → L → A → B**, C는 A 이후 B와 병렬, D는 A·C 이후, E는 B·D 이후, F는 전부 이후.
Phase 게이트마다 `npm test` · `npm run build` · `npm run check:pricing` · `bash scripts/check-temp-values.sh` · `bash scripts/check-legal-disclosures.sh`(L5 이후) 전부 실행하고 레저(`.superpowers/sdd/2026-08-15-bestour-implementation-master/progress.md`)에 기록한다.

---

### Phase 0 — 계약 동결 (목업 무관, 지금 즉시 착수 가능)

**목표**: 목업이 어떻게 바뀌어도 코드가 흡수할 수 있는 경계 3개와, 16개 노선을 담을 수 있는 데이터 계약을 만든다.

| ID | 제목 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| P0-1 | 목업 드리프트 게이트 | `docs/superpowers/contracts/mockup-baseline.json`, `scripts/check-mockup-drift.sh`, `.github/workflows/ci.yml` | — | 목업 1바이트 수정 시 스크립트가 파일명·해시 diff를 출력하고 exit 1, 무변경 시 exit 0 (양성·음성 실증) | 오탐으로 CI가 상시 빨강 → **CI에서는 경고 잡(continue-on-error)으로 두고 Phase 게이트에서만 차단** |
| P0-2 | 2계층 토큰 + 팔레트 교체 지점 단일화 | `styles/tokens.css`(원시, 목업 미러), `styles/semantic.css`(신설), `scripts/sync-tokens.mjs` | — | `sync-tokens` 가 목업 `:root`와 `tokens.css` 불일치를 리포트(자동 덮어쓰기 금지). `semantic.css`의 `--brand-main` 한 줄만 바꿔 전 페이지 색이 바뀌는 것을 데모 페이지로 실증 | 의미 토큰 이름을 잘못 나누면 재작업 → 목업 섹션 단위로만 이름을 짓는다 |
| P0-3 | 카피 단일 소스 + verbatim 게이트 | `messages/ko.json`, `messages/en.json`, `lib/copy.ts`, `scripts/check-verbatim.sh` | — | verbatim 2문구가 `messages/ko.json`에 **바이트 단위 일치**로 존재, 1글자 변형 시 스크립트 exit 1. BM 금지어(`나가는 버스|태우고 나가|공차|회송`) 0건 | 영문 카피에서 금지어가 의역으로 되살아남 → EN도 금지어 목록 별도 유지 |
| P0-4 | 도시 단위 장소 카탈로그 | `lib/places.ts`, `lib/map-coords.ts`(확장), `tests/places.test.ts` | — | 16개 노선의 출발·도착 코드가 전부 카탈로그에 존재, 좌표가 viewBox(524×560) 내부, 기존 42개 테스트 무회귀, `RegionCode ⊂ PlaceCode` 타입 증명 | 도시 좌표 창작 → 위경도는 공개 좌표를 쓰되 **출처를 주석에 남기고** 변환식은 기존 실적합식 재사용 |
| P0-5 | 마이그레이션 0003 (places + showcase 전환 + 16노선 시드) | `supabase/migrations/0003_places_catalog.sql`, `tests/schema.test.ts` | P0-4 | 로컬 스택 `db reset` 후 `places` N행, `showcase_routes` 16행, ICN→SEL만 `highlight=true`, 가격은 스펙 §13.2 실값, FK 위반 삽입이 거부됨 | 0001 수정 유혹 → **0001은 절대 수정하지 않는다**(원격에 이미 적용됨) |

**통과 게이트**: 위 5개 태스크 리뷰 승인 + `npm test` green + `db-test` 잡 green + 레저 기록.
**지금 배포하면 동작하는 것**: 아직 화면 없음. 단, DB가 16개 확정 노선을 보유하고 토큰·카피 계약이 고정되어 **UIUX 세션의 목업 변경이 코드 재작업을 유발하지 않는 상태**가 된다.

---

### Phase L — 법정 표시 골격 (오픈 블로커 6종을 먼저 없앤다)

**목표**: 결정 메모 P1 #5~#13, #18을 코드로 닫는다. 히어로·지도와 완전히 독립이므로 목업 변경의 영향을 받지 않는다.

| ID | 제목 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| L1 | 마이그레이션 0002 — 동의·보존 기록 | `supabase/migrations/0002_consent_and_retention.sql`, `lib/types.ts`, `tests/schema.test.ts` | P0-5 | `privacy_consent_at`, `privacy_policy_version`, `terms_version`, `marketing_consent_at`, `marketing_consent_source`, `retention_until` 6컬럼 생성 + `retention_until` 인덱스. 동의 없는 insert가 실패하는 것을 테스트로 증명 | 컬럼만 만들고 채우지 않음 → A2에서 서버 스탬프를 필수화하고 NOT NULL 제약을 A2 완료 후 0002b로 승격 |
| L2 | 법정 문서 콘텐츠 모듈 | `content/legal/privacy.ts`, `terms.ts`, `guide.ts`, `retention.ts`, `versions.ts`, `tests/legal-content.test.ts` | — | 필수 섹션 존재 테스트: 처리목적·항목·보유기간·거부권/불이익, 위탁 5사 **실명**, 국외이전 5항목 + **이전 근거(§28조의8① 몇 호인지)**, 보호책임자(조선영/010-2047-8585), 만 14세 미만 안내, 소비자 불만·분쟁처리 안내, 취소·환불 4단계(**계약금 기준·기준시점=운행 출발 시각** 명시) | 문구 창작 → 사실 주장(수치·기간)은 사장님 확정값만 사용하고 미확정은 `[TEMP]`가 아니라 **오픈 차단 항목**으로 등록(§7) |
| L3 | 법정 라우트 3종 | `app/[locale]/privacy/page.tsx`, `app/[locale]/terms/page.tsx`, `app/[locale]/guide/page.tsx` | L2, B1의 라우팅 골격 일부 선취 | 3개 URL이 200, 본문이 `content/legal`에서만 렌더, 375px 가로 스크롤 0, 콘솔 에러 0 | i18n 라우팅 확정 전 선행 → `app/[locale]` 구조를 L3에서 확정하고 B1은 그 위에 올린다 |
| L4 | 법정 표시 컴포넌트 3종 | `components/legal/LegalFooter.tsx`, `components/legal/ConsentNotice.tsx`, `components/legal/PricingBasisNotice.tsx` | L2, P0-2, P0-3 | 푸터에 호스팅사업자 상호(Vercel Inc.)·**공정위 사업자정보 공개페이지 링크**·신고 확인 기관 표기·운영사/관계사 배지 존재. `PricingBasisNotice`가 verbatim 문구 **아래** 별도 블록으로 산정 기준·지급수단/시기를 렌더. `ConsentNotice`에 `defaultChecked`/`checked` 속성이 존재하지 않음 | 사전선택 체크박스 부활 → L5 게이트가 grep으로 차단 |
| L5 | 법정 표시 회귀 게이트 | `scripts/check-legal-disclosures.sh`, `.github/workflows/ci.yml`, `CLAUDE.md`(§6 표 1줄) | L3, L4 | 의도적 위반(푸터 링크 삭제, `defaultChecked` 추가, verbatim 변형) 3종을 각각 넣어 exit 1 실증, 정상 상태 exit 0 | 게이트가 문구 존재만 보고 위치를 못 봄 → 렌더된 HTML 대상 테스트(`tests/legal-render.test.tsx`)를 함께 둔다 |

**통과 게이트**: `/privacy`·`/terms`·`/guide` 3개가 프리뷰에서 열리고, `check-legal-disclosures.sh` green, P1 #7·#8·#9·#11·#12·#13·#18이 레저에서 닫힘.
**지금 배포하면 동작하는 것**: 법정 표시 3페이지 + 푸터. 접수 기능은 없지만 **"통신판매업자 표시의무를 갖춘 정적 사이트"**로서는 이미 합법적으로 공개 가능한 상태.

---

### Phase A — 접수 파이프라인 (가격 없음)

**목표**: 위저드 UI 없이도 접수가 끝까지 도는 서버 경로를 완성한다.

| ID | 제목 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| A1 | 방어 유틸 3종 | `lib/rate-limit.ts`, `lib/turnstile.ts`, `lib/public-code.ts`, `tests/*.test.ts` | — | RL 초과 시 거부, Turnstile 실패 토큰 거부(네트워크 mock), public_code 충돌 재시도 | Upstash 미설정 환경에서 전량 통과되어 무방비 → **env 없으면 fail-closed**(개발 모드만 우회, 우회 시 콘솔 경고) |
| A2 | `createReservation` | `actions/reservations.ts`, `lib/types.ts`, `tests/create-reservation.test.ts` | A1, L1, P0-5 | 순서 실증: 허니팟 → Turnstile → RL → zod → **동의 스탬프** → KST 해석 → insert → `after()` no-op. 역순 날짜·상한·봇·허니팟·정책버전 불일치(재동의 요구) 6케이스 통과 | 동의 스탬프 누락 → 테스트가 컬럼 6개 값을 직접 assert |
| A3 | `lookupReservations` (예약확인) | `actions/reservations.ts`, `lib/mask.ts` | A1 | 이름+전화 일치 건만 반환, 마스킹 적용, 조회 자체에도 RL 적용, 타인 건 0건 반환 | 열거 공격 → 실패 응답을 성공/실패 구분 없이 동일 형태·동일 지연으로 반환 |
| A4 | 접수 현황 피드 (실집계) | `app/api/live-feed/route.ts`, `tests/live-feed.test.ts` | A2 | `reservations` **실집계**만 반환(하드코딩 가명 배열 0건), 마스킹, 60초 캐시. 0건일 때 섹션이 숨겨지는 폴백 | 초기 0건이라 화면이 빈다 → 0건 폴백은 "숫자 없이 안내 문구"(수치 창작 금지) |
| A5 | 입력 계약 확장 | `lib/types.ts`, `tests/schema.test.ts` | L1 | `privacyConsent: z.literal(true)`, `privacyPolicyVersion`, `wantsEmailQuote`(C4 결과에 따라 기본 false), 도시 코드 enum을 `PlaceCode`로 확대 | REGIONS 하드코딩 잔존 → grep 테스트로 `z.enum(REGIONS)` 사용처 전수 확인 |

**통과 게이트**: 프리뷰에서 폼 없이 액션 직접 호출 E2E로 DB 행 + public_code 생성, `db-test` 잡 green, 가격 금지 심볼 0.
**지금 배포하면 동작하는 것**: 법정 3페이지 + 서버 접수 경로(수동 호출). 아직 방문자용 폼은 없다.

---

### Phase B — 공개 사이트 (목업 흡수)

**목표**: v8.1·wizard-b를 3경계를 통해 코드로 흡수한다. **이 Phase만이 목업 변경의 영향을 받는다.**

| ID | 제목 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| B1 | 레이아웃·i18n 라우팅·헤더·푸터 | `app/[locale]/layout.tsx`, `middleware.ts`, `i18n/request.ts`, `components/site/Header.tsx`, `Footer.tsx` | L3, L4, P0-2 | KO 무프리픽스 / `/en` 동작, `/api`·`/admin`·정적자산이 로케일 리다이렉트에 걸리지 않음, 헤더 로고 **bestour 단독**, 푸터는 L4 컴포넌트 재사용 | 미들웨어 matcher 회귀로 admin이 다시 노출/차단 → matcher 테스트를 별도 작성 |
| B2 | KrMap 컴포넌트 (가변 N노선 + 라벨 충돌 회피) | `components/map/KrMap.tsx`, `lib/map-coords.ts` | P0-4, P0-5 | 16노선 입력 시 라벨 겹침 0(결정적 알고리즘: highlight → sort 우선, 상한 초과분은 핀만), DB 조회 실패 시 코드 소유 카탈로그로 핀·곡선 유지, 인라인 SVG(외부 요청 0), 375px 가로 스크롤 0 | 라벨 정책이 UIUX 결정 사안 → 코드는 **상한 N을 prop으로** 받고 기본값만 정한다(§6 요청 목록) |
| B3 | 홈 페이지 섹션 조립 | `app/[locale]/page.tsx`, `components/home/*.tsx` | B1, B2, A4 | 목업 대조 스크린샷 동일(1280/375), verbatim Top-5 고지 문구 렌더, 가격 라벨 숨김 폴백 동작, 실증 불가 수치 0건 | 목업 갱신과 충돌 → `mockup-map.md` 기준으로만 대조, 드리프트는 별도 흡수 태스크 |
| B4 | 견적 위저드 6단계 | `components/wizard/*.tsx`, `app/[locale]/quote/page.tsx` | A2, A5, L4 | 6단계 진행·뒤로가기·다중 경유지·전화 검증·Turnstile·허니팟·`ConsentNotice` 노출·완료 verbatim 문구. 375px 가로 스크롤 0, 콘솔 0 | "이메일로 견적 받기" 옵션이 C4 미완인 채 노출 → **C4 완료 전에는 옵션 자체를 렌더하지 않는다**(플래그 기본 false) |
| B5 | 서브페이지 5종 | `app/[locale]/about/`, `vehicles/`, `gallery/`, `notice/`, `lookup/` | B1, A3 | 6개 메뉴 전부 도달 가능, 기존 기능 삭제 0, 차량 5종 원문 유지 | 차량운임료 메뉴 처리 미확정 → 상담 안내로 보내고 요금 페이지를 만들지 않는다 |
| B6 | 팝업 모달 | `components/site/PopupModal.tsx` | B1 | 기간 내 활성 팝업만 노출, "오늘 하루 보지 않기"(localStorage) 동작, 팝업 0건 시 렌더 없음 | 레이아웃 시프트 → 모달은 클라이언트 마운트 후 표시 |
| B7 | EN 번역 채움 + 하드코딩 카피 제거 | `messages/en.json`, `scripts/check-verbatim.sh`(확장) | B3~B6 | 컴포넌트 내 한글 리터럴 0건(테스트 grep), EN 전환 시 미번역 키 0, EN에도 BM 금지어 0 | 기계 번역으로 법정 문구 왜곡 → 법정 3페이지는 EN에서 "국문이 우선한다" 고지 + 원문 병기 |

**통과 게이트**: `/qa`(SMS 제외판) 통과, Lighthouse 모바일 90+, 콘솔 에러 0, 375px 가로 스크롤 0, `check-mockup-drift` 무드리프트.
**지금 배포하면 동작하는 것**: **방문자가 견적을 접수할 수 있는 완성 사이트**(문자 알림만 없음). 접수는 DB에 쌓이고 admin은 아직 없다.

---

### Phase C — 알림 · 계약내용 서면 교부

| ID | 제목 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| C1 | Solapi 어댑터 | `lib/notify.ts`, `tests/notify.test.ts` | A2 | 전화 정규화(하이픈·국제형), 실패 시 예외를 삼키고 로그, mock 3경로(성공·실패·타임아웃) | 실키로 테스트 발송 → 테스트는 항상 mock, 실발송은 수동 스모크 |
| C2 | created/confirmed 발송 + 멱등 | `actions/reservations.ts`, `actions/admin/reservations.ts`, `supabase/migrations/0006_notification_guard.sql` | C1 | `(reservation_id, event)` 유니크로 중복 발송 0, 실패 시 `notifications_log.status='failed'` 기록, 재시도는 admin 수동 | 사장님 수신번호 미개통(C1 항목) → `OWNER_PHONE` 미설정 시 사장님 발송 skip + 로그 + admin 배너(§7) |
| C3 | 거래조건 서면 본문 | `content/legal/contract-terms.ts`, `lib/notify.ts` | C2, L2 | 확정 문자·메일 본문에 산정 기준·계약금·지급수단/시기·취소환불 4단계·사업자 표시 포함. 광고 문구 0건(테스트 grep) | LMS 길이 초과 → 초과 시 요약 + `/guide` 단축 링크, 링크만으로 갈음하지 않도록 핵심 5항목은 본문 유지 |
| C4 | 이메일 발송 경로 (또는 옵션 폐기) | `lib/mailer.ts`, `app/[locale]/quote/`(플래그) | B4 | 결정 A: 발송 구현 + 3대 포털(naver/daum/gmail) 실측 도달 확인. 결정 B: 옵션 제거하고 `wantsEmailQuote` 삭제 | 도달률 미검증 상태로 약속 → **도달 실측 전에는 결정 B(옵션 미노출)가 기본값** |

**통과 게이트**: 실기기 수신 확인(고객·사장님 각 1건), 중복 발송 0, 실패 로그·재발송 동작.
**지금 배포하면 동작하는 것**: 접수 시 문자 통지까지. 확정 통지는 admin이 없으므로 SQL로만 트리거 가능.

---

### Phase D — 관리자

| ID | 제목 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| D1 | 인증 게이트 (D1 결함 해소) | `middleware.ts`, `app/admin/layout.tsx`, `lib/auth.ts`, `supabase/migrations/0005_admin_auth_policies.sql` | A2 | 비로그인 `/admin/*` → 로그인 리다이렉트, 로그인했으나 `admin_users` 미등록 → 403, service role 호출 전 `requireAdmin()` 통과 실증, 미들웨어 우회(직접 액션 호출) 시에도 차단 | 미들웨어만 믿는 구현 → 리뷰어가 "액션 직접 호출" 테스트를 반드시 실행 |
| D2 | 예약 현황 + 상태 머신 + 감사 로그 | `app/admin/reservations/`, `actions/admin/reservations.ts`, `supabase/migrations/0006_*.sql` | D1, C2 | `new→confirmed→done`, `*→cancelled` 허용, 역방향 거부, 확정 시 문자 1회, 모든 변경이 `admin_audit_log`에 기록 | 확정 중복 클릭 → 낙관적 잠금(`status` 조건부 update) |
| D3 | 대표 노선 관리 (가변 행) | `app/admin/routes/`, `actions/admin/showcase.ts` | D1, P0-5 | 추가·삭제·순서변경·가격 편집, `price_from=null` 저장 시 홈 라벨 숨김, 저장 시 `revalidateTag('showcase')` 로 홈 즉시 반영, 음수·0 거부, 중복 노선 거부 | 사장님이 실수로 전체 삭제 → 0행이면 코드 소유 폴백 카탈로그로 렌더 |
| D4 | 공지·팝업 CRUD | `app/admin/notices/`, `app/admin/popups/`, `actions/admin/content.ts` | D1 | 등록→홈 반영, 기간 밖 팝업 미노출, XSS 방지(본문 plain text 저장·렌더) | 사장님이 HTML 붙여넣기 → 서버에서 태그 제거 |
| D5 | 갤러리 (앨범·다중 업로드·변환) | `supabase/migrations/0004_gallery_albums.sql`, `app/admin/gallery/`, `actions/admin/gallery.ts`, `lib/image.ts` | D1 | 30장 동시 업로드 + 진행률, 20MB 상한, jpg/png/heic/webp 허용, 1600/800/400 WebP 생성, 원본 비공개 버킷, `width/height/bytes/album_id` 기록, 공개 갤러리 페이지네이션 | HEIC 변환 실패 → 실패 파일만 건너뛰고 목록에 사유 표시(전체 롤백 금지) |
| D6 | 운영 경보 대시보드 | `app/admin/page.tsx` | D2~D5 | 미설정 env, 발송 실패 건, 남은 `[TEMP]` 항목, Storage 사용량을 한 화면에 표시 | 경보 피로 → 오픈 차단 항목만 빨강, 나머지는 회색 |

**통과 게이트**: 사장님 E2E(로그인→확정→문자→팝업→홈 노출→노선 가격 수정→홈 반영→사진 10장 업로드), 비관리자 차단 실증.
**지금 배포하면 동작하는 것**: **운영 가능한 서비스 전체**. 남은 것은 이관·SEO·컷오버뿐.

---

### Phase E — 이관 · SEO · 운영 자동화

| ID | 제목 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| E1 | 구 URL 리다이렉트 12종 (TDD) | `next.config.ts`, `tests/redirects.test.ts` | B5 | **테스트 선작성**. `has: [{type:'query', key:'bo_table', value:'estimate'}]` 형태로 쿼리 분기, `statusCode: 301` 명시(`permanent` 병용 금지), `?bo_page=intro11`은 **상담 안내로**(요금 페이지 신설 금지), `/bbs/:path*`·`/page/:path*` fallback | 쿼리 미매칭으로 오배송 → 12개 전 URL 목적지를 테스트가 고정 |
| E2 | robots·sitemap·메타 | `app/robots.ts`, `app/sitemap.ts`, `app/[locale]/layout.tsx`, `.env.example` | B7 | sitemap에 KO/EN + hreflang, `metadataBase`, naver/google **메타태그** verification, OG 이미지 | 프리뷰 URL이 sitemap에 박힘 → `NEXT_PUBLIC_SITE_URL` 기반 생성 + 프리뷰는 `noindex` |
| E3 | 레거시 콘텐츠 적재 | `scripts/import-legacy.mjs`, `docs/runbooks/content-migration.md` | D4, D5 | 공지·갤러리만 적재, **견적 게시판(개인정보) 제외**, 구주소 `동국로 99-19`·타사 정보(전세버스하나투어·타사 계좌·1566-3027) 0건 grep 통과 | 타사 정보 이식 → 적재 스크립트에 금지어 필터 + 실패 시 중단 |
| E4 | 보존·파기 배치 | `app/api/cron/purge/route.ts`, `vercel.json`, `supabase/migrations/0007_retention.sql`, `tests/purge.test.ts` | L1, L2 | `retention_until` 경과 건 하드 삭제 + 로그 마스킹, `CRON_SECRET` 없는 호출 401, 처리방침 문구와 코드 상수가 같은 파일에서 파생됨을 테스트로 증명 | 대량 삭제 사고 → 배치당 삭제 상한 + 감사 로그 + 드라이런 모드 |
| E5 | 접근성·성능 마감 | 전역 | B7 | Lighthouse 모바일 90+, 대비 검사(POINT `#7B7A7A`를 본문에 사용한 곳 0건), 이미지 width/height 100%, CLS < 0.1 | 브랜드 색 교체와 충돌 → 대비 검사는 `semantic.css` 값 기준으로 자동 실행 |

**통과 게이트**: 리다이렉트 12/12 테스트 green, `check-temp-values.sh` 잔여 항목이 §7 표와 1:1 일치, 파기 배치 드라이런 성공.

---

### Phase F — 컷오버 (도메인 전환)

| ID | 제목 | 파일 | 의존 | 검증 | 리스크 |
|---|---|---|---|---|---|
| F1 | 인증서 사전발급 검증 | `docs/runbooks/cutover.md`, `scripts/verify-cert.sh` | E2 | Vercel Pre-generate SSL → TXT를 카페24 DNS에 등록 → `curl --resolve bestour.co.kr:443:<VercelIP> https://bestour.co.kr` 200 확인 | 와일드카드 CNAME이 `_acme-challenge`를 흡수 → **와일드카드 포기 확정**(ADR-6), 필요 시 해당 레코드 선삭제 |
| F2 | TTL 선하향 + A 교체 + 롤백 런북 | `docs/runbooks/cutover.md` | F1 | D-1에 TTL 60초로 낮추고 기존 TTL(30분) 만료 대기 → A 교체 → 롤백 절차(A를 `183.111.174.56`으로 복원) 문서화. **MX·SPF 무변경 확인 스냅샷** 전후 비교 | 카페24 해지가 앞서 실행되어 메일 사망 → 런북 1행에 "웹호스팅 해지는 DNS·메일 이전 완료 후" 역순 금지 명시, 병행 60일(권장 90일) |
| F3 | 오픈 게이트 전수 점검 | §8 체크리스트 | 전 Phase | 게이트 스크립트 4종 + 체크리스트 전항 통과 후에만 A 레코드 교체 | 게이트 미통과 상태 전환 → 컨트롤러 단독 승인 금지, 레저에 서명 기록 |
| F4 | 오픈 후 계측 | `app/[locale]/layout.tsx`(Analytics), `docs/runbooks/post-launch.md` | F2 | Vercel Analytics 수집, 발송 실패 알림, 3대 포털 메일 도달 실측, 검색엔진 소유확인 재확인 | 전환 직후 소유확인 파일 방식이 깨짐 → 메타태그 방식(E2)으로 이미 회피 |

---

## 4. DB 마이그레이션 목록

**`0001_init.sql`은 원격에 적용 완료 — 절대 수정하지 않는다.**

| 파일 | 바꾸는 것 | 게이트 |
|---|---|---|
| `supabase/migrations/0002_consent_and_retention.sql` | `reservations`에 `privacy_consent_at timestamptz`, `privacy_policy_version text`, `terms_version text`, `marketing_consent_at timestamptz`, `marketing_consent_source text`, `retention_until timestamptz` 추가 + `retention_until` 인덱스. (A2 완료 후 별도 `0002b`로 NOT NULL 승격) | L1 |
| `supabase/migrations/0003_places_catalog.sql` | `places(code pk, name_ko, name_en, kind, lat, lon, sort)` 신설 + REGIONS 17 + 확정 16노선이 요구하는 도시(통영·포항·여수·해남·세종·속초·강릉·태백·홍천·원주 등) 시드. `showcase_routes`의 origin/destination CHECK를 **`places(code)` FK로 교체**, 16개 노선 실값 시드(출처 주석 = 스펙 §13.2), ICN→SEL `highlight=true` | P0-5 |
| `supabase/migrations/0004_gallery_albums.sql` | `gallery_albums(id, slug, title_ko, title_en, sort, active)` 신설. `gallery`에 `album_id`, `width`, `height`, `bytes`, `original_path`, `created_at` 추가 + 인덱스 | D5 |
| `supabase/migrations/0005_admin_auth_policies.sql` | `admin_users(user_id uuid pk references auth.users, email, role, created_at)` 신설. admin 대상 테이블에 관리자 정책 부여, `reservations`·`notifications_log`는 정책 없음(서비스 롤 전용) 유지 | D1 |
| `supabase/migrations/0006_notification_guard_and_audit.sql` | `notifications_log`에 `unique(reservation_id, event)` 부여(중복 발송 차단), `kind text check (kind in ('info','ad')) default 'info'` 추가. `admin_audit_log(id, actor, action, target_table, target_id, before, after, created_at)` 신설 | C2·D2 |
| `supabase/migrations/0007_retention.sql` | 파기 지원 — `retention_until` 부분 인덱스, 파기 대상 조회 뷰, `notifications_log` 마스킹용 함수(앱 크론이 호출) | E4 |

---

## 5. 계약

### 5.1 서버 액션 시그니처

```ts
// actions/reservations.ts   'use server'
type ActionFail =
  | { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> }
  | { ok: false; code: 'stale_policy'; currentVersion: string }   // 정책 버전 불일치 → 재동의
  | { ok: false; code: 'rate_limited' | 'bot' | 'server_error' };

export async function createReservation(input: unknown):
  Promise<{ ok: true; publicCode: string } | ActionFail>;
// 순서 고정: 허니팟 → Turnstile → RateLimit → zod → 정책버전 대조 → 동의 스탬프
//            → KST(Asia/Seoul) 해석 → insert → after(): 문자 발송 → notifications_log
// 가격 필드 없음. estimate 계열 심볼 없음.

export async function lookupReservations(input: {
  name: string; phone: string; turnstileToken: string;
}): Promise<{ ok: true; items: ReservationPublic[] } | ActionFail>;
// 반환 필드는 마스킹 적용. 미일치와 오류의 응답 형태·지연을 동일하게 유지.
```

```ts
// actions/admin/*.ts   'use server' — 모든 함수 첫 줄은 await requireAdmin()
setReservationStatus(id: string, next: 'confirmed'|'done'|'cancelled', memo?: string)
resendNotification(reservationId: string, event: 'created'|'confirmed')
upsertShowcaseRoute(input: { id?: number; originCode: PlaceCode; destinationCode: PlaceCode;
                             priceFrom: number | null; highlight: boolean })   // null = 라벨 숨김
deleteShowcaseRoute(id: number)
reorderShowcaseRoutes(ids: number[])          // 성공 시 revalidateTag('showcase')
upsertNotice / deleteNotice / upsertPopup / deletePopup
createAlbum / uploadGalleryImages(files, albumId) / reorderGallery / moveToAlbum / deleteGalleryImage
```

```ts
// 공개 읽기
getShowcaseRoutes(): Promise<ShowcaseRoute[]>   // order by sort, 60s 캐시, tag 'showcase'
                                                // DB 실패 시 lib/places.ts 폴백 카탈로그 반환
```

### 5.2 라우트

| 경로 | 종류 | 비고 |
|---|---|---|
| `/`, `/en` | 페이지 | 홈(지도 히어로 + Top-N 예시 견적) |
| `/quote` `/en/quote` | 페이지 | 무가격 위저드 6단계 |
| `/about` `/vehicles` `/gallery` `/notice` `/lookup` | 페이지 | 서브 5종 (+`/en/*`) |
| `/privacy` `/terms` `/guide` | 페이지 | **법정 표시 3종** (+`/en/*`, 국문 우선 고지) |
| `/admin`, `/admin/reservations|routes|notices|popups|gallery` | 페이지 | 한국어 전용, 인증 필수 |
| `/api/live-feed` | Route Handler | 마스킹 실집계, 60초 캐시 |
| `/api/cron/purge` | Route Handler | `CRON_SECRET` 헤더 필수, Vercel Cron 일 1회 |

### 5.3 컴포넌트 props 경계 (목업 변경 흡수 지점)

```ts
<KrMap routes={ShowcaseRoute[]} places={PlaceCatalog} maxLabels={number} highlightCode?={string} />
   // 좌표·곡선·라벨 배치는 전부 lib/map-coords.ts. 컴포넌트는 색·크기만 토큰에서 읽는다.
<PricingBasisNotice verbatim={string} basis={string[]} payment={PaymentTerms | null} />
   // payment=null 이면 블록 자체를 렌더하지 않고 빌드 경고 → 오픈 게이트에서 차단
<ConsentNotice policyVersion={string} items={ConsentItem[]} />   // defaultChecked 금지(게이트)
<LegalFooter company={CompanyInfo} affiliate={CompanyInfo} hosting={string} ftcUrl={string} />
<WizardStep index={1..6} value={Partial<ReservationInput>} onChange onNext onPrev />
```

**규칙**: 컴포넌트는 `messages/*`와 `styles/semantic.css` 밖의 문자열·색상을 갖지 않는다. 이것이 목업 변경 흡수의 전제다.

---

## 6. UIUX 세션과의 병행 규약

### 6.1 파일 소유권

| 소유 | 경로 |
|---|---|
| **UIUX 세션** | `mockups/**` (variant-08-map-hero.html · wizard-b.html · admin.html · soul.md · assets) |
| **구현 세션(이 계획)** | `app/ lib/ components/ actions/ content/ messages/ styles/ supabase/ tests/ scripts/ i18n/ .claude/ CLAUDE.md next.config.ts middleware.ts vercel.json docs/superpowers/** docs/runbooks/**` |
| **공유(읽기 전용, 동기화 금지)** | `public/brand/` ↔ `mockups/assets/brand/` — 동일 파일 사본. 변경은 컨트롤러가 양쪽에 동시 반영 |
| **아카이브(훅 차단)** | `mockups/variant-07-final.html`, `mockups/wizard.html`, `variant-01~06` |

### 6.2 목업 → 코드 반영 절차

1. UIUX 세션이 목업을 커밋한다.
2. `bash scripts/check-mockup-drift.sh`가 `docs/superpowers/contracts/mockup-baseline.json`의 해시와 비교해 **변경 파일 목록**을 출력한다.
3. 컨트롤러가 diff를 읽고 변경을 3분류한다:
   - **토큰 변경**(`:root` 값) → `scripts/sync-tokens.mjs` 리포트를 보고 `styles/tokens.css`만 갱신. `semantic.css` 매핑은 필요 시 1줄 수정. 컴포넌트 무수정.
   - **카피 변경** → `messages/{ko,en}.json` 키만 갱신. verbatim 2문구는 `check-verbatim.sh`가 변형을 거부한다.
   - **구조 변경**(섹션 추가·삭제·순서) → `mockup-map.md`를 갱신하고 **흡수 태스크 1개**를 SDD 브리프로 발행. 이때만 컴포넌트를 만진다.
4. 흡수 완료 후 `mockup-baseline.json`을 새 해시로 갱신(컨트롤러만 수행).

### 6.3 UIUX 세션에 요청할 결정 (코드가 기다리는 것)

| 요청 | 왜 필요한가 | 코드 측 기본값 |
|---|---|---|
| 16개 노선 지도 표시 방식 (라벨 상한·겹침 정책) | 스펙 §13.2가 "별도 설계"로 남겨둠 | `maxLabels=6`, 초과분 핀만 + 하단 카드 리스트 |
| 팔레트 교체 여부·매핑 (`#3B1F5C` → `#6F1C7C` 계열) | CLAUDE.md §4 고정값과 실측 브랜드 색이 충돌 | `semantic.css`에 두 세트를 두고 기본은 **현행 유지**(사장님 승인 전 교체 금지) |
| POINT `#7B7A7A`의 본문 대체색 | AA 4.5:1 미달 | 보더/아이콘 전용 토큰과 본문 보조 토큰 분리 |
| 접수 현황 0건일 때 섹션 표시 방식 | 수치 창작 금지 | 섹션 숨김 |

---

## 7. 사장님 미회신 항목의 `[TEMP]` 폴백 설계

**원칙 2가지**: ① 값을 지어내지 않는다. ② **법정 표시 항목은 폴백을 만들지 않는다** — 폴백 문구가 곧 위반이 되므로, 미수령이면 오픈을 막는다.

| 미회신 항목 | 분류 | 폴백 | 마커 위치 | 오픈 차단? |
|---|---|---|---|---|
| **지급수단·시기 상세** | 법정(§13②3호) | 없음. `PricingBasisNotice`의 `payment=null` → 블록 미렌더 + 빌드 경고 | `content/legal/guide.ts` `[TEMP]` | **차단** |
| **접수 문자 수신번호(C1 미개통)** | 운영 | `OWNER_PHONE` 미설정 시 사장님 발송 skip + `notifications_log`에 `failed(reason=no_owner_phone)` 기록, 고객 발송은 정상, admin 배너 경고 | `lib/notify.ts` `[TEMP]` | 차단 안 함(경고) |
| **발신번호 등록 서류** | 운영 | Solapi 미인증 시 전체 발송 no-op + 로그. 접수·admin은 정상 | `lib/notify.ts` | 차단 안 함 |
| 회사 소개 카피(H2 인사말) | 콘텐츠 | 섹션 자체를 렌더하지 않는다(빈 제목 노출 금지) | `messages/ko.json` `[TEMP]` | 차단 안 함 |
| 차량 소개 글(H4) | 콘텐츠 | 기존 사이트 원문 유지(신규 창작 금지) | `messages/ko.json` | 차단 안 함 |
| 갤러리 사진 원본 | 콘텐츠 | 갤러리 프리뷰 섹션 숨김, `/gallery`는 "준비 중" 안내 | `app/[locale]/gallery/` | 차단 안 함 |
| **누적 운행 건수·지역 수** | 실증 | **기본안 = 표기하지 않음.** 스탯 블록은 문서로 실증되는 값만(2013년 개업 / 신고번호 / 상담 시간) | 없음(창작 금지 대상) | 표기 시 **차단** |
| 카카오 채널·네이버 톡톡 URL | 운영 | 버튼 미렌더(“준비 중” 버튼도 만들지 않는다) | `messages/ko.json` | 차단 안 함 |
| 가비아·카페24 로그인 | 인프라 | 코드 영향 없음. Phase F만 대기 | `docs/runbooks/cutover.md` | **F 차단** |
| 통신판매업 신고증 원본 | 법정 | 신고번호 표기는 유지(기존 사이트 표기 근거). 신고 존재 자체 미확인은 리스크로 기록 | `content/legal/terms.ts` | 차단 안 함(리스크) |
| 전세버스 등록 실체 | 표시 | **"면허 보유" 표기 전면 삭제** → "전세버스운송사업 등록업체". 등록 실체 미확인 시 이 표기도 보류 | `messages/ko.json` | 표기 시 **차단** |

`scripts/check-temp-values.sh`에 실증 문구 grep(`4,800`, `4800`, `누적 견적`, `누적 운행`, `개 시도`, `업계 1위`, `국내 최대`, `최다`, `최저가 보장`, `면허 보유`)을 추가하고, **오픈 차단 항목은 exit 1**로 승격한다(현재는 항상 exit 0).

---

## 8. 오픈 게이트 체크리스트 (전항 통과해야 A 레코드를 바꾼다)

**자동 게이트 (CI + 로컬 실행)**
- [ ] `npm test` — DB 스모크 포함, skip 0건 (`REQUIRE_DB_TESTS=1`)
- [ ] `npm run build` 성공
- [ ] `bash scripts/check-no-pricing.sh` — 금지 심볼 0
- [ ] `bash scripts/check-legal-disclosures.sh` — 법정 표시 전항 통과
- [ ] `bash scripts/check-verbatim.sh` — verbatim 2문구 바이트 일치, BM 금지어 0(KO·EN)
- [ ] `bash scripts/check-temp-values.sh` — **오픈 차단 항목 0건**, 잔여 `[TEMP]`가 §7 표와 1:1 일치
- [ ] `bash scripts/check-mockup-drift.sh` — 미흡수 드리프트 0
- [ ] `tests/redirects.test.ts` — 12/12 목적지 일치

**법정 표시**
- [ ] `/privacy`·`/terms`·`/guide` 200, 전 페이지 푸터에서 링크
- [ ] 푸터: 호스팅사업자(Vercel Inc.) · **공정위 사업자정보 공개페이지 링크** · 신고 확인 기관 · 운영사/관계사 배지 · 입금계좌 KB국민은행 단독
- [ ] 견적 산정 기준 + **지급수단·시기** 표시(verbatim 문구 아래 별도 블록)
- [ ] 취소·환불 4단계 게시(계약금 기준 · 기준시점 = 운행 출발 시각 명시)
- [ ] 위저드에 4대 고지 노출, 사전선택 체크박스 0
- [ ] 위탁 5사 실명 공개 + 국외이전 5항목 + **이전 근거** 병기
- [ ] 만 14세 미만 안내 · 소비자 불만/분쟁처리 안내
- [ ] **확정 문자·메일 본문에 거래조건 서면 포함**(§13② 후단)
- [ ] 주소 = 동국로 107(식사동), 구주소 `99-19` 0건
- [ ] "면허" 표기 0건, 실증 불가 수치 0건, 타사 정보(전세버스하나투어·타사 계좌·1566-3027) 0건

**기능·품질**
- [ ] 접수 E2E: 위저드 → DB 행 + public_code → 고객·사장님 문자 수신
- [ ] admin: 비로그인 차단, 확정 → 문자 1회(중복 0), 노선 가격 수정 → 홈 즉시 반영
- [ ] 375px 가로 스크롤 0 · 콘솔 에러 0 (홈·위저드·admin·법정 3종)
- [ ] Lighthouse 모바일 90+ · CLS < 0.1
- [ ] 파기 배치 드라이런 성공, `CRON_SECRET` 없는 호출 401

**인프라 (컷오버 직전)**
- [ ] 그누보드 DB + DATA 백업 완료, 사장님 PC 보관 위치 기록 (카페24 자동백업은 7일만 보관)
- [ ] 기존 견적 게시판 개인정보 노출 재확인(사장님 확인 완료 — 재확인만)
- [ ] 인증서 사전발급 후 `curl --resolve` 200
- [ ] TTL 60초 선하향 + 기존 TTL 만료 대기 완료
- [ ] MX·SPF 전후 스냅샷 동일(불변 확인)
- [ ] 롤백 절차 문서화(A → `183.111.174.56`)
- [ ] **카페24 웹호스팅 해지는 하지 않는다** — 병행 최소 60일(권장 90일)
- [ ] ⚠️ **도메인 만료 2026-10-05 (가비아)** — 사장님 갱신 확인. 미갱신 시 홈페이지·메일 동시 정지

**오픈 후 D+15**
- [ ] 통신판매업 변경신고(호스트서버 소재지) — 신고 존재 확인 선행

---

## 9. 이 계획의 알려진 약점

1. **3개 초안·3인 심사 원문을 읽지 못했다.** 합성 규칙과 1차 사료로 재구성했으므로, 심사가 지적한 결함 중 **코드·문서에서 재현되지 않는 항목은 이 계획에 반영되지 않았을 수 있다.** 컨트롤러는 심사 원문의 지적 목록과 §0.3 표를 대조해 누락을 확인해야 한다.
2. **법정 판단은 변호사 검토가 아니다.** 특히 §13②3호("상담 시 안내"가 위반인지)는 공정위 심결례를 확인하지 못한 **조문 해석**이다. 계획은 안전한 쪽(정적 표시)을 택했으나, 지급수단·시기 미수령으로 오픈이 막히는 비용이 실제 리스크보다 클 수 있다.
3. **Phase L을 앞으로 당긴 대가**로, 법정 3페이지가 푸터·타이포 등 목업 확정 전에 만들어진다. 목업이 크게 바뀌면 L3·L4는 재작업 대상이다(카피·토큰 경계로 완충하지만 레이아웃까지 흡수하지는 못한다).
4. **16개 노선의 지도 표현 방식이 미확정**이라 B2는 기본값으로 구현된다. UIUX 결정이 늦으면 B2는 두 번 만들어질 수 있다.
5. **팔레트가 두 세트로 유지된다.** 사장님 승인이 오래 걸리면 `semantic.css`에 죽은 토큰 세트가 남고, 목업(구 팔레트)과 브랜드 가이드(신 팔레트) 사이의 인지 부하가 계속된다.
6. **`0002`의 NOT NULL 승격을 뒤로 미뤘다.** A2 완료 전까지는 동의 없는 행이 물리적으로 삽입 가능하다(코드 경로로만 막힌다). 승격 태스크(`0002b`)를 잊으면 구멍이 남는다.
7. **메일 도달률을 실측하지 못한 상태에서 C4의 기본 결정이 "옵션 미노출"**이다. 사장님이 "이메일 견적"을 요구하면 Phase C가 늘어난다.
8. **파기 배치가 Vercel Cron에 의존**한다. Hobby 플랜의 크론 제약(빈도·개수)을 확인하지 못했다 — Pro 전환이 전제일 수 있다.
9. **`check-mockup-drift`를 차단이 아닌 경고로 둔 것**은 의도적 타협이다. 병행 세션이 목업을 자주 바꾸는 동안 CI를 상시 빨강으로 만들지 않기 위함이지만, 그만큼 드리프트가 누적된 채 Phase 게이트까지 갈 수 있다.
10. **도메인 만료(2026-10-05, 29일 남음)가 이 계획의 통제 밖**이다. 사장님이 갱신을 잊으면 위 전 계획이 무의미해진다 — 게이트에 넣었으나 강제할 수단이 없다.