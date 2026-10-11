-- 0024_vehicles_admin.down.sql — supabase/migrations/0024_vehicles_admin.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다(0005~0023 롤백 헤더와 같다).
--
-- 🔴 순서: **코드를 먼저 0024 이전으로 되돌린 뒤** 이 파일을 돌린다. 새 코드는 description_ko·image_path 를 SELECT 하므로
--    칸을 먼저 지우면 홈과 /fleet 이 통째로 에러다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0024
--
-- ## 하는 일
-- 0024 의 반대 — definer 함수 다섯을 지우고, CHECK 둘과 칸 둘(description_ko · image_path)을 지운다.
-- 관리자가 그 사이 고친 설명·사진 경로는 **사라진다**(사진 파일은 Storage 에 남는다 — 지우지 않는다).
-- 관리자가 새로 만든 차량 행과 순서·노출 값은 그대로 남는다(0001 칸이다). 새 행은 0001 판에서도 유효하다.
--
-- ## 권한
-- 함수를 지우면 그 ACL 도 함께 사라진다 — 열리는 권한이 없다. 표 ACL 은 0024 가 바꾸지 않았다.
-- 그래서 승인 플래그를 두지 않는다(0022 롤백과 같은 기준: 되돌려도 조용히 위험해지는 것이 없다).
--
-- 재실행: if exists 라 몇 번 돌려도 같다.

begin;

set local lock_timeout = '5s';

drop function if exists admin_create_vehicle(text, text, integer, text, text, boolean);
drop function if exists admin_update_vehicle(integer, text, text, integer, text, text);
drop function if exists admin_set_vehicle_active(integer, boolean);
drop function if exists admin_delete_vehicle(integer);
drop function if exists admin_reorder_vehicles(integer[]);

alter table vehicles drop constraint if exists vehicles_image_path_format;
alter table vehicles drop constraint if exists vehicles_description_ko_len;
alter table vehicles drop column if exists image_path;
alter table vehicles drop column if exists description_ko;

notify pgrst, 'reload schema';

commit;
