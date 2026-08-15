# 베스트투어 실구현 마스터 플랜 (v2 — 2026-08-15 eng review + Codex 아웃사이드 보이스 반영)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 이 문서는 **마스터 플랜**이다: 공유 아키텍처·DB 스키마·계약 + **Phase A의 상세 태스크**. Phase B~E는 범위·수용 기준까지 정의되어 있고 착수 시 별도 상세 플랜으로 확장한다.
> v2 변경: 리뷰 결정 [1A~4A, 5A, 6A] + Codex 수용 15건 + 크로스모델 결정 [T1-A, T2-A, T3-A] 반영. 상세는 문서 말미 GSTACK REVIEW REPORT.

**Goal:** 컨펌된 목업(시안 7 + 위저드 + admin)을 실제 서비스로 구현한다 — 예약 접수·문자 알림·관리자 운영까지.

**Architecture:** Next.js App Router가 프론트를 담당하고, **폼 뮤테이션은 Server Actions**(예약 접수·조회), 캐시 가능한 공개 읽기만 Route Handler(live-feed)로 한다. Supabase가 DB(Postgres)·관리자 인증(@supabase/ssr 쿠키 세션)·이미지 스토리지를 담당한다. 문자/알림톡은 Solapi를 서버에서만 호출하되 **Next.js `after()`로 응답 후 발송**한다. 가격 계산은 순수 함수 `estimate()` 하나를 전 화면이 공유하고 서버가 항상 재계산한다. 운행 일시는 **한국 현지 시각으로 받아 서버가 Asia/Seoul로 해석**한다(UTC 문자열 금지). 장소·여행구분은 **canonical code**로 저장한다(번역 문자열 저장 금지).

**Tech Stack:** Next.js 15(정확 버전 고정, App Router, TS), Supabase(@supabase/supabase-js v2, @supabase/ssr), next-intl(KO 기본/EN 토글), solapi, zod, @upstash/ratelimit(+@upstash/redis), Cloudflare Turnstile, vitest, CSS Modules + 디자인 토큰(Tailwind 미사용).

**Spec:** docs/superpowers/specs/2026-08-07-bestour-redesign-uiux-design.md (§10·§11 우선) + mockups/soul.md (§10 우선) + 컨펌 목업 3종

## Global Constraints

- 팔레트·레이아웃·카피는 컨펌 목업이 원본. 픽셀 임의 변경 금지. 팔레트: `#3B1F5C` `#7C3AED` `#F3EFFA` `#1A1523` `#FAF9FC` `#D4A843`
- BM 비노출: "나가는 버스", "태우고 나가", "공차", "회송" 등 원가 구조 표현 금지 (한/영 공통, soul.md §10.2)
- 공항 표기: "공항 픽업·샌딩 (송영 전문)" / EN: "Airport Pick-up & Sending"
- 가격 표기: "예상가" 라벨 + "실제 견적은 확정 시 안내" 병기. 결제 기능 없음
- 접수·확정 문구 verbatim: "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다."
- 차량 5종 고정: 45인승 관광버스 / 35인승 관광버스 / 28인승 우등리무진 / 25인승 관광버스 / 16인승 관광버스
- 회사 정보는 soul.md §3 원문 그대로
- 모바일 375px 가로 스크롤 금지, 1280px 대응
- service role key 서버 전용. 모든 공개 뮤테이션 = zod 검증 + Upstash rate limit + Turnstile + 허니팟
- **운행 일시는 KST 벽시계 값**(`"2026-09-01T08:00"` + 서버에서 Asia/Seoul 해석). `Z` 접미 UTC 입력 금지
- **장소/여행구분은 code로 저장** (`ICN`, `SEL`, `GG`...; `airport_pickup`, `family`...). 표시 문자열은 messages/{ko,en}.json에서만
- 모든 커밋 메시지 끝에 트레일러 포함: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (아래 커밋 예시들은 `-m "..."` 뒤에 이 트레일러 줄이 있다고 간주)

## 0. 저장소 구조

```
/                          # 저장소 루트 = Next.js 앱 루트
├─ app/
│  ├─ [locale]/            # ko(기본, 프리픽스 없음) / en
│  │  ├─ page.tsx quote/ company/ vehicles/ gallery/ notice/ reservation-check/
│  ├─ admin/               # locale 밖 (한국어 전용): login/ page.tsx popups/ notices/ gallery/
│  └─ api/live-feed/route.ts   # 유일한 Route Handler (GET 캐시)
├─ actions/                # Server Actions (뮤테이션 전부)
│  ├─ reservations.ts      # createReservation, lookupReservations
│  └─ admin.ts             # updateReservationStatus, resendNotification, popup/notice/gallery CRUD
├─ lib/
│  ├─ pricing.ts codes.ts mask.ts notify.ts kst.ts
│  ├─ rate-limit.ts        # Upstash 래퍼
│  ├─ turnstile.ts         # 토큰 서버 검증
│  └─ supabase/ server.ts(서비스 롤) ssr.ts(쿠키 세션) client.ts(anon)
├─ middleware.ts           # next-intl, matcher: /((?!api|admin|_next|.*\..*).*)
├─ messages/ko.json, en.json
├─ styles/tokens.css
├─ supabase/migrations/0001_init.sql, 0002_admin_policies.sql
├─ tests/
└─ mockups/, docs/         # 기존 그대로 (참조용)
```

## 1. Canonical codes (lib/codes.ts — 전 Phase 공유)

```ts
export const REGIONS = ['ICN','SEL','BSN','INC','DGU','GWJ','DJN','ULS','GG','GW','CN','CB','GB','GN','JN','JB','JJ'] as const; // ICN=인천공항(특수), 나머지 16개 시도
export type RegionCode = typeof REGIONS[number];
export const PURPOSES = ['airport_pickup','family','ceremony','workshop','social','religious','univ_mt','field_trip','foreign_vip','etc'] as const;
export type PurposeCode = typeof PURPOSES[number];
export const isAirport = (c: RegionCode) => c === 'ICN';
```
표시 문자열(한/영)은 `messages/*.json`의 `regions.*`, `purposes.*` 키. DB·가격·통계는 code만 사용.

## 2. DB 스키마 (supabase/migrations/0001_init.sql)

```sql
create type reservation_status as enum ('new','confirmed','done','cancelled');
create type price_state as enum ('estimated','quote_required');

create table vehicles (
  id serial primary key,
  slug text unique not null,
  name_ko text not null, name_en text not null,
  capacity int not null check (capacity between 1 and 60),
  base_price int not null check (base_price > 0),
  sort int not null default 0, active boolean not null default true
);

create table price_rules (
  key text primary key, value numeric not null, description text
);

-- 노선별 실요금표 수령 시 채우는 테이블 (비어 있으면 base_price 폴백)
create table route_prices (
  vehicle_slug text not null references vehicles(slug),
  origin_code text not null, destination_code text not null,
  price int not null check (price > 0),
  primary key (vehicle_slug, origin_code, destination_code)
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  public_code text unique not null,          -- 'BT-250901-4F2K' 고객 노출 접수번호
  created_at timestamptz not null default now(),
  status reservation_status not null default 'new',
  name text not null check (length(name) between 1 and 30),
  phone text not null,                        -- 저장은 숫자만 (하이픈 제거 정규화)
  email text,
  vehicle_slug text not null references vehicles(slug),
  purpose_code text not null,
  origin_code text not null, destination_code text not null,
  waypoint_codes jsonb not null default '[]',
  trip_type text not null check (trip_type in ('round','oneway','oneway_oneway')),
  depart_at timestamptz not null,             -- KST 해석 후 저장
  return_at timestamptz check (return_at is null or return_at > depart_at),
  nights int not null default 0 check (nights >= 0),
  bus_count int not null default 1 check (bus_count between 1 and 20),
  passengers int check (passengers between 1 and 900),
  price_state price_state not null,
  est_price int check ((price_state = 'estimated') = (est_price is not null)),
  price_breakdown jsonb,                      -- 계산 스냅샷 {base, tripMult, nightMult, busCount, ruleVersion}
  contact_method text, payment_method text,
  parking_included boolean, vat_included boolean,
  message text check (message is null or length(message) <= 1000),
  locale text not null default 'ko' check (locale in ('ko','en')),
  confirmed_at timestamptz, admin_memo text,
  check ((trip_type = 'round') = (return_at is not null))
);
create index on reservations (status, created_at desc);

create table notifications_log (
  id bigserial primary key,
  reservation_id uuid references reservations(id),
  event text not null,                        -- 'created' | 'confirmed'
  channel text not null,                      -- 'sms' | 'alimtalk'
  to_phone text not null, template text not null,
  status text not null,                       -- 'sent' | 'failed'
  provider_message_id text, error text,
  created_at timestamptz not null default now()
);
create index on notifications_log (reservation_id, event);

create table popups (
  id serial primary key,
  title text not null, body text not null, image_path text,
  starts_at date not null, ends_at date not null check (ends_at >= starts_at),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table notices (
  id serial primary key, title text not null, body text not null,
  category text not null default 'info',
  published_at date not null default current_date, active boolean not null default true
);
create table gallery (
  id serial primary key, image_path text not null, caption text,
  sort int not null default 0, active boolean not null default true
);

-- RLS: 공개 읽기 최소화, 쓰기는 서비스 롤 전용
alter table reservations enable row level security;
alter table notifications_log enable row level security;
alter table route_prices enable row level security;
create policy route_prices_read on route_prices for select using (true);
alter table vehicles enable row level security;
create policy vehicles_read on vehicles for select using (true);
alter table price_rules enable row level security;
create policy price_read on price_rules for select using (true);
alter table popups enable row level security;
create policy popups_read on popups for select using (active and current_date between starts_at and ends_at);
alter table notices enable row level security;
create policy notices_read on notices for select using (active);
alter table gallery enable row level security;
create policy gallery_read on gallery for select using (true);

-- 시드: 차량 5종 + 배율 (목업 검증값. 실요금표 수령 시 route_prices로 대체)
insert into vehicles (slug,name_ko,name_en,capacity,base_price,sort) values
 ('bus45','45인승 관광버스','45-seat Coach',45,650000,1),
 ('bus35','35인승 관광버스','35-seat Coach',35,550000,2),
 ('limo28','28인승 우등리무진','28-seat Premium Limousine',28,600000,3),
 ('bus25','25인승 관광버스','25-seat Coach',25,480000,4),
 ('bus16','16인승 관광버스','16-seat Minibus',16,400000,5);
insert into price_rules (key,value,description) values
 ('oneway',0.6,'편도 = 당일왕복의 60%'),
 ('overnight',1.8,'1박2일 = 당일왕복의 1.8배'),
 ('oneway_oneway',1.2,'편도·편도 = 편도 x 2');
```

`0002_admin_policies.sql` (Phase D): profiles(role) 없이 **단일 관리자 UUID 화이트리스트** — `create policy popups_admin on popups for all using (auth.uid() = '<사장님 auth user id>'::uuid)` 방식으로 popups/notices/gallery insert/update/delete. `authenticated` 전체 부여 금지.

개인정보: reservations는 운행 종료 후 1년 보존 → 마스킹 삭제 배치(Phase E 문서화, 개인정보처리방침에 명시).

## 3. 계약 (이름·타입 고정 — 전 Phase 공유)

```ts
// lib/types.ts
export const ReservationInput = z.object({
  name: z.string().min(1).max(30),
  phone: z.string().regex(/^01[016789]-?\d{3,4}-?\d{4}$/),            // ko
  phoneIntl: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),        // en 로케일은 국제형식 허용 (둘 중 하나 필수는 refine)
  email: z.string().email().optional(),
  vehicleSlug: z.enum(['bus45','bus35','limo28','bus25','bus16']),
  purposeCode: z.enum(PURPOSES),
  originCode: z.enum(REGIONS), destinationCode: z.enum(REGIONS),
  waypointCodes: z.array(z.enum(REGIONS)).max(5).default([]),
  tripType: z.enum(['round','oneway','oneway_oneway']),
  departAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), // KST 벽시계
  returnAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  busCount: z.number().int().min(1).max(20).default(1),
  passengers: z.number().int().min(1).max(900).optional(),
  contactMethod: z.string().optional(), paymentMethod: z.string().optional(),
  parkingIncluded: z.boolean().optional(), vatIncluded: z.boolean().optional(),
  message: z.string().max(1000).optional(),
  locale: z.enum(['ko','en']).default('ko'),
  turnstileToken: z.string(),
  website: z.string().max(0).optional(),      // 허니팟: 값이 있으면 무시
});

export interface ReservationPublic {          // lookup 반환 최소 필드
  publicCode: string; status: ReservationStatus; vehicleSlug: string;
  originCode: string; destinationCode: string; departAt: string;
  priceState: 'estimated'|'quote_required'; estPrice: number|null;
}
```

```ts
// lib/pricing.ts — 시그니처 (노선 인지 + 별도견적 상태)
export type TripType = 'round'|'oneway'|'oneway_oneway';
export interface PriceConfig {
  basePrices: Record<string, number>;
  rules: { oneway: number; overnight: number; oneway_oneway: number };
  routePrices?: Record<string, number>;       // `${vehicleSlug}:${origin}:${dest}` → 원 (실요금표 수령 후)
}
export interface EstimateInput { vehicleSlug: string; originCode: string; destinationCode: string; tripType: TripType; nights: number; busCount: number }
export type EstimateResult =
  | { kind: 'estimated'; total: number; breakdown: { base: number; tripMult: number; nightMult: number; busCount: number } }
  | { kind: 'quote_required'; reason: 'multi_night' };   // nights >= 2
export function estimate(cfg: PriceConfig, input: EstimateInput): EstimateResult
```

```ts
// actions/reservations.ts — Server Actions
export async function createReservation(input: unknown): Promise<
  | { ok: true; publicCode: string; priceState: 'estimated'|'quote_required'; estPrice: number|null }
  | { ok: false; error: 'validation'|'rate_limited'|'bot_check_failed'; issues?: ZodIssue[] }>
// 순서: 허니팟 → Turnstile 검증(lib/turnstile.ts) → Upstash RL(ip, 5/min) → zod → KST 파싱(lib/kst.ts) → nights 산출 → estimate 재계산 → public_code 생성 → insert → after(() => notifyReservationCreated(r)) → 반환
export async function lookupReservations(input: { name: string; phone: string }): Promise<ReservationPublic[]>
// Upstash RL(ip, 5/min). 불일치 = 빈 배열 (존재 여부 비노출)
```

```ts
// actions/admin.ts — 상태 머신 + 재발송 (Phase D 구현, 계약만 고정)
const ALLOWED: Record<ReservationStatus, ReservationStatus[]> =
  { new: ['confirmed','cancelled'], confirmed: ['done','cancelled'], done: [], cancelled: [] };
export async function updateReservationStatus(id: string, to: ReservationStatus): Promise<...>
// 전이 검증 + confirmed 시 notifications_log에 event='confirmed' 기존 sent 있으면 발송 생략(중복 방지)
export async function resendNotification(reservationId: string, event: 'created'|'confirmed'): Promise<...>
```

`GET /api/live-feed`: `{ name, vehicle, date, sample?: true }[]` 12건, `revalidate = 60`. 실데이터 0건이면 시드 12건에 `sample: true` → UI가 "예시" 라벨 표시 [T1-A]. 접수 폼에 "접수 내역은 이름 마스킹 형태로 실시간 현황에 표시됩니다" 고지 포함.

## 4. 환경 변수

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | DB |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate limit (무료 티어) |
| `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | 봇 방어 (무료) |
| `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SMS_SENDER=15666188`, `OWNER_PHONE=01020488585` | 문자 |
| `NEXT_PUBLIC_KAKAO_CHANNEL_URL`, `NEXT_PUBLIC_NAVER_TALK_URL` | 문의 채널 (미개설 시 "준비 중" 안내) |
| `PRICE_DISPLAY_MODE=estimate\|inquiry` | [T2-A] 런치 게이트: 실요금표 미수령 시 inquiry 모드(숫자 대신 "견적 문의") |

## 5. 사장님 데이터 체크리스트

| 데이터 | 막히는 Phase | 없을 때 |
|---|---|---|
| 노선별 실요금표 + 공항 할인 폭 | **E 도메인 오픈 (전제조건)** [T2-A] | 개발·검수는 더미로, 오픈은 `PRICE_DISPLAY_MODE=inquiry` |
| 창업연도·실적 수치 | B | 임시값 + "확인 필요" 내부 표시 |
| 발신번호 등록 서류 / 사업자등록증+카카오 채널 | C | 발송 스텁(로그만) / SMS만 |
| 카카오 채널·네이버 톡톡 URL | B | "준비 중" 안내 |
| 도메인 관리 계정 (**기존 MX 레코드 목록 포함** — 메일 두절 방지) | E | Vercel 기본 도메인 검수 |
| 갤러리 원본·공지 이관 목록 / 영문 표기 | E / B | 스크랩 6장 / 로마자 초안 |
| **개인정보처리방침 문안 확인** (통신판매업자 법적 필수) | E | 표준 템플릿 초안 → 사장님 검수 |

## 6. Phase 분해

| Phase | 산출물 | 완료 기준 |
|---|---|---|
| **A. 기반** (하단 상세) | 스캐폴드 + 스키마 + 가격 엔진 + 예약/조회 Server Actions + live-feed + 배포 | 프리뷰 URL에서 실제 접수 → DB 저장 + public_code 반환, vitest 전 경로 통과 |
| **B. 공개 사이트** | 목업 3종 이식, KO/EN, 팝업, 피드, 위저드(경유지·다박 별도견적 UX), Turnstile 위젯, 접수 고지문 | 목업 스크린샷 대조 동일, EN 전환, Lighthouse 모바일 90+, next/image 적용, Pretendard 서브셋 self-host |
| **C. 알림** | notify.ts(전화 정규화 포함), created/confirmed 발송, 로그, **admin 재발송**, 중복 발송 가드 | 실기기 수신, 실패 로그·재발송 동작, mock 3경로 테스트 |
| **D. admin** | @supabase/ssr 세션 + 단일 관리자 정책(0002), 예약 현황(상태 머신), 팝업/공지/갤러리 CRUD [T3-A] | 사장님 E2E: 로그인→확정→문자→팝업 등록→홈 노출. 비관리자 계정 차단 확인 |
| **E. 이관·런치** | 콘텐츠 이관, **개인정보처리방침 페이지**, 보존·삭제 정책, SEO/hreflang/OG/sitemap, 도메인 전환(MX 보존+TTL+롤백 계획), 런치 게이트 확인 | bestour.co.kr 서비스 개시. `PRICE_DISPLAY_MODE` 확정. 구 게시판 접수 중단 안내 |

의존: A → B, C는 A 이후 B와 병렬, D는 A·C 이후, E는 전부 이후.

### 데이터 플로우 (ASCII)

```
[방문자] ── 홈 위젯/위저드 ──> createReservation (Server Action)
              │ 허니팟→Turnstile→RateLimit→zod→KST해석→estimate()재계산
              │ insert(reservations, public_code, price_breakdown)
              │ after(): notify(사장님 SMS, 고객 SMS/알림톡) ─> notifications_log
              └─> { publicCode, estPrice | quote_required }
[방문자] ── 예약확인 ──> lookupReservations ──> ReservationPublic[] (마스킹·최소 필드)
[방문자] ── 홈 현황  ──> GET /api/live-feed (60s 캐시, 마스킹, sample 라벨)
[사장님] ── /admin ──> @supabase/ssr 세션 ──> updateReservationStatus (상태 머신)
              └ confirmed: 중복 가드 후 고객 통지 + resendNotification 백업
```

---

## Phase A 상세 태스크 (v2)

### Task A1: 스캐폴드 + 도구 체인

**Files:** Create: `package.json` `tsconfig.json` `next.config.ts` `vitest.config.ts` `middleware.ts` `app/layout.tsx` `styles/tokens.css` `.env.example`

- [ ] **Step 1: 스캐폴드** — 루트가 비어있지 않으므로(mockups/, docs/, README) create-next-app 직접 실행 금지. 임시 폴더에 생성 후 이동:
```bash
npx create-next-app@15 _scaffold --ts --app --no-tailwind --eslint --src-dir=false --import-alias "@/*" --use-npm
# _scaffold의 내용물을 루트로 이동(기존 파일과 충돌 없음 확인: README.md는 기존 것 유지, .gitignore는 병합)
# 버전 고정 확인: package.json의 next가 15.x인지 확인, 아니면 npm i next@15
npm i zod @supabase/supabase-js @supabase/ssr next-intl solapi @upstash/ratelimit @upstash/redis
npm i -D vitest @vitest/coverage-v8
```
- [ ] **Step 2: vitest 설정** — v1과 동일 (`tests/**/*.test.ts`, alias `@`).
- [ ] **Step 3: middleware.ts** — next-intl 미들웨어 + **matcher에서 /api·/admin·정적 파일 제외** [4A]:
```ts
export const config = { matcher: ['/((?!api|admin|_next|.*\\..*).*)'] };
```
- [ ] **Step 4: 토큰 이식 + .env.example(§4 전체 키) + smoke 테스트** → `npm run dev`·`npm test` 통과
- [ ] **Step 5: Commit** — `git commit -m "feat: scaffold Next.js 15 app with i18n middleware and toolchain"` (+트레일러)

### Task A2: Supabase 스키마 + 클라이언트 + 타입

**Files:** Create: `supabase/migrations/0001_init.sql`(§2 전문) `lib/supabase/server.ts` `lib/supabase/ssr.ts` `lib/supabase/client.ts` `lib/types.ts`(§3) `lib/codes.ts`(§1)

- [ ] **Step 1**: Supabase 프로젝트 생성(서울 리전, 사용자 수행) → 키 3개 `.env.local`
- [ ] **Step 2**: §2 SQL 저장 + 실행. §1 codes.ts, §3 types.ts 작성
- [ ] **Step 3**: 클라이언트 3종 — server.ts(서비스 롤), ssr.ts(@supabase/ssr `createServerClient` 쿠키 연동 — Phase D admin용 기반), client.ts(anon)
- [ ] **Step 4**: 스모크 테스트 — vehicles 5행, `bus45=650000`, CHECK 제약 위반 insert가 실제로 거부되는지 1건 (`bus_count=21` → error). 환경변수 없으면 skip하되 **CI에서는 실행**(A7에서 Supabase 프로젝트의 CI용 스키마 또는 `supabase start` 로컬 스택 연결 — "전부 skip = 통과" 금지)
- [ ] **Step 5: Commit**

### Task A3: 가격 엔진 (TDD, 노선 인지 + 별도견적)

**Files:** Create: `lib/pricing.ts`, Test: `tests/pricing.test.ts`

- [ ] **Step 1: 실패 테스트** — 목업 확정 기대값 + 신규 계약:
```ts
const cfg: PriceConfig = { basePrices: { bus45: 650000, bus35: 550000, limo28: 600000, bus25: 480000, bus16: 400000 },
  rules: { oneway: 0.6, overnight: 1.8, oneway_oneway: 1.2 } };
const base = { originCode: 'SEL', destinationCode: 'GW', busCount: 1 };
it('당일왕복 45인승 = 650,000', () => expect(estimate(cfg, { ...base, vehicleSlug: 'bus45', tripType: 'round', nights: 0 }))
  .toEqual({ kind: 'estimated', total: 650000, breakdown: { base: 650000, tripMult: 1, nightMult: 1, busCount: 1 } }));
it('편도 60% = 390,000', ...);            // total 390000
it('1박2일 1.8배 = 1,170,000', ...);      // nights: 1
it('편도·편도 1.2배 = 780,000', ...);
it('16인승 2대 = 800,000', ...);
it('2박 이상 → quote_required', () => expect(estimate(cfg, { ...base, vehicleSlug: 'bus45', tripType: 'round', nights: 2 }))
  .toEqual({ kind: 'quote_required', reason: 'multi_night' }));   // [5A]
it('노선 요금표 우선', () => expect(estimate({ ...cfg, routePrices: { 'bus45:ICN:SEL': 490000 } },
  { ...base, originCode: 'ICN', destinationCode: 'SEL', vehicleSlug: 'bus45', tripType: 'round', nights: 0 }).total).toBe(490000));
it('미지 차량 throw', ...);
```
- [ ] **Step 2: FAIL 확인 → Step 3: 구현** — routePrices `${slug}:${o}:${d}` 조회(왕복은 역방향도 조회) → 없으면 basePrices 폴백. nights≥2 → quote_required. breakdown 포함 반환.
- [ ] **Step 4: PASS → Step 5: Commit**

### Task A4: KST 유틸 + 마스킹 (TDD)

**Files:** Create: `lib/kst.ts` `lib/mask.ts`, Test: `tests/kst.test.ts` `tests/mask.test.ts`

- [ ] **Step 1: 테스트** — kst: `parseKst('2026-09-01T08:00')`이 UTC `2026-08-31T23:00:00Z` timestamptz로 변환(Asia/Seoul 고정, 서버 TZ 무관), `nightsBetween('2026-09-01T08:00','2026-09-01T20:00')===0`, `…'09-02…'===1`, `…'09-04…'===3`, 역순이면 throw. mask: v1 4종 + `maskPhone('01012345678')`(하이픈 없는 입력) + 패턴 불일치 입력은 원문 대신 `***` 반환
- [ ] **Step 2~4: FAIL→구현→PASS** — kst는 `Date.UTC(y,m,d,h-9,min)` 고정 오프셋(한국은 DST 없음) + 주석으로 근거 명시
- [ ] **Step 5: Commit**

### Task A5: createReservation Server Action (TDD)

**Files:** Create: `actions/reservations.ts` `lib/rate-limit.ts` `lib/turnstile.ts` `lib/public-code.ts`, Test: `tests/create-reservation.test.ts`

**Interfaces:** Consumes A2~A4 전부. Produces §3 계약. **est_price는 서버 재계산만 신뢰.**

- [ ] **Step 1: 유틸** — rate-limit.ts: `@upstash/ratelimit` slidingWindow(5, '1 m'), env 없으면 dev에서 통과+경고 로그 [2A]. turnstile.ts: siteverify POST, 실패 시 `bot_check_failed` [2A]. public-code.ts: `BT-YYMMDD-` + 4자 base32 난수, 충돌 시 재생성.
- [ ] **Step 2: 실패 테스트** — Turnstile/RL/Supabase는 vi.mock 주입:
```ts
유효 입력 → { ok:true, publicCode: /^BT-\d{6}-[A-Z2-7]{4}$/, priceState:'estimated', estPrice:650000 }
전화 '123' → validation / waypointCodes 6개 → validation / busCount 21 → validation
returnAtLocal < departAtLocal → validation (kst throw 매핑)
departAtLocal '2026-09-01T08:00' → DB에 UTC 2026-08-31T23:00Z 저장 확인 (mock insert 캡처)
2026-09-01 → 09-03 (2박) → { priceState:'quote_required', estPrice:null }
Turnstile mock 실패 → bot_check_failed / RL mock 초과 → rate_limited
허니팟 website='x' → { ok:true } 반환하되 insert 미호출 (silent drop)
notify mock이 던져도 { ok:true } 유지 (after 격리)
```
- [ ] **Step 3: 구현** — §3 계약 순서대로. `after()`로 `notifyReservationCreated(r)` (Phase A에서는 no-op 구현 + 로그) [3A]. phone은 숫자만 정규화 저장. price_breakdown 저장.
- [ ] **Step 4: PASS → Step 5: Commit**

### Task A6: lookup Action + live-feed Handler (TDD)

**Files:** Create: `actions/reservations.ts`에 lookup 추가, `app/api/live-feed/route.ts`, Test: `tests/lookup-feed.test.ts`

- [ ] **Step 1: 테스트** — lookup: 일치 → ReservationPublic[](§3 최소 필드만, phone·message 미포함 확인), 불일치 → `[]`, RL 초과 → rate_limited. feed: 마스킹 패턴, 12건 상한, **DB 0건 → 시드 12건 + `sample:true`** [T1-A]
- [ ] **Step 2~4: FAIL→구현→PASS** — feed `export const revalidate = 60`
- [ ] **Step 5: Commit**

### Task A7: 배포 + CI

**Files:** Create: `.github/workflows/ci.yml`, Modify: `next.config.ts`(Supabase 이미지 도메인)

- [ ] **Step 1**: Vercel 연결(사용자 수행) + §4 env 입력
- [ ] **Step 2**: CI — push 시 `npm test` 실행. DB 테스트는 `supabase start`(로컬 Postgres 스택) 후 마이그레이션 적용해 실행 — "환경변수 없어 전부 skip"으로 green 되는 것 금지
- [ ] **Step 3**: 프리뷰 검증 — 배포된 페이지의 실제 폼(임시 테스트 페이지)에서 Server Action 호출 → Supabase 행 + public_code 확인
- [ ] **Step 4: Commit** + 레저 기록

---

## Phase B~E 범위 (착수 시 상세 플랜 확장)

**B 공개 사이트**: v1 정의 + 추가 — Turnstile 위젯/허니팟 필드, 접수 고지문(현황 표시 동의 [T1-A]), 다박 선택 시 "장기 일정은 확정 시 별도 안내" UX [5A], `PRICE_DISPLAY_MODE=inquiry` 렌더 분기 [T2-A], 위저드 인라인 계산 JS를 lib/pricing.ts import로 대체(중복 로직 금지), next/image 갤러리, Pretendard 서브셋 woff2 self-host, EN 전화 국제형식 입력.
**C 알림**: v1 정의 + 추가 — 전화번호 정규화(발신 시 숫자만), event별 중복 발송 가드(notifications_log 조회), admin 재발송 액션, Solapi 클라이언트 주입식 mock 테스트(성공/실패/폴백).
**D admin**: v1 정의 + 추가 — @supabase/ssr 쿠키 세션(ssr.ts 활용), 0002 단일 관리자 정책, 상태 머신 ALLOWED 전이표(§3) UI 반영, 비관리자 로그인 차단 테스트.
**E 이관·런치**: v1 정의 + 추가 — 개인정보처리방침 페이지(법적 필수) + 보존·삭제(1년) 문서화 + 접수 폼 동의 체크, DNS 전환 시 기존 MX/TXT 레코드 목록 백업·이관 + TTL 사전 단축 + 롤백 절차, 런치 게이트: 실요금표 수령 여부로 `PRICE_DISPLAY_MODE` 확정 [T2-A], Vercel Analytics.

## NOT in scope (검토 후 명시 제외)

- 온라인 결제 — 스펙 §3 확정 (확정 예약만 오프라인 결제)
- 자동 재시도 큐(발송 실패 시) — 소규모에 과함. admin 재발송 버튼으로 대체
- Upstash 외 분산 인프라(큐, 캐시 서버) — 트래픽 규모상 불요
- 기존 그누보드 견적 게시글 이관 — 개인정보 (동의 없는 이전 금지)
- 다국어 3개 이상(중/일) — EN까지만, 추후 messages 파일 추가로 확장 가능
- 모바일 앱 / 외부 API 공개 — Server Actions 선택의 전제. 필요 시 그때 Route Handler 추가

## What already exists (재사용 자산)

- 목업 3종 = 프론트 원본 (이식 대상, 재작성 아님) / soul.md = 카피·정책 원천
- 가격 기대값 = 목업 QA에서 검증된 수치 그대로 테스트로
- 버스 실사진 6장 (mockups/assets) / 기존 사이트 갤러리·공지 (Phase E 이관 원천)
- 이 저장소의 SDD 레저·리뷰 프로세스

## 실패 모드 (신규 코드패스별)

| 코드패스 | 프로덕션 실패 시나리오 | 테스트 | 에러 처리 | 사용자 가시성 |
|---|---|---|---|---|
| createReservation | Turnstile 서비스 다운 | A5 mock | bot_check_failed 반환 | "확인 실패, 다시 시도" 명시 |
| KST 파싱 | 해외 브라우저 시간대 개입 | A4 고정 오프셋 테스트 | 벽시계 문자열만 수신 | 없음(정상) |
| after() 발송 | Solapi 장애 → 문자 유실 | A5 격리 + C mock | log 'failed' + admin 재발송 | 접수는 성공, 사장님이 로그 확인 |
| 상태 전이 | PATCH 중복 → 문자 중복 | D 가드 테스트 | 전이표 + 발송 1회 가드 | 없음(방지됨) |
| live-feed | DB 장애 | A6 | 시드 폴백 | 예시 라벨로 정상 표시 |
| 도메인 전환 | MX 유실 → 메일 두절 | — (체크리스트) | E 절차 (레코드 백업) | 사전 방지 |

Critical gap 없음 — 전 실패 모드에 테스트 또는 절차 존재.

## 병렬화 전략

| Step | 모듈 | 의존 |
|---|---|---|
| A1 스캐폴드 | 루트 설정 | — |
| A2 스키마/타입 | supabase/, lib/ | A1 |
| A3·A4 순수 유틸 | lib/ | A1 (A2와 병렬 가능) |
| A5·A6 액션 | actions/, app/api/ | A2~A4 |
| A7 배포 | CI | A5·A6 |
| B 프론트 | app/[locale]/ | A |
| C 알림 | lib/notify | A (B와 병렬) |
| D admin | app/admin/, actions/admin | A, C |
| E 런치 | 콘텐츠/DNS | 전부 |

Lane A: A1→A2→A5→A6→A7 / Lane B(A1 후 병렬): A3+A4 / 이후 Lane C(공개 사이트)와 Lane D(알림) 병렬 → admin → 런치. B·C는 서로 다른 모듈(app/[locale] vs lib/notify)이라 워크트리 병렬 안전.

## Implementation Tasks (리뷰 발견 → 액션)

- [x] **T1 (P1)** — 플랜 개정: 1A~4A, 5A, 6A, Codex 수용분, T1~T3 전부 본문 반영 (이 v2 문서)
- [ ] **T2 (P1, CC: Phase A 실행)** — A1~A7 구현
- [ ] **T3 (P2, CC: ~10min)** — Phase B 상세 플랜 작성 시 v2 추가 항목(고지문/게이트/서브셋) 포함 확인
- [ ] **T4 (P3)** — 실요금표 수령 시 route_prices 시드 + PRICE_DISPLAY_MODE=estimate 전환

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | outside voice (codex exec) | Independent 2nd opinion | 1 | ISSUES_FOLDED | 19건 지적 → 15 수용, 3 크로스모델 결정(T1-A/T2-A/T3-A), 1 기수용(트레일러) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 6 issues (arch 4, quality 1, tests 1) — 전부 수용·v2 반영, critical gap 0 |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | 목업 단계에서 시각 QA 완료 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** 가격 모델 노선 부재·KST 시간대·canonical code·admin 권한·상태 머신·개인정보처리방침 등 15건 수용, v2에 전부 반영
- **CROSS-MODEL:** Eng 리뷰와 Codex가 겹친 영역(rate limit 실효성, 다박 처리)은 동일 방향 — 강한 신호. 충돌 3건은 사용자 결정으로 해소 (T1-A 고지+예시 라벨, T2-A 런치 게이트, T3-A CMS 유지)
- **VERDICT:** ENG CLEARED — ready to implement (Phase A부터)

NO UNRESOLVED DECISIONS
