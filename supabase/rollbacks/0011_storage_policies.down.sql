-- 0011_storage_policies.down.sql — supabase/migrations/0011_storage_policies.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005·0007·0008·0009 롤백 헤더 참조). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0011
--
-- 이 롤백이 하는 일: 0011 이 더한 정책 8개를 지운다. **그게 전부다.**
--   · 파일을 지우지 않는다 — storage.objects 의 행 하나가 곧 사장님이 올린 사진 한 장이다. 정책을 되돌리는 것과
--     사진을 버리는 것은 완전히 다른 결정이고, 후자는 되돌릴 수 없다. 이 파일에 `delete from storage.objects` 는 없다.
--   · 버킷도 지우지 않는다 — 버킷을 지우면 그 안의 객체가 전부 사라진다. 버킷은 컨트롤러가 손으로 만들었고
--     0011 이 만든 적이 없으므로 롤백의 대상도 아니다.
--   · gallery·gallery_albums 표와 0009 의 정책·함수(is_admin)도 건드리지 않는다 — 0011 이 만든 것이 아니다.
--
-- 롤백 뒤의 상태: 관리자 세션은 두 버킷에 올리지도 지우지도 못하고, 이미 올라간 사진은
-- `/storage/v1/object/public/gallery/...` 로 계속 보인다(그 라우트는 storage-api 가 asSuperUser 로 처리한다 — 정책과 무관).
-- 즉 이미 올라간 사진은 홈에서 그대로 보이고, 새 업로드만 막힌다. 되돌리기의 대가가 "사진이 사라진다"가 아니라
-- "당분간 못 올린다"가 되도록 설계한 것이다.
--
-- 재실행 가능(idempotent): drop policy if exists 뿐이라 몇 번을 돌려도 같다. storage.objects 가 없는 DB 에서도
-- 죽지 않도록 대상 표의 존재를 먼저 본다.

begin;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice '0011 롤백: storage.objects 가 없다 — 지울 정책도 없다(재실행 또는 스토리지 미설치).';
    return;
  end if;

  drop policy if exists storage_gallery_admin_read on storage.objects;
  drop policy if exists storage_gallery_admin_insert on storage.objects;
  drop policy if exists storage_gallery_admin_update on storage.objects;
  drop policy if exists storage_gallery_admin_delete on storage.objects;
  drop policy if exists storage_originals_admin_read on storage.objects;
  drop policy if exists storage_originals_admin_insert on storage.objects;
  drop policy if exists storage_originals_admin_update on storage.objects;
  drop policy if exists storage_originals_admin_delete on storage.objects;
end
$$;

commit;
