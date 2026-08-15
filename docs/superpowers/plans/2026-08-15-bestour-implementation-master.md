# 베스트투어 실구현 마스터 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 이 문서는 **마스터 플랜**이다: 공유 아키텍처·DB 스키마·API 계약·데이터 체크리스트 + **Phase A의 상세 태스크**를 담는다. Phase B~E는 범위·수용 기준까지 정의되어 있고, 각각 착수 시점에 이 문서를 참조하는 별도 상세 플랜(`2026-MM-DD-bestour-phase-X.md`)으로 확장한다.

**Goal:** 컨펌된 목업(시안 7 + 위저드 + admin)을 실제 서비스로 구현한다 — 예약 접수·문자 알림·관리자 운영까지.

**Architecture:** Next.js App Router가 프론트와 API를 모두 담당하고, Supabase가 DB(Postgres)·관리자 인증·이미지 스토리지를 담당한다. 문자/알림톡은 Solapi를 서버 측에서만 호출한다. 가격 계산은 DB의 요금 설정을 읽는 순수 TypeScript 함수로 구현해 홈 위젯·위저드·admin이 공유한다.

**Tech Stack:** Next.js 15(App Router, TS), Supabase(@supabase/supabase-js v2, @supabase/ssr), next-intl(KO 기본/EN 토글), solapi(공식 SDK), zod(입력 검증), vitest(테스트), CSS Modules + 디자인 토큰(Tailwind 미사용).

**Spec:** docs/superpowers/specs/2026-08-07-bestour-redesign-uiux-design.md (§10·§11 우선) + mockups/soul.md (§10 우선) + 컨펌 목업 3종(mockups/variant-07-final.html, wizard.html, admin.html)

## Global Constraints

- 팔레트·레이아웃·카피는 컨펌 목업이 원본이다. 픽셀 임의 변경 금지. 팔레트: `#3B1F5C` `#7C3AED` `#F3EFFA` `#1A1523` `#FAF9FC` `#D4A843`
- BM 비노출: "나가는 버스", "태우고 나가", "공차", "회송" 등 원가 구조 표현은 한/영 모든 카피에서 금지 (soul.md §10.2)
- 공항 표기: "공항 픽업·샌딩 (송영 전문)" / EN: "Airport Pick-up & Sending"
- 가격 표기에는 항상 "예상가" 라벨 + "실제 견적은 확정 시 안내" 병기. 결제 기능 없음 (스펙 §3)
- 예약 접수·상태 변경 문구: "사장님 확정 후 연락드리며, 확정된 예약만 결제 진행됩니다." (verbatim)
- 차량 5종 고정: 45인승 관광버스 / 35인승 관광버스 / 28인승 우등리무진 / 25인승 관광버스 / 16인승 관광버스
- 회사 정보는 soul.md §3 원문 그대로 (대표 1566-6188, 직통 010-2048-8585 등)
- 모바일 375px 가로 스크롤 금지, 1280px 대응
- Supabase service role key는 서버 전용(클라이언트 번들 유입 금지). 모든 공개 API는 zod 검증 + rate limit
- 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## 0. 저장소 구조 (전 Phase 공유)

```
/                          # 저장소 루트 = Next.js 앱 루트
├─ app/
│  ├─ [locale]/            # ko(기본, URL 프리픽스 없음) / en
│  │  ├─ page.tsx          # 홈 (variant-07-final 이식)
│  │  ├─ quote/page.tsx    # 견적 위저드 (wizard.html 이식)
│  │  ├─ company/page.tsx  # 회사소개 + 오시는 길
│  │  ├─ vehicles/page.tsx # 차량소개 + 보험 + 운임
│  │  ├─ gallery/page.tsx
│  │  ├─ notice/page.tsx   # 고객센터(공지)
│  │  └─ reservation-check/page.tsx  # 예약확인 (이름+전화 조회)
│  ├─ admin/               # locale 밖 (한국어 전용)
│  │  ├─ login/page.tsx
│  │  ├─ page.tsx          # 예약 현황
│  │  └─ popups/page.tsx   # 팝업/공지 관리
│  └─ api/
│     ├─ reservations/route.ts        # POST 접수
│     ├─ reservations/lookup/route.ts # POST 예약확인 조회
│     ├─ live-feed/route.ts           # GET 실시간 견적현황(마스킹)
│     └─ admin/reservations/[id]/route.ts # PATCH 상태 변경(+알림)
├─ lib/
│  ├─ pricing.ts           # 순수 가격 계산 (핵심 공유 로직)
│  ├─ notify.ts            # Solapi 발송 (알림톡→SMS 폴백)
│  ├─ mask.ts              # 이름/전화 마스킹
│  ├─ supabase/server.ts   # 서버 클라이언트(서비스 롤/SSR)
│  └─ supabase/client.ts   # 브라우저 클라이언트(anon)
├─ messages/ko.json, en.json  # next-intl 문자열 (카피 전량)
├─ styles/tokens.css       # 목업 CSS 변수 이식
├─ supabase/migrations/0001_init.sql
├─ tests/                  # vitest
└─ mockups/, docs/         # 기존 그대로 (참조용)
```

## 1. DB 스키마 (supabase/migrations/0001_init.sql — Phase A Task 2에서 생성)

```sql
create type reservation_status as enum ('new','confirmed','done','cancelled');

create table vehicles (
  id serial primary key,
  slug text unique not null,             -- 'bus45','bus35','limo28','bus25','bus16'
  name_ko text not null, name_en text not null,
  capacity int not null,
  base_price int not null,               -- 당일왕복 기준가 (원)
  sort int not null default 0, active boolean not null default true
);

create table price_rules (                -- 배율/설정 (사장님 요금표 반영 지점)
  key text primary key,                   -- 'oneway','overnight','oneway_oneway','airport_note'
  value numeric not null,
  description text
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status reservation_status not null default 'new',
  name text not null, phone text not null,
  vehicle_slug text not null references vehicles(slug),
  purpose text not null,                  -- 여행구분 10종
  origin text not null, destination text not null,
  waypoints jsonb not null default '[]',  -- ["대전","부산"] 최대 5
  trip_type text not null,                -- 'round','oneway','oneway_oneway'
  depart_at timestamptz not null, return_at timestamptz,
  bus_count int not null default 1, passengers int,
  est_price int not null,
  contact_method text, payment_method text,
  parking_included boolean, vat_included boolean,
  message text, locale text not null default 'ko',
  confirmed_at timestamptz, admin_memo text
);
create index on reservations (status, created_at desc);

create table notifications_log (
  id bigserial primary key,
  reservation_id uuid references reservations(id),
  channel text not null,                  -- 'sms' | 'alimtalk'
  to_phone text not null, template text not null,
  status text not null,                   -- 'sent' | 'failed'
  provider_message_id text, error text,
  created_at timestamptz not null default now()
);

create table popups (
  id serial primary key,
  title text not null, body text not null,
  image_path text,                        -- Supabase storage 경로
  starts_at date not null, ends_at date not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table notices (
  id serial primary key,
  title text not null, body text not null,
  category text not null default '안내',
  published_at date not null default current_date,
  active boolean not null default true
);

create table gallery (
  id serial primary key,
  image_path text not null, caption text,
  sort int not null default 0, active boolean not null default true
);

-- RLS: 공개 테이블은 읽기만 공개, 쓰기는 서비스 롤 전용
alter table reservations enable row level security;   -- 정책 없음 = 서비스 롤만
alter table notifications_log enable row level security;
alter table vehicles enable row level security;
create policy vehicles_read on vehicles for select using (true);
alter table price_rules enable row level security;
create policy price_read on price_rules for select using (true);
alter table popups enable row level security;
create policy popups_read on popups for select using (active and current_date between starts_at and ends_at);
alter table notices enable row level security;
create policy notices_read on notices for select using (active);
alter table gallery enable row level security;
create policy gallery_read on gallery for select using (active);

-- 시드 (목업 더미 요금표 — 사장님 실값으로 교체 예정)
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

## 2. API 계약 (전 Phase 공유 — 이름·타입 고정)

| 엔드포인트 | 입력(zod) | 출력 | 비고 |
|---|---|---|---|
| `POST /api/reservations` | `ReservationInput` (아래) | `{ id: string }` 201 | 접수 + 사장님/고객 알림 발송(Phase C에서 활성화) |
| `POST /api/reservations/lookup` | `{ name: string, phone: string }` | `ReservationPublic[]` | 본인 예약 조회. 분당 5회 rate limit |
| `GET /api/live-feed` | — | `{ name: string, vehicle: string, date: string }[]` 최근 12건 | name은 `mask.ts`로 "한**" 마스킹 |
| `PATCH /api/admin/reservations/:id` | `{ status: 'confirmed'\|'done'\|'cancelled' }` | `ReservationAdmin` | Supabase 세션 필수. confirmed 시 고객 알림 |

```ts
// lib/types.ts — 전 Phase 공유 타입 (이름 고정)
export const ReservationInput = z.object({
  name: z.string().min(1).max(30),
  phone: z.string().regex(/^01[016789]-\d{3,4}-\d{4}$/),
  vehicleSlug: z.enum(['bus45','bus35','limo28','bus25','bus16']),
  purpose: z.string().min(1),
  origin: z.string().min(1), destination: z.string().min(1),
  waypoints: z.array(z.string()).max(5).default([]),
  tripType: z.enum(['round','oneway','oneway_oneway']),
  departAt: z.string().datetime(), returnAt: z.string().datetime().optional(),
  busCount: z.number().int().min(1).max(20).default(1),
  passengers: z.number().int().min(1).max(900).optional(),
  contactMethod: z.string().optional(), paymentMethod: z.string().optional(),
  parkingIncluded: z.boolean().optional(), vatIncluded: z.boolean().optional(),
  message: z.string().max(1000).optional(),
  locale: z.enum(['ko','en']).default('ko'),
});
export type ReservationInput = z.infer<typeof ReservationInput>;
```

```ts
// lib/pricing.ts — 시그니처 고정 (Phase A Task 3)
export type TripType = 'round' | 'oneway' | 'oneway_oneway';
export interface PriceConfig { basePrices: Record<string, number>; rules: { oneway: number; overnight: number; oneway_oneway: number } }
export interface EstimateInput { vehicleSlug: string; tripType: TripType; nights: 0 | 1; busCount: number }
export function estimate(cfg: PriceConfig, input: EstimateInput): number
```

## 3. 환경 변수 (Vercel 프로젝트 설정)

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 공개 읽기(차량/요금/팝업/공지/갤러리) |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 쓰기(예약/로그/관리) |
| `SOLAPI_API_KEY`, `SOLAPI_API_SECRET` | 문자 발송 |
| `SMS_SENDER` = `15666188` | 발신번호(사전 등록 필수) |
| `OWNER_PHONE` = `01020488585` | 사장님 수신 번호 |
| `NEXT_PUBLIC_KAKAO_CHANNEL_URL`, `NEXT_PUBLIC_NAVER_TALK_URL` | 문의 채널 링크(개설 후 주입, 그 전엔 버튼 숨김 아님 — "준비 중" 안내) |

## 4. 사장님에게 받아야 하는 데이터 (Phase 진행 조건)

| 데이터 | 막히는 Phase | 없을 때 임시값 |
|---|---|---|
| 노선별 실제 요금표 + 공항 노선 할인 폭 | E(런치) | 목업 더미 요금표 유지 + "예상가" 고지 |
| 창업연도·누적 운행 실적 | B(홈 카피) | "13년/4,800건" 임시값 + 내부 표시 |
| 발신번호(1566-6188) 등록 서류 (통신서비스 이용증명원) | C | 발송 기능 스텁(로그만) |
| 사업자등록증 + 카카오 비즈니스 채널 | C(알림톡) | SMS(LMS)로만 발송 |
| 카카오톡 채널 URL / 네이버 톡톡 URL | B | 버튼 클릭 시 "채널 준비 중, 전화 주세요" 안내 |
| 이벤트 팝업 소재(사진+문구) | D | admin에서 사장님이 직접 등록하는 구조라 데모 팝업으로 시연 |
| 도메인(bestour.co.kr) 관리 계정 | E | Vercel 기본 도메인으로 검수 |
| 갤러리 원본 사진, 이관할 공지 목록 | E | 기존 사이트 스크랩 6장 + 공지 2건 |
| 영문 회사 표기·주소 영문 표기 | B | 로마자 표기 초안 작성 후 컨펌 |

## 5. Phase 분해

| Phase | 산출물 | 완료 기준 |
|---|---|---|
| **A. 기반** (이 문서에 상세) | Next.js 스캐폴드 + Supabase 스키마 + 가격 엔진 + 예약 API + Vercel 배포 | `POST /api/reservations`가 프리뷰 URL에서 실제 DB에 저장, vitest 전부 통과 |
| **B. 공개 사이트** | 홈(v7)·위저드·서브페이지 5종 이식, KO/EN 토글, 팝업 노출, 실시간 피드 | 목업과 시각적 동일(스크린샷 대조), EN 전환 동작, Lighthouse 모바일 90+ |
| **C. 알림** | notify.ts(Solapi), 접수/확정 발송, notifications_log | 실기기 문자 수신 확인, 실패 시 로그·폴백 동작 |
| **D. admin** | Supabase Auth 로그인, 예약 현황(상태 변경→알림), 팝업/공지/갤러리 CRUD + 이미지 업로드 | 사장님 시나리오 E2E: 로그인→신규 예약 확정→고객 문자 수신→팝업 등록→홈 노출 |
| **E. 이관·런치** | 기존 콘텐츠 이관, 도메인 전환, SEO(메타/OG/sitemap), 접속 통계(Vercel Analytics), 런치 체크리스트 | bestour.co.kr에서 신규 사이트 서비스, 구 그누보드 견적 게시판 접수 중단 안내 |

의존 관계: A → B, C는 A 이후 B와 병렬 가능, D는 A·C 이후, E는 전부 이후.

---

## Phase A 상세 태스크

### Task A1: Next.js 스캐폴드 + 도구 체인

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `app/layout.tsx`, `app/page.tsx`(임시), `styles/tokens.css`, `.env.example`, `.gitignore` 갱신

**Interfaces:**
- Produces: 실행 가능한 Next.js 앱 (`npm run dev`), `npm test`(vitest)

- [ ] **Step 1: 스캐폴드 생성** — 저장소 루트에서 (mockups/, docs/ 보존 확인):
```bash
npx create-next-app@latest . --ts --app --no-tailwind --eslint --src-dir=false --import-alias "@/*" --use-npm
npm i zod @supabase/supabase-js @supabase/ssr next-intl solapi
npm i -D vitest @vitest/coverage-v8
```
- [ ] **Step 2: vitest 설정** — `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
```
`package.json` scripts에 `"test": "vitest run"` 추가.
- [ ] **Step 3: 디자인 토큰 이식** — `styles/tokens.css`에 variant-07-final.html의 `:root` CSS 변수 블록을 그대로 복사(팔레트 6색 + 간격/라운드 변수). `app/layout.tsx`에서 import.
- [ ] **Step 4: .env.example 작성** — §3의 변수 전체를 키만 나열.
- [ ] **Step 5: 검증** — `npm run dev` 기동 + `npm test`가 "no tests" 아닌 정상 종료(빈 테스트 1개 추가: `tests/smoke.test.ts`에 `expect(1).toBe(1)`).
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: scaffold Next.js app with tokens and toolchain"`

### Task A2: Supabase 프로젝트 + 마이그레이션

**Files:**
- Create: `supabase/migrations/0001_init.sql` (§1 SQL 전문), `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/types.ts`(§2의 ReservationInput)

**Interfaces:**
- Produces: `createServiceClient(): SupabaseClient`(서버 전용), `createBrowserClient(): SupabaseClient`, `ReservationInput` zod 스키마

- [ ] **Step 1: Supabase 프로젝트 생성** — supabase.com에서 신규 프로젝트(리전 ap-northeast-2 서울). URL/anon/service key를 `.env.local`에 기입. **사용자(개발자)가 대시보드에서 직접 수행** — 에이전트는 키를 받은 뒤 진행.
- [ ] **Step 2: 마이그레이션 작성** — §1 SQL을 `supabase/migrations/0001_init.sql`로 저장, Supabase SQL Editor에서 실행(또는 `npx supabase db push`).
- [ ] **Step 3: 클라이언트 모듈**:
```ts
// lib/supabase/server.ts
import { createClient } from '@supabase/supabase-js';
export function createServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
```
- [ ] **Step 4: 연결 스모크 테스트** — `tests/db.test.ts`: `vehicles` select가 5행, `bus45.base_price === 650000` (환경변수 없으면 `describe.skipIf`).
- [ ] **Step 5: Commit** — `git commit -m "feat: supabase schema, seed, and clients"`

### Task A3: 가격 엔진 (TDD)

**Files:**
- Create: `lib/pricing.ts`, Test: `tests/pricing.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces: §2의 `estimate(cfg, input)` — 홈 위젯·위저드·예약 API가 공유

- [ ] **Step 1: 실패하는 테스트 작성** — 목업 검증 때 확정된 기대값 그대로:
```ts
import { describe, it, expect } from 'vitest';
import { estimate, type PriceConfig } from '@/lib/pricing';
const cfg: PriceConfig = {
  basePrices: { bus45: 650000, bus35: 550000, limo28: 600000, bus25: 480000, bus16: 400000 },
  rules: { oneway: 0.6, overnight: 1.8, oneway_oneway: 1.2 },
};
describe('estimate', () => {
  it('당일왕복 45인승 1대 = 650,000', () => expect(estimate(cfg, { vehicleSlug: 'bus45', tripType: 'round', nights: 0, busCount: 1 })).toBe(650000));
  it('편도 = 60%', () => expect(estimate(cfg, { vehicleSlug: 'bus45', tripType: 'oneway', nights: 0, busCount: 1 })).toBe(390000));
  it('1박2일 = 1.8배', () => expect(estimate(cfg, { vehicleSlug: 'bus45', tripType: 'round', nights: 1, busCount: 1 })).toBe(1170000));
  it('편도·편도 = 1.2배', () => expect(estimate(cfg, { vehicleSlug: 'bus45', tripType: 'oneway_oneway', nights: 0, busCount: 1 })).toBe(780000));
  it('16인승 2대 = 800,000', () => expect(estimate(cfg, { vehicleSlug: 'bus16', tripType: 'round', nights: 0, busCount: 2 })).toBe(800000));
  it('미지의 차량은 throw', () => expect(() => estimate(cfg, { vehicleSlug: 'nope', tripType: 'round', nights: 0, busCount: 1 })).toThrow());
});
```
- [ ] **Step 2: 실패 확인** — `npm test` → FAIL (estimate not defined)
- [ ] **Step 3: 구현**:
```ts
export function estimate(cfg: PriceConfig, input: EstimateInput): number {
  const base = cfg.basePrices[input.vehicleSlug];
  if (base === undefined) throw new Error(`unknown vehicle: ${input.vehicleSlug}`);
  const trip = input.tripType === 'oneway' ? cfg.rules.oneway
    : input.tripType === 'oneway_oneway' ? cfg.rules.oneway_oneway : 1;
  const nights = input.nights === 1 ? cfg.rules.overnight : 1;
  return Math.round(base * trip * nights) * input.busCount;
}
```
- [ ] **Step 4: 통과 확인** — `npm test` → 6 passed
- [ ] **Step 5: Commit** — `git commit -m "feat: pricing engine with mockup-verified expectations"`

### Task A4: 마스킹 유틸 (TDD)

**Files:**
- Create: `lib/mask.ts`, Test: `tests/mask.test.ts`

**Interfaces:**
- Produces: `maskName(name: string): string`("한**"), `maskPhone(phone: string): string`("010-****-5678")

- [ ] **Step 1: 테스트**:
```ts
import { maskName, maskPhone } from '@/lib/mask';
it('이름은 첫 글자만', () => expect(maskName('한지원')).toBe('한**'));
it('한 글자 이름', () => expect(maskName('한')).toBe('한*'));
it('영문 이름', () => expect(maskName('John')).toBe('J**'));
it('전화 가운데 마스킹', () => expect(maskPhone('010-1234-5678')).toBe('010-****-5678'));
```
- [ ] **Step 2: 실패 확인** → **Step 3: 구현**:
```ts
export const maskName = (n: string) => n.slice(0, 1) + '*'.repeat(Math.min(Math.max(n.length - 1, 1), 2));
export const maskPhone = (p: string) => p.replace(/^(\d{2,3})-(\d{3,4})-(\d{4})$/, (_, a, b, c) => `${a}-${'*'.repeat(b.length)}-${c}`);
```
- [ ] **Step 4: 통과 확인** → **Step 5: Commit** — `git commit -m "feat: masking utils for public feed"`

### Task A5: 예약 접수 API

**Files:**
- Create: `app/api/reservations/route.ts`, `lib/rate-limit.ts`, Test: `tests/reservations-api.test.ts`

**Interfaces:**
- Consumes: `ReservationInput`(A2), `estimate`(A3), `createServiceClient`(A2)
- Produces: `POST /api/reservations` → 201 `{ id }` / 400 zod 에러 / 429 rate limit. **est_price는 서버에서 재계산**(클라이언트 값 신뢰 금지)

- [ ] **Step 1: rate limit 유틸** — `lib/rate-limit.ts`: 메모리 Map 기반 `allow(ip: string, limit: number, windowMs: number): boolean` (Vercel 단일 인스턴스 한계는 주석으로 명시, Phase E에서 필요 시 Upstash 교체).
- [ ] **Step 2: 핸들러 테스트** — route handler를 직접 import해 Request 객체로 호출:
```ts
import { POST } from '@/app/api/reservations/route';
const valid = { name: '한지원', phone: '010-1234-5678', vehicleSlug: 'bus45', purpose: '공항픽업',
  origin: '인천공항', destination: '서울', waypoints: [], tripType: 'round',
  departAt: '2026-09-01T08:00:00Z', returnAt: '2026-09-01T20:00:00Z', busCount: 1, locale: 'ko' };
it('유효 입력 → 201 + id', async () => {
  const res = await POST(new Request('http://t/api/reservations', { method: 'POST', body: JSON.stringify(valid), headers: { 'x-forwarded-for': '1.1.1.1' } }));
  expect(res.status).toBe(201);
  expect((await res.json()).id).toMatch(/[0-9a-f-]{36}/);
});
it('전화 형식 오류 → 400', async () => {
  const res = await POST(new Request('http://t', { method: 'POST', body: JSON.stringify({ ...valid, phone: '123' }) }));
  expect(res.status).toBe(400);
});
```
(DB 의존 테스트는 A2와 같은 skipIf 패턴. zod 400 케이스는 DB 없이도 통과해야 함 — 검증을 insert보다 먼저.)
- [ ] **Step 3: 구현** — zod parse → `estimate` 서버 재계산(nights는 departAt/returnAt 날짜 차이로 산출) → insert → `{ id }` 201. 알림 발송 지점은 `// TODO(Phase C): notify` 주석이 아니라 **no-op 함수 `notifyReservationCreated(r)` 호출**로 남긴다(C에서 구현 교체).
- [ ] **Step 4: 통과 확인** — `npm test`
- [ ] **Step 5: Commit** — `git commit -m "feat: reservation intake API with server-side pricing"`

### Task A6: 실시간 피드 + 예약확인 API

**Files:**
- Create: `app/api/live-feed/route.ts`, `app/api/reservations/lookup/route.ts`, Test: `tests/feed-lookup.test.ts`

**Interfaces:**
- Consumes: `maskName`(A4), `createServiceClient`(A2)
- Produces: §2 계약대로. live-feed는 60초 캐시(`export const revalidate = 60`)

- [ ] **Step 1: 테스트** — live-feed 응답 항목이 `{ name, vehicle, date }` 형태이고 name이 `/^.\*{1,2}$/` 마스킹 패턴인지, lookup은 이름+전화 일치 시만 반환하고 불일치 시 빈 배열(404 아님 — 존재 여부 노출 방지)인지.
- [ ] **Step 2: 실패 확인** → **Step 3: 구현** — lookup은 `allow(ip, 5, 60_000)` rate limit.
- [ ] **Step 4: 통과 확인** → **Step 5: Commit** — `git commit -m "feat: live feed and reservation lookup APIs"`

### Task A7: Vercel 배포 파이프라인

**Files:**
- Modify: `next.config.ts` (이미지 도메인: Supabase storage 호스트)

**Interfaces:**
- Produces: main 푸시 = 프로덕션, PR = 프리뷰 URL

- [ ] **Step 1: Vercel 프로젝트 연결** — GitHub 저장소 import(사용자가 Vercel 대시보드에서 1회 수행), 환경 변수 §3 입력.
- [ ] **Step 2: 프리뷰 검증** — 브랜치 푸시 → 프리뷰 URL에서 `POST /api/reservations`를 curl로 실호출 → Supabase 대시보드에서 행 확인:
```bash
curl -sS -X POST https://<preview>/api/reservations -H 'content-type: application/json' -d '{"name":"테스트","phone":"010-0000-0000","vehicleSlug":"bus45","purpose":"공항픽업","origin":"인천공항","destination":"서울","tripType":"round","departAt":"2026-09-01T08:00:00Z","busCount":1,"locale":"ko"}'
```
- [ ] **Step 3: Commit** — 설정 변경분 커밋 + Phase A 완료를 레저에 기록

---

## Phase B~E 범위 정의 (착수 시 별도 상세 플랜으로 확장)

### Phase B: 공개 사이트 이식
- **원칙**: 목업 HTML/CSS를 컴포넌트로 분해 이식하되 렌더 결과가 목업과 시각적으로 동일해야 한다(browse 스크린샷 대조를 수용 기준에 포함).
- 컴포넌트 단위: `Header`(KO/EN 토글 포함), `HeroCarousel`, `QuoteWidget`(경유지 포함, `estimate` 공유), `LiveTicker`(live-feed API), `Steps4`, `VehicleCards`, `Gallery`, `NoticeList`, `Footer`, `FloatingContact`(전화/카카오/톡톡), `EventPopup`(popups API + localStorage), 위저드 7단계(`app/[locale]/quote`).
- i18n: 모든 카피를 `messages/ko.json`으로 추출 → `en.json` 번역(BM 비노출 규칙 동일 적용, "공항 픽업·샌딩 (송영 전문)" = "Airport Pick-up & Sending"). 헤더 토글은 현재 경로 유지 전환(`/quote` ↔ `/en/quote`).
- 서브페이지 콘텐츠 원천: 기존 사이트(회사소개/차량소개/보험/운임/오시는길) — soul.md §1~3 + 기존 사이트 텍스트 이관.

### Phase C: 알림 파이프라인
- `lib/notify.ts`: `notifyReservationCreated(r)`, `notifyReservationConfirmed(r)` — Solapi SDK로 LMS 발송(고객+사장님), 결과를 notifications_log에 기록, 실패해도 예약 API는 성공 응답(발송은 best-effort, 로그로 추적).
- 메시지 본문은 목업 wizard.html 7단계의 문자 미리보기 텍스트를 그대로 사용(경로 "출발지 → 경유 → 도착지" 포함).
- 알림톡: 카카오 비즈니스 채널·템플릿 승인 후 `channel: 'alimtalk'` 우선 발송 + SMS 폴백으로 교체. 템플릿 문구는 승인 요건(변수 표기 `#{name}`)에 맞춰 이 Phase에서 작성.
- 테스트: Solapi 클라이언트를 주입 가능하게 만들어(mock) 성공/실패/폴백 3경로 단위 테스트. 실발송은 개발자 본인 번호로 1회 수동 확인.

### Phase D: admin
- 인증: Supabase Auth 이메일/비밀번호 계정 1개(사장님). `middleware.ts`로 `/admin/*` 보호. RLS: authenticated 롤에 popups/notices/gallery insert/update 정책 추가(별도 마이그레이션 `0002_admin_policies.sql`).
- 예약 현황: admin.html 목업 그대로 — 요약 카드 4개(상태별 count 쿼리), 목록(전화번호는 마스킹 없이 표시 — 사장님 화면), 상태 변경 버튼 → PATCH API → confirmed 시 `notifyReservationConfirmed`.
- 팝업 관리: 이미지 업로드(Supabase Storage 버킷 `popups`, 공개 읽기), 등록/중지, 미리보기는 실제 `EventPopup` 컴포넌트 재사용.
- 공지/갤러리 관리: 동일 CRUD 패턴.

### Phase E: 이관·런치
- 콘텐츠 이관: 기존 갤러리 게시판 이미지 스크랩(browse `scrape`) → Storage 업로드 + gallery 행 생성, 공지 2건 이관, 회사소개/오시는길 텍스트 검수.
- SEO: 페이지별 metadata(제목/설명, 한/영 hreflang), OG 이미지(버스 사진), `sitemap.ts`, `robots.ts`, 네이버 서치어드바이저·구글 서치콘솔 등록(그누보드 URL → 신규 URL 301은 도메인 전환 시 Vercel redirects로).
- 도메인: bestour.co.kr DNS를 Vercel로 전환(기존 호스팅 해지 전 갤러리/공지 이관 완료 필수), 사장님께 전환 시점 합의.
- 런치 체크리스트: 실요금표 반영, 실적 수치 교체, 채널 URL 주입, 발신번호 승인 확인, 375px/1280px 전 페이지 QA, admin 사장님 온보딩(사용법 1페이지 문서).

## 리스크·주의

- **요금표가 끝까지 안 오면**: 더미 요금 + "예상가" 고지로 런치 가능하나, 사장님과 "예상가와 실견적 괴리" 리스크 합의 필요.
- **알림톡 심사 소요(수일~수주)**: C는 SMS로 먼저 완성하고 알림톡은 non-blocking으로 후속.
- **rate limit이 메모리 기반**: Vercel 콜드스타트마다 리셋됨. 악용 징후 보이면 Upstash Redis(무료 티어)로 교체 — Phase E 체크리스트에 포함.
- **기존 사이트의 견적 게시판 데이터**: 개인정보(이름/전화)가 있으므로 이관하지 않는다. 신규 DB는 빈 상태로 시작, 실시간 피드는 신규 예약 누적 전까지 시드 12건(soul §8 더미)을 fallback으로 표시.
