-- 0002_places.down.sql — supabase/migrations/0002_places.sql 롤백 (수동 실행 전용)
--
-- 이 파일이 migrations/ 가 아니라 rollbacks/ 에 있는 이유: Supabase CLI(2.117.0 바이너리와
-- apps/cli-go/pkg/migration/file.go 에서 확인)는 migrations/ 안의 `^([0-9]+)_(.*)\.sql$`
-- 파일을 전부 마이그레이션으로 집는다. migrations/0002_places.down.sql 로 두면 version 0002,
-- name "places.down" 인 마이그레이션이 되어 db push / db reset 이 롤백까지 적용해 버린다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 이 파일을 통째로 실행한 뒤, CLI 이력에서 0002 를 되돌린다:
--
--   supabase migration repair --status reverted 0002
--
-- 되돌리는 순서 (0002 의 역순):
--   1. 0002 가 넣은 showcase_routes 16행 삭제
--      ← CHECK 복원(3) 보다 먼저여야 한다. 새 도시 코드(TYG 등)는 17개 시도 코드 CHECK 에 걸린다.
--   2. FK 2개 제거
--   3. 0001 의 익명 CHECK 2개를 이름 붙여 복원 (목록은 0001 과 동일한 17개 시도 코드)
--   4. 0001 자리표시자 5행 복원 (price_from NULL)
--   5. places RLS 정책·테이블 drop
--
-- 주의: 0002 이후 admin 에서 추가된 노선(17개 시도 코드 밖의 places 코드를 쓰는 행)이
-- 있으면 3단계 CHECK 복원이 실패하고 트랜잭션 전체가 롤백된다. 그 행들은 사람이
-- 먼저 판단해 처리해야 한다 — 이 스크립트는 조용히 지우지 않는다.

begin;

-- 1. 0002 시드 16행 삭제 (쌍 지정 — 전체 삭제 아님)
delete from showcase_routes
where (origin_code, destination_code) in (
  ('ICN', 'SEL'),
  ('SEL', 'BSN'),
  ('SEL', 'DGU'),
  ('SEL', 'TYG'),
  ('SEL', 'PHG'),
  ('SEL', 'JJU'),
  ('SEL', 'GWJ'),
  ('SEL', 'YSU'),
  ('SEL', 'HNM'),
  ('SEL', 'DJN'),
  ('SEL', 'SJG'),
  ('SEL', 'SCH'),
  ('SEL', 'GNG'),
  ('SEL', 'TBK'),
  ('SEL', 'HCN'),
  ('SEL', 'WJU')
);

-- 2. FK 제거
alter table showcase_routes
  drop constraint if exists showcase_routes_origin_code_fkey,
  drop constraint if exists showcase_routes_destination_code_fkey;

-- 3. 0001 의 CHECK 복원 (0001 은 익명 인라인 제약이었고 Postgres 기본 이름이
--    showcase_routes_<column>_check 였다. 같은 이름으로 명시 복원한다.)
alter table showcase_routes
  add constraint showcase_routes_origin_code_check check (origin_code in (
    'ICN','SEL','BSN','INC','DGU','GWJ','DJN','ULS','GG','GW','CN','CB','GB','GN','JN','JB','JJ'
  )),
  add constraint showcase_routes_destination_code_check check (destination_code in (
    'ICN','SEL','BSN','INC','DGU','GWJ','DJN','ULS','GG','GW','CN','CB','GB','GN','JN','JB','JJ'
  ));

-- 4. 0001 자리표시자 5행 복원 (0001_init.sql 64~70행과 동일)
insert into showcase_routes (origin_code, destination_code, price_from, highlight, sort) values
  ('ICN', 'SEL', null, true, 1),
  ('SEL', 'BSN', null, false, 2),
  ('SEL', 'GW', null, false, 3),
  ('SEL', 'DJN', null, false, 4),
  ('SEL', 'JB', null, false, 5)
on conflict (origin_code, destination_code) do nothing;

-- 5. places 제거
drop policy if exists places_select_active on places;
drop table if exists places;

commit;
