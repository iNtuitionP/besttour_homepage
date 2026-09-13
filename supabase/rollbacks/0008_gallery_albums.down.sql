-- 0008_gallery_albums.down.sql — supabase/migrations/0008_gallery_albums.sql 롤백 (수동 실행 전용)
--
-- migrations/ 밖에 두는 이유: CLI 가 migrations/ 의 `^([0-9]+)_(.*)\.sql$` 을 전부 마이그레이션으로 집는다
-- (0005·0007 롤백 헤더 참조). 여기에 두면 db push / db reset 이 롤백까지 적용한다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 실행한 뒤:
--   supabase migration repair --status reverted 0008
--
-- 주의: 이 롤백은 스키마를 **좁힌다**. 앨범 행과 0008 이 더한 컬럼(album_id·width·height·bytes·original_path·created_at)은
-- 되돌릴 곳이 없다 — 컬럼을 drop 하면 그 값은 사라지고, 특히 original_path 를 잃으면 비공개 버킷의 원본이 어느 사진
-- 것인지 알 수 없는 고아 파일이 된다(Storage 객체는 DB 롤백으로 지워지지 않는다). 그래서 아래 가드가 먼저 멈춰 세운다.
-- 데이터를 조용히 지우지 않는다 — 사람이 내보내거나 버릴지 판단한 뒤 가드를 통과시켜야 한다.
--
-- 재실행 가능(idempotent): 성공적으로 한 번 돌린 뒤 다시 돌려도 죽지 않는다. 가드가 보는 테이블·컬럼이
-- 이미 사라졌으면 그 검사를 건너뛴다(to_regclass / information_schema). 0007 롤백의 `drop … if exists` 와 같은 성질이며,
-- 0003·0006 가드가 절대 사라지지 않는 reservations 를 보는 것과 달리 이 롤백은 자기가 보는 대상을 지우기 때문에 필요하다.

begin;

-- =========================================================================
-- 0. 안전장치 — 잃을 데이터가 있으면 멈춘다 (0003·0006 롤백과 같은 규약)
-- =========================================================================
do $$
declare
  albums bigint;
  metas  bigint;
begin
  -- 재실행 대비: 테이블이 이미 없으면 확인할 앨범도 없다.
  if to_regclass('public.gallery_albums') is null then
    raise notice '0008 롤백: gallery_albums 가 이미 없다 — 앨범 가드를 건너뛴다(재실행).';
  else
    select count(*) into albums from gallery_albums;
    if albums > 0 then
      raise exception '0008 롤백 중단: gallery_albums 에 행 % 건 — 앨범 구성이 사라진다. 사람이 판단할 것', albums
        using hint = '앨범 목록을 먼저 내보낸 뒤(select * from gallery_albums) 행을 비우고 다시 실행한다. 여기서 자동으로 지우지 않는다.';
    end if;
  end if;

  -- created_at 을 조건에 포함한다 — 이 롤백이 drop 하는 컬럼과 가드가 보는 컬럼이 어긋나면 안 된다.
  -- created_at 은 default now() 라 사실상 모든 gallery 행이 걸린다. 즉 사진이 한 장이라도 있으면 롤백은 멈춘다 —
  -- 0003 롤백이 reservations 에 행이 하나라도 있으면 멈추는 것과 같은 모양이고, 의도한 결과다.
  -- (drop 된 created_at 은 0001 에 없던 컬럼이라 스키마는 0001 로 정확히 돌아가지만, 업로드 시각 기록은 사라진다.)
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'gallery' and column_name = 'original_path'
  ) then
    select count(*) into metas
      from gallery
     where album_id is not null
        or width is not null
        or height is not null
        or bytes is not null
        or original_path is not null
        or created_at is not null;
    if metas > 0 then
      raise exception '0008 롤백 중단: gallery 에 0008 컬럼 값이 있는 행 % 건 — album_id·width·height·bytes·original_path·created_at 이 함께 사라진다. 사람이 판단할 것', metas
        using hint = '원본 경로(original_path)를 먼저 내보내지 않으면 비공개 버킷의 파일이 고아가 된다. 업로드 시각(created_at)도 함께 내보낸 뒤 해당 컬럼을 비우고 다시 실행한다.';
    end if;
  else
    raise notice '0008 롤백: gallery 에 0008 컬럼이 이미 없다 — 업로드 메타 가드를 건너뛴다(재실행).';
  end if;
end
$$;

-- =========================================================================
-- 1. 정책 — 0001 원문으로 복원
--    gallery 정책이 gallery_albums 를 참조하므로 테이블을 지우기 전에 먼저 되돌린다.
-- =========================================================================
drop policy if exists gallery_select_active on gallery;
create policy gallery_select_active on gallery for select using (active);

-- 앨범 정책은 테이블과 함께 사라지지만, 테이블이 남은 상태로 중단됐을 때를 위해 명시적으로 지운다.
-- `drop policy … on <없는 테이블>` 은 if exists 로도 막히지 않으므로 테이블 존재를 먼저 본다(재실행 대비).
do $$
begin
  if to_regclass('public.gallery_albums') is not null then
    execute 'drop policy if exists gallery_albums_select_active on gallery_albums';
  end if;
end
$$;

-- =========================================================================
-- 2. 인덱스·제약·컬럼 — 0008 이 더한 것만
-- =========================================================================
drop index if exists gallery_album_sort_idx;

alter table gallery drop constraint if exists gallery_width_ck;
alter table gallery drop constraint if exists gallery_height_ck;
alter table gallery drop constraint if exists gallery_bytes_ck;

alter table gallery
  drop column if exists album_id,
  drop column if exists width,
  drop column if exists height,
  drop column if exists bytes,
  drop column if exists original_path,
  drop column if exists created_at;

-- =========================================================================
-- 3. 앨범 테이블 — 위 가드로 0행임이 확인된 상태에서만 여기 도달한다
-- =========================================================================
drop table if exists gallery_albums;

commit;
