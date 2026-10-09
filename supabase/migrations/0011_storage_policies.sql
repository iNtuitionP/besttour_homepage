-- 0011_storage_policies.sql — 갤러리 스토리지 RLS (플랜 v4 P6-2 · ADR-2·ADR-9 · 스펙 §13.9 (4))
--
-- 왜: 사장님이 폰 원본(3~5MB, 상한 20MB)을 30장까지 한 번에 올린다. 그 본문이 서버를 통과할 수 없다 —
-- Server Action 본문은 기본 1MB, Vercel 요청은 4.5MB 에서 잘린다(ADR-9). 그래서 브라우저가 Storage 로 직접 올린다.
--
-- **ADR-9 의 수단을 바꾼다: signed URL → storage.objects 정책.**
--   ADR-9 원문은 "signed URL 직업로드"라고 적었지만, signed URL(`createSignedUploadUrl`)을 만들려면 **서비스 롤**이
--   필요하다. 그런데 ADR-2 와 scripts/check-admin-no-service-role.sh 는 관리자 경로의 서비스 롤을 금지한다 —
--   서비스 롤은 RLS 를 우회하므로 방어선이 requireAdmin() 호출 하나로 줄어들기 때문이다.
--   두 규칙을 동시에 지키는 길은 하나뿐이다: `storage.objects` 에 `is_admin()` 정책을 걸고 브라우저가
--   **관리자 자신의 세션(anon 키 + 쿠키의 JWT)** 으로 직접 올린다. 서버를 거치지 않으므로 본문 한계는 그대로 피하고,
--   권한 판정은 0009 의 명단 표(admin_users)와 같은 한 곳에서 난다. 목적은 지키고 수단만 바꾼 것이다.
--
-- 버킷은 이 파일이 만들지 않는다. 컨트롤러가 2026-09-14 에 원격 프로젝트에 만들어 뒀다:
--   gallery            public   20MB  image/jpeg·png·webp·heic·heif   — 변환본(1600px WebP)만 들어간다
--   gallery-originals  private  20MB  같음                            — 폰 원본만 들어간다
-- 로컬 스택(CI db-test)의 같은 버킷 두 개는 supabase/config.toml [storage.buckets.*] 이 만든다.
-- **버킷을 SQL 로 만들지 않는 이유**: storage.buckets 에 직접 insert 하면 대시보드가 아는 메타(파일 크기 상한·
-- 허용 MIME)와 어긋날 수 있고, 무엇보다 이 파일이 원격에서 다시 돌 때 기존 버킷 설정을 덮어쓸 위험이 있다.
--
-- 정책 8개 = 버킷 2개 × 동작 4종. 이름에 `storage_` 접두사를 붙여 Supabase 기본 정책·대시보드가 만든 정책과 섞이지 않게 하고,
-- 전부 `drop policy if exists` 를 앞세워 재실행해도 같은 결과가 되게 한다(0009 와 같은 규약).
--
-- **여덟 개 전부 `to authenticated` + `is_admin()` 이다. anon 에게 열어 주는 정책은 하나도 없다.**
-- 처음 초안은 공개 버킷의 select 를 `to anon, authenticated` 로 열었다가 P6-2 독립 리뷰(M1)에서 되돌렸다.
-- `storage.objects` 의 select 는 파일을 내려받는 권한이 아니라 **객체 목록을 읽는 권한**(`/object/list/<bucket>`)이다 —
-- 열어 두면 누구나 공개 버킷의 **모든 키를 열거**할 수 있고, 거기에는 사장님이 노출을 꺼 둔 사진도 그대로 들어 있다
-- (노출 여부는 gallery 행의 active 이지 객체의 성질이 아니다).
-- 공개 렌더에는 이 권한이 **필요 없다**: 방문자의 이미지는 `/storage/v1/object/public/<bucket>/<key>` 로 나가고,
-- 그 라우트는 storage-api 가 `asSuperUser()` 로 처리한다(버킷의 public 플래그만 본다 — RLS 를 평가하지 않는다).
--   실측 2026-09-15, 정책이 하나도 없는 원격 프로젝트 상태에서:
--     GET /object/public/gallery/<없는키>            → {"error":"not_found","code":"NoSuchKey"}   ← 라우트는 살아 있다
--     GET /object/public/gallery-originals/<없는키>  → {"error":"Bucket not found"}                ← 비공개 버킷은 이 길로 못 나온다
--     POST /object/list/gallery (anon)               → []                                          ← select 정책이 없으면 열거가 막힌다
--
-- `to authenticated` 를 빼지 않는 이유도 그대로다: 빼면 anon 요청도 정책을 평가하는데 anon 에게는 is_admin() 실행 권한이
-- 없어(0009 가 revoke 했다) "permission denied for function is_admin" 이 난다.
--
-- 기존 행 영향: 정책 8개를 더할 뿐이다(표·컬럼·데이터 변경 0, 파일 변경 0).
-- 롤백: supabase/rollbacks/0011_storage_policies.down.sql — 정책만 지운다. 파일도 행도 버킷도 건드리지 않는다.
-- 번호: 0010 은 P5-3 예약 액션이 선점했고 이 파일이 0011.

-- =========================================================================
-- 0. 전제 — storage.objects 에 RLS 가 켜져 있는가
--    Supabase 는 기본으로 켜 둔다. 그런데 꺼져 있으면 아래 정책 8개는 **아무것도 막지 않는다**
--    (RLS 가 꺼진 표의 정책은 평가되지 않는다) — 잠근 줄 알고 열려 있는 상태가 가장 나쁘다.
--    조용히 통과시키지 않고 여기서 멈춘다.
-- =========================================================================
do $$
begin
  if to_regclass('storage.objects') is null then
    raise exception 'storage.objects 가 없다 — Storage 확장이 설치되지 않은 DB 다. 버킷·스토리지를 먼저 준비할 것';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects 에 RLS 가 꺼져 있다 — 정책을 걸어도 아무것도 막지 못한다. 먼저 RLS 를 켤 것';
  end if;
end $$;

-- =========================================================================
-- 1. gallery (공개 버킷) — 객체 목록·쓰기 모두 관리자만
--    "공개 버킷"이 뜻하는 것은 `/object/public/...` 로 **한 장씩 지정해서** 내려받을 수 있다는 것뿐이다(위 실측).
--    무엇이 들어 있는지 **훑어보는 것**(select = list)은 별개의 권한이고, 그것까지 열면 내려 둔 사진의 키가 노출된다.
--    들어가는 것은 브라우저가 canvas 로 만든 1600px WebP 변환본뿐이다 — 원본은 아래 비공개 버킷으로 간다.
-- =========================================================================
drop policy if exists storage_gallery_admin_read on storage.objects;
create policy storage_gallery_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'gallery' and is_admin());

drop policy if exists storage_gallery_admin_insert on storage.objects;
create policy storage_gallery_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gallery' and is_admin());

-- update 가 필요한 이유: 같은 키에 다시 올리는 것(upsert)과 이동이 UPDATE 다. 업로더는 upsert 를 쓰지 않지만,
-- 정책이 없으면 실수로 같은 키가 겹쳤을 때 무슨 일이 벌어지는지가 드라이버 구현에 달리게 된다.
drop policy if exists storage_gallery_admin_update on storage.objects;
create policy storage_gallery_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'gallery' and is_admin())
  with check (bucket_id = 'gallery' and is_admin());

drop policy if exists storage_gallery_admin_delete on storage.objects;
create policy storage_gallery_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gallery' and is_admin());

-- =========================================================================
-- 2. gallery-originals (비공개 버킷) — 읽기까지 관리자만
--    §13.9 (4) "원본 보관, 공개 노출은 변환본만". 원본에는 폰이 심은 EXIF(촬영 위치·기기)가 그대로 남아 있고,
--    그것이 공개되면 사장님의 이동 경로가 공개되는 것과 같다. 그래서 select 도 is_admin() 이다.
-- =========================================================================
drop policy if exists storage_originals_admin_read on storage.objects;
create policy storage_originals_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'gallery-originals' and is_admin());

drop policy if exists storage_originals_admin_insert on storage.objects;
create policy storage_originals_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gallery-originals' and is_admin());

drop policy if exists storage_originals_admin_update on storage.objects;
create policy storage_originals_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'gallery-originals' and is_admin())
  with check (bucket_id = 'gallery-originals' and is_admin());

drop policy if exists storage_originals_admin_delete on storage.objects;
create policy storage_originals_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'gallery-originals' and is_admin());
