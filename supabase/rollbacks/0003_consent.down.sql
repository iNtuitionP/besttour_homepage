-- 0003_consent.down.sql — supabase/migrations/0003_consent.sql 롤백 (수동 실행 전용)
--
-- 이 파일이 migrations/ 가 아니라 rollbacks/ 에 있는 이유: Supabase CLI(2.117.0 확인)는 migrations/ 안의
-- `^([0-9]+)_(.*)\.sql$` 파일을 전부 마이그레이션으로 집는다. migrations/0003_consent.down.sql 로 두면
-- version 0003, name "consent.down" 인 마이그레이션이 되어 db push / db reset 이 롤백까지 적용해 버린다.
--
-- 사고 시 사람이 SQL Editor 또는 psql 로 이 파일을 통째로 실행한 뒤, CLI 이력에서 0003 을 되돌린다:
--
--   supabase migration repair --status reverted 0003
--
-- 되돌리는 순서 (0003 의 역순):
--   1. 제약 3개 제거
--   2. 컬럼 4개 제거
--
-- 주의: 컬럼을 지우면 그 안의 동의 기록(PIPA §22③ 입증 자료)이 함께 사라진다. 0003 적용 후 접수된 행이 있으면
-- 아래 0번 가드가 멈춘다 — 먼저 내보내(export) 보관하고, 그래도 롤백해야 하면 가드 블록을 지우고 실행한다.
-- 이 스크립트는 조용히 지우지 않는다 (0002 롤백과 같은 원칙).

begin;

-- 0. 안전장치 — 행이 있으면 멈춘다 (0003 의 기존 행 가드와 대칭)
do $$
declare
  n bigint;
begin
  if exists (select 1 from reservations) then
    select count(*) into n from reservations;
    raise exception '0003_consent.down: reservations 에 행 % 건 — 롤백하면 동의 기록(입증 자료)이 사라진다. 먼저 내보내고 사람이 판단할 것', n;
  end if;
end
$$;

-- 1. 제약 제거
alter table reservations
  drop constraint if exists reservations_consent_before_created,
  drop constraint if exists reservations_consent_not_stale,
  drop constraint if exists reservations_retention_after_created;

-- 2. 컬럼 제거
alter table reservations
  drop column if exists privacy_consent_at,
  drop column if exists privacy_policy_version,
  drop column if exists marketing_consent_at,
  drop column if exists retention_until;

commit;
