-- 0002_places.sql — 도시 카탈로그(places) 신설 + showcase_routes CHECK→FK 전환 + 대표 노선 16행 시드
--
-- 배경(플랜 v4 P1-2, 스펙 §13.2): 사장님이 확정한 대표 노선 16개는 도시 단위(통영·포항·여수·
-- 해남·세종·속초·강릉·태백·홍천·원주)라 0001 의 17개 시도 코드 CHECK 로는 표현할 수 없다
-- (강원 5도시가 전부 GW 로 뭉개지고, 여수·해남이 JN 으로 겹치며, 세종은 코드가 없다).
-- 도시 카탈로그를 만들고 showcase_routes 가 그것을 FK 로 가리키게 바꾼다.
--
-- 단일 소스: lib/codes.ts 의 PLACES / SHOWCASE_ROUTE_SEED, lib/map-coords.ts 의 PLACE_POINTS.
-- tests/places.test.ts 가 이 파일의 insert 행을 파싱해 TS 정의와 1:1 일치함을 단언한다.
-- 위경도 출처(Wikidata P625 / OSM 요소)는 lib/codes.ts 각 행 주석 참조.
--
-- 절대 규칙: price_from 은 스펙 §13.2 의 정적 표시값 리터럴이다. 계산·변환 없음.
-- 0001 은 수정하지 않는다. reservations 의 origin_code/destination_code 는 이번에 건드리지
-- 않는다(CHECK 없이 text, 위저드가 선택지를 제한).
-- 롤백: supabase/rollbacks/0002_places.down.sql (수동 실행 전용). migrations/ 밖에 두는 이유 —
-- CLI 는 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 파일을 전부 마이그레이션으로 집으므로
-- 여기에 두면 db push / db reset 이 롤백까지 적용한다.

-- =========================================================================
-- 1. places — 도시 카탈로그
-- =========================================================================
create table if not exists places (
  code        text primary key,            -- 3글자 대문자 (lib/codes.ts PLACES)
  name_ko     text not null,
  name_en     text not null,
  kind        text not null check (kind in ('airport','city')),
  region_code text not null,               -- lib/codes.ts REGIONS 의 시도 코드 — 시도 단위 집계용
  lat         double precision not null,   -- 시청(군청)·공항 터미널 기준, 소수 4자리
  lng         double precision not null,
  svg_x       double precision not null,   -- mockups/assets/kr-map.svg viewBox 0 0 524 560 좌표
  svg_y       double precision not null,
  sort        int not null default 0,
  active      boolean not null default true
);

-- 세종(SJG)의 region_code 가 'CN' 인 이유는 lib/codes.ts PLACES 주석 참조(17개 시도 코드에 세종 없음).
insert into places (code, name_ko, name_en, kind, region_code, lat, lng, svg_x, svg_y, sort) values
  ('ICN', '인천공항', 'Incheon Airport', 'airport', 'INC', 37.4496, 126.4521, 151.8, 118.9, 1),
  ('SEL', '서울', 'Seoul', 'city', 'SEL', 37.5664, 126.9778, 196.4, 107.9, 2),
  ('BSN', '부산', 'Busan', 'city', 'BSN', 35.1798, 129.075, 370.6, 354.5, 3),
  ('DGU', '대구', 'Daegu', 'city', 'DGU', 35.8713, 128.6018, 331.2, 283, 4),
  ('TYG', '통영', 'Tongyeong', 'city', 'GN', 34.8541, 128.4333, 317.4, 388.3, 5),
  ('PHG', '포항', 'Pohang', 'city', 'GB', 36.019, 129.3434, 393, 268, 6),
  ('JJU', '전주', 'Jeonju', 'city', 'JB', 35.8246, 127.1478, 210.3, 287.7, 7),
  ('GWJ', '광주', 'Gwangju', 'city', 'GWJ', 35.1596, 126.8524, 186, 356.6, 8),
  ('YSU', '여수', 'Yeosu', 'city', 'JN', 34.7605, 127.6623, 253.2, 397.8, 9),
  ('HNM', '해남', 'Haenam', 'city', 'JN', 34.5739, 126.5996, 164.8, 416.9, 10),
  ('DJN', '대전', 'Daejeon', 'city', 'DJN', 36.3504, 127.3847, 230.1, 233.6, 11),
  ('SJG', '세종', 'Sejong', 'city', 'CN', 36.4801, 127.289, 222, 219.9, 12),
  ('SCH', '속초', 'Sokcho', 'city', 'GW', 38.2073, 128.592, 330.3, 41.5, 13),
  ('GNG', '강릉', 'Gangneung', 'city', 'GW', 37.7519, 128.8759, 353.9, 88.7, 14),
  ('TBK', '태백', 'Taebaek', 'city', 'GW', 37.1641, 128.9858, 363.1, 149.5, 15),
  ('HCN', '홍천', 'Hongcheon', 'city', 'GW', 37.6972, 127.8888, 271.8, 94.2, 16),
  ('WJU', '원주', 'Wonju', 'city', 'GW', 37.342, 127.9196, 274.4, 130.9, 17)
on conflict (code) do nothing;

-- RLS: 활성 행 공개 조회 (0001 의 vehicles 패턴 그대로)
alter table places enable row level security;
drop policy if exists places_select_active on places;
create policy places_select_active on places for select using (active);

-- =========================================================================
-- 2. showcase_routes — 0001 의 익명 인라인 CHECK 제거
--    0001 은 origin_code/destination_code 에 이름 없는 인라인 CHECK 를 걸었다
--    (Postgres 기본 이름 showcase_routes_<column>_check 이지만 이름에 기대지 않고
--    pg_constraint 에서 정의문 기준으로 찾아 동적으로 제거한다).
--    price_from 의 CHECK 는 정의문에 두 컬럼명이 없으므로 그대로 남는다.
-- =========================================================================
do $$
declare
  ck record;
begin
  for ck in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'showcase_routes'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~ '(origin_code|destination_code)'
  loop
    execute format('alter table public.showcase_routes drop constraint %I', ck.conname);
  end loop;
end
$$;

-- =========================================================================
-- 3. 0001 자리표시자 5행 삭제 (price_from 전부 NULL 이던 자리표시자. 쌍을 지정해 지운다 —
--    이 5쌍 밖의 행이 있고 그 코드가 places 에 없다면 아래 FK 추가가 실패해 사람이 알게 된다.)
-- =========================================================================
delete from showcase_routes
where (origin_code, destination_code) in (
  ('ICN', 'SEL'),
  ('SEL', 'BSN'),
  ('SEL', 'GW'),
  ('SEL', 'DJN'),
  ('SEL', 'JB')
);

-- =========================================================================
-- 4. FK 전환
-- =========================================================================
alter table showcase_routes
  add constraint showcase_routes_origin_code_fkey
    foreign key (origin_code) references places (code),
  add constraint showcase_routes_destination_code_fkey
    foreign key (destination_code) references places (code);

-- =========================================================================
-- 5. 대표 노선 16행 (스펙 §13.2 그대로, 인천공항→서울만 highlight)
-- =========================================================================
insert into showcase_routes (origin_code, destination_code, price_from, highlight, sort) values
  ('ICN', 'SEL', 400000, true, 1),
  ('SEL', 'BSN', 1200000, false, 2),
  ('SEL', 'DGU', 1000000, false, 3),
  ('SEL', 'TYG', 1300000, false, 4),
  ('SEL', 'PHG', 1200000, false, 5),
  ('SEL', 'JJU', 800000, false, 6),
  ('SEL', 'GWJ', 1000000, false, 7),
  ('SEL', 'YSU', 1200000, false, 8),
  ('SEL', 'HNM', 1200000, false, 9),
  ('SEL', 'DJN', 700000, false, 10),
  ('SEL', 'SJG', 700000, false, 11),
  ('SEL', 'SCH', 800000, false, 12),
  ('SEL', 'GNG', 800000, false, 13),
  ('SEL', 'TBK', 900000, false, 14),
  ('SEL', 'HCN', 700000, false, 15),
  ('SEL', 'WJU', 700000, false, 16)
on conflict (origin_code, destination_code) do nothing;
