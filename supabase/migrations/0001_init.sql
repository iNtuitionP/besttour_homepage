-- 0001_init.sql — 베스트투어 DB 스키마 v3 (가격 계산 없음, 확정 기준: 스펙 §12)
--
-- 절대 규칙: 가격 계산 관련 컬럼/테이블 없음. 노선 예시 가격(showcase_routes.price_from)은
-- 정적 표시값(NULL 허용)일 뿐이며, 실시간 계산 로직·estimate()·route_prices·est_price·
-- price_state·price_breakdown·vehicles.base_price 등은 이 마이그레이션에 존재하지 않는다.
-- 확인되지 않은 값은 창작하지 않는다 — Top-5 시드는 price_from을 전부 NULL로 둔다.

-- =========================================================================
-- 확장 (gen_random_uuid 등)
-- =========================================================================
create extension if not exists "pgcrypto";

-- =========================================================================
-- enum: reservation_status
-- =========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'reservation_status') then
    create type reservation_status as enum ('new', 'confirmed', 'done', 'cancelled');
  end if;
end
$$;

-- =========================================================================
-- vehicles — 차량 정보. base_price 없음(가격 계산 컬럼 금지).
-- =========================================================================
create table if not exists vehicles (
  id serial primary key,
  slug text unique not null,
  name_ko text not null,
  name_en text not null,
  capacity int not null check (capacity between 1 and 60),
  sort int not null default 0,
  active boolean not null default true
);

insert into vehicles (slug, name_ko, name_en, capacity, sort) values
  ('bus45', '45인승 관광버스', '45-seat Coach', 45, 1),
  ('bus35', '35인승 관광버스', '35-seat Coach', 35, 2),
  ('limo28', '28인승 우등리무진', '28-seat Premium Limousine', 28, 3),
  ('bus25', '25인승 관광버스', '25-seat Coach', 25, 4),
  ('bus16', '16인승 관광버스', '16-seat Minibus', 16, 5)
on conflict (slug) do nothing;

-- =========================================================================
-- showcase_routes — 홈 Top-5 예시 견적. price_from은 정적 표시값, NULL 허용.
-- 실값 미수령 시 라벨 숨김 폴백(노선·핀만 표시)이 원칙 — 가짜 가격 시드 금지.
-- =========================================================================
create table if not exists showcase_routes (
  id serial primary key,
  origin_code text not null check (origin_code in (
    'ICN','SEL','BSN','INC','DGU','GWJ','DJN','ULS','GG','GW','CN','CB','GB','GN','JN','JB','JJ'
  )),
  destination_code text not null check (destination_code in (
    'ICN','SEL','BSN','INC','DGU','GWJ','DJN','ULS','GG','GW','CN','CB','GB','GN','JN','JB','JJ'
  )),
  price_from int check (price_from is null or price_from > 0),
  highlight boolean not null default false,
  sort int,
  active boolean not null default true,
  unique (origin_code, destination_code)
);

insert into showcase_routes (origin_code, destination_code, price_from, highlight, sort) values
  ('ICN', 'SEL', null, true, 1),
  ('SEL', 'BSN', null, false, 2),
  ('SEL', 'GW', null, false, 3),
  ('SEL', 'DJN', null, false, 4),
  ('SEL', 'JB', null, false, 5)
on conflict (origin_code, destination_code) do nothing;

-- =========================================================================
-- reservations — 방문자 접수. 가격 필드 없음.
-- =========================================================================
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  public_code text unique not null,
  created_at timestamptz not null default now(),
  status reservation_status not null default 'new',
  name text not null check (char_length(name) between 1 and 30),
  phone text not null,
  email text,
  vehicle_slug text not null references vehicles (slug),
  purpose_code text not null,
  origin_code text not null,
  destination_code text not null,
  waypoint_codes jsonb not null default '[]',
  trip_type text check (trip_type in ('round', 'oneway', 'oneway_oneway')),
  depart_at timestamptz not null,
  return_at timestamptz check (return_at is null or return_at > depart_at),
  nights int not null default 0 check (nights >= 0),
  bus_count int not null default 1 check (bus_count between 1 and 20),
  passengers int check (passengers between 1 and 900),
  contact_method text,
  payment_method text,
  parking_included boolean,
  vat_included boolean,
  message text check (message is null or char_length(message) <= 1000),
  locale text not null default 'ko' check (locale in ('ko', 'en')),
  confirmed_at timestamptz,
  admin_memo text,
  constraint reservations_round_trip_return_ck
    check ((trip_type = 'round') = (return_at is not null))
);

create index if not exists reservations_status_created_at_idx
  on reservations (status, created_at desc);

-- =========================================================================
-- notifications_log — 문자(Solapi) 통지 로그.
-- =========================================================================
create table if not exists notifications_log (
  id bigserial primary key,
  reservation_id uuid references reservations (id),
  event text not null check (event in ('created', 'confirmed')),
  channel text not null check (channel in ('sms', 'alimtalk')),
  to_phone text not null,
  template text not null,
  status text not null check (status in ('sent', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists notifications_log_reservation_event_idx
  on notifications_log (reservation_id, event);

-- =========================================================================
-- popups — 홈 팝업 공지.
-- =========================================================================
create table if not exists popups (
  id serial primary key,
  title text not null,
  body text not null,
  image_path text,
  starts_at date not null,
  ends_at date not null check (ends_at >= starts_at),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- notices — 공지사항.
-- =========================================================================
create table if not exists notices (
  id serial primary key,
  title text not null,
  body text not null,
  category text not null default 'info',
  published_at date not null default current_date,
  active boolean not null default true
);

-- =========================================================================
-- gallery — 갤러리 이미지.
-- =========================================================================
create table if not exists gallery (
  id serial primary key,
  image_path text not null,
  caption text,
  sort int not null default 0,
  active boolean not null default true
);

-- =========================================================================
-- RLS — 전 테이블 enable.
-- reservations, notifications_log: 정책 없음 = 서비스 롤만 접근.
-- vehicles, gallery, showcase_routes, notices: 활성 행만 공개 조회 가능.
-- popups: 활성 + 노출 기간 내 행만 공개 조회 가능.
-- =========================================================================
alter table reservations enable row level security;
alter table notifications_log enable row level security;

alter table vehicles enable row level security;
drop policy if exists vehicles_select_active on vehicles;
create policy vehicles_select_active on vehicles for select using (active);

alter table gallery enable row level security;
drop policy if exists gallery_select_active on gallery;
create policy gallery_select_active on gallery for select using (active);

alter table showcase_routes enable row level security;
drop policy if exists showcase_routes_select_active on showcase_routes;
create policy showcase_routes_select_active on showcase_routes for select using (active);

alter table popups enable row level security;
drop policy if exists popups_select_active on popups;
create policy popups_select_active on popups
  for select using (active and current_date between starts_at and ends_at);

alter table notices enable row level security;
drop policy if exists notices_select_active on notices;
create policy notices_select_active on notices for select using (active);
