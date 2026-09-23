# 마이그레이션 원격 적용 런북

원격(호스팅 Supabase)에는 **실고객 데이터**가 있다. 여기 적용하는 것은 되돌리기 어렵다.
그래서 적용은 **컨트롤러만** 하고, 아래 순서를 건너뛰지 않는다.

## 순서
1. 로컬 스택(`supabase db reset`)에 적용하고 **DB 테스트 전량**이 통과한다.
2. **CI 가 green** 이다(푸시된 커밋 기준). red 인 채로 원격에 적용하지 않는다.
3. 아래 **적용 전 확인**을 로컬에서 실행해 기대값과 일치하는지 본다.
4. 원격에 적용한다 — **`supabase db push` 로만**(아래 「적용 경로」). 적용 직후 이력 마지막이 `0021` 인지 본다.
5. 같은 확인을 **원격에서** 다시 실행해 로컬과 같은 결과인지 대조한다.
6. 결과를 이 파일에 날짜와 함께 적는다.

### 🔴 적용 직전 필수 — 공통 (P5-15 R5)
**① 원격 적용 이력** — 무엇이 이미 원격에 들어갔는지 먼저 읽는다(읽기 질의):
```sql
select version, name from supabase_migrations.schema_migrations order by version;
```
기대(**2026-09-21 0012~0020 적용 완료 기준**): 마지막이 `0020`. **`0021` 이 이미 있으면 멈추고 컨트롤러에게 보고한다.**
⚠️ **이미 원격에 적용된 파일을 고쳐도 `supabase db push` 는 그 파일을 다시 돌리지 않는다**(이력에 있는 버전은 건너뛴다). P5-15 가 0016·0017·0018·0019 본문을 고친 것은 **네 파일 모두 원격 미적용**이라는 전제 위의 일이었다 — **그 전제는 2026-09-21 로 끝났다.** 0012~0019 는 원격에 들어갔으므로 그 여덟 파일은 이제 **고치지 않는다**. 수정분은 **새 번호의 마이그레이션**으로 낸다(P5-16 이 0020 을 그렇게 냈다).
**② 원격 PostgreSQL 버전** — 0019 절 "적용 직전 필수 — 원격 버전 확인".
**③ 이벤트 트리거** — 0019 절 "적용 직전 필수 — 이벤트 트리거 확인"(0017·0018·0019·**0020** 의 일회용 객체 생성이 CREATE TABLE·CREATE TRIGGER·CREATE SEQUENCE 태그를 낸다. 0020 은 함수 18개도 만든다 — `pgrst_ddl_watch` 가 스키마 캐시를 갱신해야 관리자 화면이 새 RPC 를 찾는다. **0021** 은 `reservations` 에 칸 둘을 더하고(ALTER TABLE) 트리거 함수·트리거를 만들며(CREATE FUNCTION · CREATE TRIGGER) 자기검증이 임시 표와 그 트리거를 만든다(CREATE TABLE · CREATE TRIGGER) — 스키마 캐시가 새 칸을 알아야 접수 insert 가 PGRST204 로 실패하지 않는다).
**④ 0018 절의 적용 직전 스냅샷**(시퀀스·표 `relacl`) — 롤백 판단에 필요하다.
**⑤ 0020 은 코드 배포와 짝이다** — 0020 절 「배포 순서」. **적용 → 배포** 순서를 어기면 관리자 화면의 저장이 전부 실패한다.
**⑥ 0021 도 코드 배포와 짝이다** — 0021 절 「환경별 순서」. **환경마다 적용 → 배포**(시험 DB → 프리뷰 → 운영 DB → 운영 배포). 적용 뒤 옛 코드가 접수를 받으면 그 접수는 23514 로 실패하고, 새 코드를 먼저 배포하면 칸이 없어 접수가 PGRST204 로 실패한다.

### 🔴 적용 경로 — `supabase db push` 하나 (P5-15 R6 · 컨트롤러 결정 2026-09-17)
- 🔴 **2026-09-21 부터: 시험 프로젝트(`gjnieoojgmhulkohdcnl`)에 먼저, 운영에 나중.** 시험 프로젝트가 생겼다(`docs/ops/environments.md`). 새 마이그레이션은 CI green 뒤 **시험 프로젝트에 `db push --db-url` 로 먼저** 적용하고, 자기검증 통과·프리뷰 정상을 본 뒤 운영에 아래 절차대로 적용한다. 저장소의 `supabase link` 는 운영을 가리키므로 **시험 프로젝트로 다시 link 하지 않는다.**
- **0012~0022 의 원격 적용 경로는 `supabase db push` 하나다.** CLI 는 마이그레이션 파일 하나를 한 트랜잭션으로 돌리고, 성공한 버전을 `supabase_migrations.schema_migrations` 에 기록한다.
- **SQL Editor 는 읽기 확인 전용이다** — 적용 전·후 행렬, 이력 조회처럼 카탈로그를 읽는 질의만 붙인다. **마이그레이션 본문을 SQL Editor 에 붙여 적용하지 않는다**: 그러면 이력이 남지 않아, 다음 `supabase db push` 가 **같은 마이그레이션을 다시 돌린다**(두 번 도는 것을 전제로 검토한 파일이 아니다).
- **`psql -f` 도 쓰지 않는다**(리뷰 K1 — 파일이 원자적이지 않다. 이력도 남지 않는다).
- 🔴 **적용 직후 필수 — 이력 확인**(읽기 질의):
  ```sql
  select version, name from supabase_migrations.schema_migrations order by version;
  ```
  기대: 적용 전 목록 뒤에 이번에 적용한 버전이 한 줄씩 붙고, 저장소의 마지막 마이그레이션과 같은 번호로 끝난다 — 지금은 **마지막이 `0022`**(P5-17 이 `0021` 뒤에 더했다). 한 줄이라도 빠졌거나 마지막이 `0022` 가 아니면 **멈추고 컨트롤러에게 보고한다**(`db push` 는 실패한 파일에서 멈추고 그 뒤 버전을 돌리지 않는다 — 어디서 멈췄는지가 이 목록에 보인다). (2026-09-21 의 첫 적용에서는 `0011` 뒤에 `0012`~`0019` 여덟 줄이, 두 번째 적용에서는 `0020` 한 줄이 붙는 것이 기대였고 그대로 됐다 — 맨 아래 「원격 적용 기록」.)
- **예외 — 이미 수동 적용(SQL Editor·psql)을 해 버렸다면**: 본문이 실제로 전부 적용됐는지 해당 절의 행렬로 먼저 확인한 뒤, `supabase migration repair --status applied <번호>` 로 이력을 맞춘다 — **이 경로는 컨트롤러 승인이 있을 때만 쓴다.** `repair` 는 이력만 고치고 본문을 돌리지 않으므로, 적용되지 않은 버전을 `applied` 로 적으면 그 마이그레이션은 **영영 건너뛰어진다**.
- **잠금 대기 상한 — 파일 안의 `set local lock_timeout = '5s';`** (P5-15 R7 · 컨트롤러 결정): 0012 이후 파일(0012~0022, 열한 개) 모두 **첫 실행문**이 이것이고, 둘째 실행문이 **그 시점에 `lock_timeout` 이 실제로 `5s` 인지**만 확인한다 — 아니면 아무것도 바꾸기 전에 멈춘다. ⚠️ 이 확인은 **원자성을 증명하지 않는다**(astra R7 P2-b): 자동 커밋 세션이라도 서버·롤·DB 기본값이 이미 5초면 통과한다. 잡아 주는 것은 "`set local` 이 그 문장에서 끝나 설정이 남지 않은 경우"(예: 기본값이 5초가 아닌 서버에서 `psql -f`)뿐이다. **파일 하나가 한 트랜잭션이라는 보장은 적용 경로(`supabase db push`)에서 오고**, 아래 실측이 그것을 확인한 것이다. CLI 는 파일 하나를 한 트랜잭션으로 보내므로 이 설정은 **그 파일에만** 걸리고 다음 파일로 새지 않는다. 어떤 문장이 잠금을 5초 넘게 기다리면 `ERROR: canceling statement due to lock timeout (SQLSTATE 55P03)` 로 그 파일이 실패한다 — 접수 트랜잭션을 줄 세우지 않는다.
- **부분 적용 — push 전체는 원자적이지 않다**: 한 파일이 시간 초과(또는 다른 오류)로 실패하면 **앞 파일들은 커밋·기록된 채 남고**, **그 파일은 롤백되며**(이력에도 없다), 뒤 파일은 돌지 않는다. 막던 세션이 끝난 뒤 **다음 `supabase db push` 가 그 파일부터** 이어서 적용한다. 시간 초과는 **멈추고 보고할 일**이다 — 수동 적용이나 `repair` 로 건너뛰지 않는다. 어디서 멈췄는지는 적용 직후 이력 확인이 보여 준다.
- **실측** (2026-09-17 · supabase CLI 2.117.0 · 로컬 전용 `--db-url postgresql://…@127.0.0.1:…`):
  - 합성 마이그레이션(PG 15.17 일회용 컨테이너 · PG 17.6 로컬 스택의 일회용 DB 둘 다): 한 파일의 행들이 **같은 xid**, `set local` 뒤 `lock_timeout=5s`, 다음 파일에서는 `0`(새지 않음). 다른 세션이 표를 쥔 채 push → 약 5초 뒤 `55P03` · 그 파일의 표·행·이력 없음 · 앞 파일 이력 유지 → 풀린 뒤 push 가 그 파일부터 재개. 대조군(`set local` 없음)은 잠금이 풀릴 때까지 **기다렸다**(20초 잡음 → 20초 걸림).
  - **실제 0012~0019** (로컬 스택: 롤백 → 로컬 이력 `reverted` → push): 다른 세션이 `gallery_albums` 에 ROW EXCLUSIVE(쓰기 중인 트랜잭션과 같은 잠금)를 쥔 상태에서 `0012`·`0013`·`0014` 적용·기록, **`0015` 의 CREATE TRIGGER 가 55P03** 으로 파일째 롤백(트리거 0 · 이력 0014 까지) → 풀린 뒤 push 가 `0015`~`0019` 적용 · 이력 0019 까지 · 사실 스냅샷이 이전 적용 상태와 동일. 오류의 `At statement: 3`(0부터 셈)은 `set local` · 확인 DO · 트리거 함수 다음의 CREATE TRIGGER 다 — 확인 DO 가 CLI 배치에서 통과했다는 뜻이다.
  - 부수 관찰: 이력에 **더 뒤 번호가 이미 있으면** push 는 `Found local migration files to be inserted before the last migration on remote database` 로 아무것도 적용하지 않는다(`--include-all` 요구). 원격 이력의 마지막은 `0011` 이어야 하므로(① 확인) 정상 경로에서는 나오지 않는다 — 나오면 멈추고 보고한다(`--include-all` 을 임의로 붙이지 않는다).
  - 서버 로그에는 `WARNING: SET LOCAL can only be used in transaction blocks` 가 남는다 — CLI 가 파일을 명시적 `BEGIN` 없이 **확장 프로토콜 배치 하나**로 보내기 때문이다. 그래도 설정은 배치(= 한 트랜잭션) 끝까지 유효했다(위 xid·`lock_timeout` 실측). 전제가 깨졌을 때 둘째 실행문이 잡아 주는 범위는 위 ⚠️ 와 같다 — 기본값이 5초가 아닌 서버에서 설정이 남지 않은 경우다.
  - 같은 이유로 **최상위 `LOCK TABLE` 은 CLI 에서 `25P01 LOCK TABLE can only be used in transaction blocks`** 로 거부된다(실측). 0012~0019 에는 최상위 LOCK 이 없다(0019 의 LOCK 은 DO 블록 안의 동적 SQL).
- 자기검증의 거동 탐침(0017 ⑦ · 0018 ⑤ · 0019 ⑥)은 **42501 만 거부 성공으로 친다** — 55P03 으로 실패하면 "권한 거부가 아닌 이유로 실패했다" 로 멈춘다(깨뜨리기 실측, 아래 각 절).

### 🔴 적용 창 운영 규칙 (P5-15 R5 · 컨트롤러 결정 2026-09-17)
- **적용하는 동안 대시보드·다른 세션에서 스키마 변경(DDL)과 권한 변경을 하지 않는다.** 적용 트랜잭션과 서로 기다리게 된다.
- **적용은 접수가 적은 시간대에 한다.** 자기검증은 실제 표·시퀀스에 잠금을 잡는 탐침을 치지 않도록 고쳤지만(0017 ⑦ · 0018 ⑤ · 0019 ⑥), 마이그레이션 본문 자체의 잠금 대기는 남는다(아래).
- **최상위 `REVOKE` 도 `pg_class` 튜플 잠금을 기다릴 수 있다.** 로컬 실측(다른 세션이 `alter sequence public.notifications_log_id_seq cache 1` 을 커밋하지 않고 쥔 상태 · `lock_timeout 3s`): 0018 의 최상위 `revoke … on sequence` 만 돌려도 `ERROR: canceling statement due to lock timeout` · `CONTEXT: while updating tuple (39,29) in relation "pg_class"`. 권한을 바꾸는 모든 마이그레이션의 성질이다. 그동안 그 시퀀스의 앱 `nextval` 은 ALTER 세션의 SHARE ROW EXCLUSIVE 에 막힌다.
- 잠금 대기는 각 파일의 `set local lock_timeout = '5s'` 가 5초로 자른다(위 「적용 경로」 · P5-15 R7). 위 두 규칙은 그 시간 초과가 **나지 않게** 하는 운영 조건이다. 시간 초과로 push 가 멈추면 대시보드에서 `pg_stat_activity` 의 `wait_event_type = 'Lock'` 을 **읽어** 막던 세션을 확인하고 컨트롤러에게 보고한 뒤, 그 세션이 끝나면 다시 push 한다(그 파일부터 재개).
- 로컬 실측(P5-15 R7): 다른 세션이 `notifications_log_id_seq` 를 ALTER 중일 때 0018 을 `psql -1` 로 적용 → 5.8초 뒤 `canceling statement due to lock timeout` · `while updating tuple … in relation "pg_class"`. 실제 표 셋(reservations·notifications_log·gallery)이 ACCESS EXCLUSIVE 로 잡힌 상태에서도 0019 는 0.8초에 끝났다 — 탐침은 권한 검사에서 먼저 거부되어 잠금을 기다리지 않는다.

**롤백 파일은 `supabase/rollbacks/` 에 있고 `migrations/` 밖이다** — CLI 가 `migrations/` 의 `^[0-9]+_.*\.sql$` 을 전부 마이그레이션으로 집기 때문이다. 롤백은 사람이 psql/SQL Editor 로 실행한 뒤 `supabase migration repair --status reverted <번호>`.
0012·0013·0014·0015·0016·0017·0018·0019 롤백은 **승인 플래그를 조건 없이 요구**한다(`set bestour.rollback_00NN_ack = '1';`). 행이 0이어도 멈춘다 — 권한은 열린 채 남고 데이터는 나중에 들어오기 때문이다.
0020·0021 롤백도 같다. 0021 은 **쓰기 잠금을 쥔 뒤에** 확인 기록을 세고, 한 건이라도 있으면 **내보냄 확인 플래그**(`bestour.rollback_0021_evidence_exported`)를 추가로 요구한다 — 0021 절 「롤백」.
**0022 롤백만 플래그가 없다** — 같은 기준("실행한 뒤의 세계가 조용히 위험한가")을 적용한 결과다: 되돌려도 열리는 권한이 없고(함수 하나를 지울 뿐이다), 고장이 조용하지 않으며(통계 탭이 곧바로 PGRST202), 데이터가 사라지지 않는다. 근거는 0022 절 「롤백」과 그 파일 헤더.

---

## 0012 · 0013 — 쓰기 권한 회수 (**원격 적용 완료 2026-09-21**)

**무엇을 하나**: Supabase 가 public 스키마 표에 `anon`·`authenticated` 로 기본 부여한 쓰기 권한을 회수한다. 회수하지 않으면 **RLS 가 유일한 방어선**이 된다(같은 뿌리로 세 번 재발했다).
- `0012` — `notifications_log` 에서 insert/update/delete/truncate, `reservations` 에서 insert/delete/truncate 를 **anon·authenticated** 에서 회수(reservations 의 UPDATE 는 0010 이 이미 회수).
- `0013` — 콘텐츠 7표(`notices`·`popups`·`gallery`·`gallery_albums`·`showcase_routes`·`vehicles`·`places`)에서 insert/update/delete/truncate 를 **anon 에서만** 회수. `authenticated` 는 관리자 화면이 실제로 쓰므로 건드리지 않는다.

**정상 경로가 막히지 않는 이유**: 공개 접수·아웃박스 적재·파기 크론은 **서비스 롤**이고, 예약 상태 전이는 0005·0007·0010 의 **security definer 함수**라 소유자 권한으로 돌아 grant 와 무관하다.

### 적용 전 확인 — 로컬 실측 (2026-09-15, 컨트롤러)

```
docker exec supabase_db_besttour-homepage psql -U postgres -d postgres -At -c "<아래 질의>"
```

| # | 확인 | 기대 | 로컬 결과 |
|---|---|---|---|
| ① | `has_table_privilege('authenticated','public.reservations','update')` | `false` | **false** ✅ |
| ② | `reservations`·`notifications_log` 의 grantee 집합 | `anon,authenticated,postgres,service_role` **4행뿐 · PUBLIC 없음** | 두 표 모두 정확히 그 4행 ✅ |
| ③ | 콘텐츠 7표의 `authenticated` CRUD 생존 | 7표 전부 `select,insert,update,delete` | 7표 전부 4종 ✅ |
| ④ | 회수 반대편 — `anon` 이 9표에서 갖는 권한 | **`select` 뿐** | 9표 전부 `select` 만 ✅ |
| ⑤ | `authenticated` 가 두 개인정보 표에서 갖는 권한 | **`select` 뿐** | 두 표 모두 `select` 만 ✅ |

②가 중요한 이유: **표 단위 `revoke` 는 `PUBLIC` 롤의 grant 를 지우지 못한다.** PUBLIC 에 권한이 남아 있으면 anon 이 그것을 상속해, 회수한 것처럼 보이는데 실제로는 열려 있다. 0012·0013 의 자기검증 블록이 이 경우를 `hint` 에서 첫 번째 원인으로 지목한다.

**질의 원문** (①~⑤를 그대로 재현할 수 있게 남긴다):
```sql
-- ①
select has_table_privilege('authenticated','public.reservations','update');

-- ②
select table_name, string_agg(distinct grantee, ',' order by grantee)
from information_schema.role_table_grants
where table_schema='public' and table_name in ('reservations','notifications_log')
group by table_name;

-- ③④⑤ (롤·표 목록만 바꿔 쓴다)
select t, string_agg(p, ',' order by p)
from (
  select t, p from unnest(array['notices','popups','gallery','gallery_albums','showcase_routes','vehicles','places']) t
  cross join unnest(array['select','insert','update','delete','truncate']) p
  where has_table_privilege('authenticated','public.'||t, p)
) s group by t order by t;
```

### ⚠️ 위 ②번 확인은 생각만큼 강하지 않다 (외부 모델 크로스체크, 2026-09-16)

OpenAI Codex 에 적용 직전 검토를 받았고 **P1 은 나오지 않았다**(적용을 막을 문제 없음). 다만 **내 확인 방법 중 하나가 틀렸다**:

`information_schema.role_table_grants` 는 **완전한 ACL 목록이 아니다.** grantor·grantee 가 "활성화된 롤" 인 항목만 보여주는 **필터된 뷰**다.
따라서 **"이 뷰에 PUBLIC 이 없다" 는 "PUBLIC 에 권한이 없다" 의 증명이 아니다.** 제대로 보려면 `pg_class.relacl` 을 `aclexplode()` 로 풀고 **grantee OID = 0**(PUBLIC)을 찾아야 한다.

다행히 **②가 무너져도 결론은 유지된다** — ④⑤의 `has_table_privilege` 검사는 **PUBLIC 과 상속된 표 권한까지 실제로 잡아내기** 때문이다. 즉 강한 증거는 ④⑤이고 ②는 보조였다. 그래도 남는 구멍 둘:

- **"select 뿐" 은 "질의한 다섯 가지 중 select 뿐" 이라는 뜻이다.** `REFERENCES`·`TRIGGER` 는 그대로 남아 있다(의도적으로 남겼다).
- **컬럼 단위 grant 는 `has_table_privilege` 가 못 본다.** 표 단위 revoke 가 직접 부여된 컬럼 grant 는 함께 지우지만, **PUBLIC 이나 다른 롤을 통해 상속된 컬럼 grant 는 살아남는다.** `has_any_column_privilege(role, table, 'insert')`·`'update'` 검사를 추가해야 한다.

또 하나 정정: `0012` 가 `TRIGGER` 를 남긴 근거로 "스키마 CREATE 권한이 없어 쓸 수 없다" 고 적었는데 **그 이유는 성립하지 않는다.** `CREATE TRIGGER` 는 표의 TRIGGER 권한과 **이미 존재하는** 트리거 함수의 EXECUTE 만 요구한다 — 함수를 새로 만들 필요도, 스키마 CREATE 도 필요 없다. 공개 경로로 임의 `CREATE TRIGGER` 를 칠 방법은 못 찾았으므로 실exploit 은 아니지만, **적어 둔 이유가 틀렸다.**

### 적용 **전** 원격 점검 (Codex 권고 — 로컬 성공은 원격 사실을 증명하지 못한다)

로컬에서만 재고 원격은 적용 **후에** 보는 순서였는데, 그러면 이미 늦다. 그래서 적용 전에 원격 스키마를 떠서(`supabase db dump --linked`, **데이터 없이 스키마만**) 아래를 실측했다.

| 확인 | 결과 (2026-09-16, 원격 `expexkhcuogkavpacrem`) |
|---|---|
| 마이그레이션 이력 | 0001~0011 적용됨, **0012·0013 대기** — 로컬과 일치 |
| 9표에 PUBLIC 대상 GRANT | **없음** |
| 컬럼 단위 GRANT | **없음** |
| public 스키마의 뷰 | **없음** (보안 우회 경로 없음) |
| 트리거 | **없음** |
| 9표 소유자 | 전부 `postgres` |
| definer 함수 9개 소유자 | 전부 `postgres` |
| 함수 EXECUTE | 아웃박스 4종 → `service_role` · 관리자 전이 4종 → `authenticated` · `is_admin` → `authenticated`+`service_role`. **의도와 일치** |
| RLS 활성 표 | 10 |

### 🔴 이번에 찾은 뿌리 — 네 번 반복된 이유

원격에 이것이 살아 있다:
```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
```

"Supabase 가 넓게 준다" 는 막연한 말이 아니라 **이 설정 세 줄**이다. 그리고 이것은 **앞으로 만들 모든 객체에 계속 적용된다.**

- 새 표를 만들면 **자동으로** anon·authenticated 가 전권을 갖는다 → 0012·0013 같은 사후 회수가 영원히 반복된다.
- **새 함수도 마찬가지다.** `drop function` 후 `create function` 하면 **EXECUTE 가 anon·authenticated 에게 자동으로 다시 부여된다.**
  → **0014(P4-5)가 정확히 이 모양이다.** 그래서 0014 는 재생성과 같은 트랜잭션 안에서 반드시 `revoke ... from public, anon, authenticated` 를 해야 한다.
  빠뜨리면 **아웃박스 큐를 변경하고 통지 행을 반환하는 definer 함수가 공개 롤에 열린다** — 0012 가 표 권한을 회수한 것이 그 함수 하나로 무의미해진다. Codex 가 이것을 "빠뜨리면 P1" 으로 분류했다.

**기본 권한 자체를 회수할 것인가?** 하지 않는다(지금은). Supabase 의 설계는 "새 표는 PostgREST 로 즉시 쓸 수 있고 RLS 가 문지기" 이고, 이 기본값을 건드리면 대시보드·PostgREST 의 기대와 어긋날 수 있다. 우리는 **개인정보 표에 한해 RLS 를 유일 방어선으로 두지 않기로** 결정했고, 그래서 표 단위로 명시 회수한다.
대신 **재발을 기계로 잡는다** → 아래 후속 태스크.

### 후속
- ~~**DB 권한 게이트**: `anon` 이 public 스키마의 어느 표에도 쓰기 권한을 갖지 않는지(허용 목록 외) 단언하는 테스트.~~ → **P6-11 (2026-09-17) 에서 신설: `tests/db-privilege-gate.test.ts`.** ✅
  `pg_class`·`pg_proc`·`pg_policy` 에서 public 의 표·뷰·시퀀스·함수를 **열거**하고(하드코딩 없음 · P5-15 부터 노출 스키마 전부와 공개 롤 자체까지 — 아래 후속) `has_*_privilege` 실효값 · 컬럼 단위 · PUBLIC(`aclexplode` grantee 0, NULL ACL 은 `acldefault`) ·
  definer 함수의 `pg_temp` · 소유자 · RLS 켜짐 · "쓰기 권한에는 그 동작을 허용하는 `authenticated` 정책이 있다" 를 허용 목록(항목마다 사유)과 대조한다. 죽은 예외도 실패다.
  **이빨**: 기본 권한 그대로의 임시 표·시퀀스·definer 함수를 `do $$ … raise $$` 로 **되돌려지는 트랜잭션 안에서** 만들어 게이트가 **이름을 대며** 빨개지는 것을 매 실행 확인한다(흔적 0 도 확인).
  0017 롤백을 적용하면 `reservations`·`notifications_log` 10건으로 빨개진다(실측).
  - ~~🔴 **게이트가 첫 실행에서 찾은 것 — 시퀀스 36건.**~~ → **0018 (P5-14, 2026-09-17) 에서 회수 완료. 게이트 초록.** ✅
    0012~0017 은 **시퀀스를 한 번도 회수하지 않았다.** 공개 7개 시퀀스에서 `anon` 이 usage·select·update 를, `authenticated` 가 select·update(+ `notifications_log_id_seq` 의 usage)를 갖고 있었다.
    허용 목록은 넓히지 않았다 — 처음부터 있던 **콘텐츠 6 × `authenticated.usage`** 만 남기고 나머지를 회수해서 초록이 됐다. 아래 0018 절.
  - ~~🔴 **게이트가 놓친 것 — 표 권한 `MAINTAIN`(PG17) 18건.**~~ → **0019 (P5-15, 2026-09-17) 에서 회수 완료. 게이트 초록.** ✅
    게이트는 객체를 열거하면서 **권한 종류는 하드코딩**했다(`values ('select'), …, ('references')`). PG17 이 `MAINTAIN` 을 더하자 볼 수단이 없어 **초록으로 통과**시켰다.
    P5-15 가 게이트를 먼저 고쳤다 — 종류를 `acldefault(<종류>, 소유자)`(서버가 아는 전 종류) ∪ 실제 ACL 의 `aclexplode` 에서 얻고, **ACL 관점**(직접 부여 전수)과 **유효값 관점**(`has_*_privilege`)을 둘 다 본다.
    고친 게이트는 0019 적용 **전** 같은 DB 에서 18건(9표 × 두 공개 롤)으로 빨개졌고, 허용 목록을 넓히지 않은 채 0019 로 초록이 됐다. 아래 0019 절.
- **`authenticated` 가 콘텐츠 여섯 표를 `LOCK TABLE … ACCESS EXCLUSIVE` 할 수 있다** (P5-15 발견, *미착수*). PostgreSQL 은 강한 잠금을 MAINTAIN **또는 UPDATE·DELETE·TRUNCATE** 로 허용한다. 관리자 편집용 표 단위 UPDATE·DELETE 가 그 문을 연다 — 0019 로는 닫히지 않는다(로컬 실측: authenticated 로 `lock table notices in access exclusive mode` 성공). 오늘 PostgREST 로 LOCK 을 칠 경로는 없다. 닫으려면 관리자 쓰기를 definer 함수로 옮기거나 별도 관리자 롤을 두는 설계 변경이 필요하다 — 판단은 컨트롤러.
- ~~**게이트의 스키마 권한은 아직 `'create'` 하나만 본다**~~ → **P5-15 astra 수정 라운드에서 넓혔다.** ✅ (GPT 독립 리뷰 P1 5건 · P2 2건)
  - **노출 스키마**: `public` 하드코딩 대신 `supabase/config.toml [api] schemas`(지금 `public`·`graphql_public`). graphql_public 의 `graphql(text,text,jsonb,jsonb)`(소유자 supabase_admin · invoker · PUBLIC EXECUTE — Supabase 기본)만 이름으로 허용한다. 이 스키마의 **기본 권한도 anon·authenticated 전권**이다(실측) — 새 객체는 게이트가 잡는다.
  - **grant option**(직접 `is_grantable` · 유효 `WITH GRANT OPTION`) · **스키마 USAGE/CREATE 전 종류** · **사용자 타입 USAGE** · **large object 수(0)** · **공개 롤의 불리언 속성 전부·설정 키·도달 가능한 롤(SET·INHERIT 옵션 포함)**.
  - 허용 목록 조회를 `Object.hasOwn` 으로 바꿨다 — 표 이름이 `constructor` 면 허용으로 판정되던 결함(재현됨).
  - **실측 기준선(2026-09-17 로컬)**: 두 공개 롤 모두 `rolinherit` 만 true · 설정은 `statement_timeout` 하나(anon 3s·authenticated 8s) · 멤버십 0(반대로 `postgres`·`authenticator`·`supabase_realtime_admin` 이 두 롤의 멤버 — 공개 롤의 권한을 넓히지 않는다) · grant option 0 · large object 0 · 스키마 USAGE 는 노출 스키마만, `public` 에 PUBLIC USAGE(PG15+ 기본).
  - 🔸 **새로 드러난 기준선 하나 — `reservation_status` enum 의 PUBLIC USAGE.** typacl 이 NULL(PostgreSQL 기본값 = PUBLIC USAGE)이다. 타입 USAGE 는 행을 읽게 해 주지 않는다. 게이트에 `TYPE_USAGE` 로 **고정**했다(넓힌 것이 아니라 새 수집기의 기준선). **결정(컨트롤러 2026-09-17): 유지.** ✅
  - **graphql_public 노출 — 결정(컨트롤러 2026-09-17): 유지, 게이트 감시.** `supabase/config.toml [api] schemas` 는 바꾸지 않는다. 이 스키마의 기본 권한이 공개 롤 전권이므로 새 객체는 게이트가 이름으로 잡고, 허용된 `graphql(text,text,jsonb,jsonb)` 은 소유자·실행 모드(invoker·설정 없음)까지 고정했다(R2 P1-B). ✅
  - **로컬 슈퍼유저 탐침 채널**(`tests/helpers/local-stack-sql.ts`) — CI 확인 완료(`cdaa51a` 8잡 green · DB Smoke 통과, 컨트롤러 2026-09-17). ✅
  - **여전히 보지 않는 것**: DB 단위 권한(CONNECT·TEMPORARY), 언어·FDW·foreign server, 설정 파라미터 ACL(`pg_parameter_acl`), large object 개별 ACL(개수 0 단언으로 갈음), 노출되지 않은 스키마(`extensions`·`auth`·`storage` — Supabase 소유), 표의 행 타입·배열 타입(표 권한을 따른다).
- ④⑤ 질의에 `has_any_column_privilege` 추가, ② 질의를 `pg_class.relacl` + `aclexplode` 로 교체. → **0016 이 자기검증·테스트 §9 에서 그렇게 한다**(질의 자체는 아래 0016 절에 있다). ✅
- ~~`0012:34` 의 TRIGGER 관련 주석 정정.~~ → **0016 (P5-12) 에서 완료.** `0012` 헤더에 원문을 남긴 채 정정을 덧붙였다. ✅
- ~~`authenticated` 의 콘텐츠 7표 **TRUNCATE 회수**~~ → **0016 에서 완료** (TRIGGER·REFERENCES 도 함께). ✅
- ~~**`places` 는 애초에 관리자가 쓰지 않는다**~~ → **0016 에서 `authenticated` 의 insert/update/delete 회수 완료**(`select` 는 남겼다). ✅
- ~~`0005:96`·`0007:31` 의 definer 함수가 `pg_temp` 를 빠뜨렸다~~ → **0016 에서 완료.** 단 **함수는 넷이 아니라 셋**이었다 — `0005:96` 의 `claim_pending_notifications(int)` 는 `0014` 가 이미 지웠고 2-인자 판은 처음부터 `public, pg_temp` 다. ✅
- ~~`tests/write-privileges.test.ts` 가 **상태코드 ≥400 이면 통과**로 본다~~ → **0017 (P5-13) 에서 완료.** 같은 파일의 거부 단언 13곳을 `expectPermissionDenied()`(상태코드 401·403 **그리고** PostgreSQL `42501`)로 바꾸고, **대조군**(없는 표 → 404 `PGRST205`)을 같은 블록에 둬 "거부" 와 "부재" 가 구분되는지 보인다. ✅ *(같은 형태가 `tests/admin-*.test.ts` 등 6파일에 아직 남아 있다 — 아래 새 후속 항목)*
- ~~🔴 **`reservations`·`notifications_log` 에도 `TRIGGER`·`REFERENCES` 가 남아 있다**~~ → **0017 에서 회수 완료.** 적용 전에 **실제로 붙여 봤고 붙었다**(아래 0017 절의 실측 원문). ✅
- ~~`anon` 이 `reservations`·`notifications_log` 에 **`select`** 를 갖고 있다~~ → **0017 에서 회수 완료.** 두 표를 `anon` 으로 읽는 경로가 코드에 하나도 없고(공개 경로는 전부 서비스 롤) 0009 의 세 정책은 전부 `to authenticated` 다. ✅
- **느슨한 거부 단언이 남은 파일들**: `tests/admin-auth.test.ts` · `tests/admin-reservations.test.ts` · `tests/admin-notifications.test.ts` · `tests/admin-notices.test.ts` · `tests/admin-popups.test.ts` · `tests/admin-routes.test.ts` · `tests/admin-gallery.test.ts` 에 `toBeGreaterThanOrEqual(400)` 이 남아 있다. 전부가 권한 거부는 아니다(Storage API 응답·중복키 409·RPC 부재 404 가 섞여 있어 일괄 치환하면 오히려 틀린 단언이 된다) — **한 건씩 무엇을 단언하려던 것인지 읽고** 권한 거부인 것만 `42501` 로 조인다. *(미착수)*

### 적용 후 확인 (원격)
같은 질의 다섯 개를 원격에서 돌려 **위 표와 같은 결과**인지 대조하고, 아래에 날짜·결과를 적는다.

> **원격 적용 완료 (2026-09-21 00:17 KST, 컨트롤러).** `supabase db push --linked` 로 0012~0019 여덟 파일을 한 번에 적용했다 — 전부 성공, 이력 마지막이 `0019`. 상세는 문서 맨 아래 「원격 적용 기록」.
> `supabase db push --linked` 가 **자동 승인 정책(Production Deploy)에 막혔다.** 우회하지 않는다 — 사람이 판단할 자리다.
> 진행하려면 사용자가 그 명령을 승인하거나 직접 실행해야 한다. 그때까지 원격은 **0011 상태**이고, 그 상태에서도 사이트는 정상 동작한다(회수는 방어 강화이지 기능 요구사항이 아니다).

---

## 0014 — claim 채널 필터 (독립 리뷰 **승인** · **원격 적용 완료 2026-09-21**)

`claim_pending_notifications` 에 채널 화이트리스트(`p_channels text[] default null`)를 넣어 **보낼 수 없는 채널의 행을 아예 집지 않게** 한다. 배경은 `docs/ops/known-defects.md` **D3**.
1-인자 구버전을 **먼저 `drop`** 한 뒤 2-인자를 만든다 — `create or replace` 에 파라미터를 더하면 Postgres 가 새 함수로 보고 구버전이 남아 1-인자 호출이 **모호(42725)** 해진다.

### 🔴 배포 순서 — **0014 원격 적용이 코드 배포보다 먼저다** (리뷰 K5)
`claimPending` 은 **항상** `p_channels` 를 함께 보낸다. 따라서 순서를 뒤집으면 배포된 코드가 아직 없는 2-인자 시그니처를 불러 **PostgREST 가 PGRST202/404 를 내고 통지 크론이 500** 이 된다(리뷰어 실측).
안전한 실패이긴 하다(발송이 잘못 나가는 것이 아니라 아예 안 돈다). 그래도 **순서를 지킨다**:
1. `supabase db push` 로 **0014 를 원격에 적용**
2. 그다음 코드 배포(Vercel)
3. 통지 크론을 `?dry=0` 으로 전환하는 것은 **그 뒤**

### ⚠️ 적용 경로 — `psql -f` 를 쓰지 마라 (리뷰 K1)
마이그레이션 파일에는 명시적 `begin/commit` 이 없다. `psql -f` 로 실행하면 **파일이 원자적이지 않아** 자기검증 블록이 `raise` 해도 앞서 실행된 문장이 남는다(리뷰어 실측: 가드가 멈췄는데 `anon` ACL 이 그대로 남았다).
**`supabase db push` 로만** 적용한다(CLI 는 마이그레이션 하나를 한 트랜잭션으로 돌고 이력을 남긴다 — 맨 위 「적용 경로」, P5-15 R6). 저장소의 13개 마이그레이션 전부 같은 관례이므로 0014 가 새로 만든 위험은 아니다.

### 독립 리뷰가 실증한 것 (2026-09-16, 승인 · 치명 0 · 중대 0)
- **SQL 뮤테이션 7종 전부 자기검증에서 멈췄다** — `revoke` 제거 / `revoke`+`grant` 제거 / `revoke` 를 `create` 앞으로 / 채널 필터 제거 / 1-인자 `drop` 제거 / `service_role` 회수.
- **로컬에도 같은 기본 권한이 실재**함을 `pg_default_acl` 로 확인했다(원격만의 문제가 아니다).
- 채널 인자 **9가지**(`null`·`{sms}`·`{email}`·`{sms,email}`·`{}`·`{bogus}`·`{alimtalk}`·`{sms,sms}`·`{null}`)를 직접 돌려, 집히지 않은 행은 `attempts` 는 물론 **`updated_at` 까지 불변**이고 **어떤 입력도 "전 채널" 로 승격되지 않음**(fail-closed)을 확인했다.
- 타입 뮤테이션 **10종 전부 검출**(미검출 0).

### 남은 권고 (후속)
- **K2**: 롤백이 `set search_path = public`(pg_temp 없음)을 되살린다 — temp 표 섀도잉을 실증 재현했다. EXECUTE 가 `service_role` 뿐이라 악용성은 낮다. `0005`·`0007` 의 같은 문제와 **함께** 고친다.
- **K3**: `expect([401,403,404]).toContain(...)` 가 "함수 없음(404)" 과 "권한 없음(401/42501)" 을 구분하지 못한다. 좁힐 것.
- **K4**: 롤백 검증 블록에 `service_role` 실행 가능 확인이 빠졌다(상행에는 있다).
- **K7**: Resend 가 `Idempotency-Key` 를 지원한다 — `WorkerReport.sentUnmarked` 의 중복 수신 창을 메일 채널에서 한 줄로 닫을 수 있다.
- 보고서 §4 를 "가정" → "문서 확인" 으로 갱신(리뷰어가 Resend 공개 문서로 엔드포인트·인증·본문 필드·성공 `id` 4건을 대조해 전부 정확함을 확인했다).

---

## 0016 — RLS 가 막지 못하는 권한 회수 (**원격 적용 완료 2026-09-21**)

**무엇을 하나**: 0012·0013 이 닫은 것은 **쓰기 네 동작**뿐이었다. 남은 `TRUNCATE`·`TRIGGER` 는 RLS 가 관여하는 종류의 권한이 아니다 — TRUNCATE 는 행을 하나씩 보지 않아 정책 평가가 일어나지 않고, TRIGGER 는 `CREATE TRIGGER` 를 허용한다. 즉 그 둘에 대해서는 **"RLS 가 유일한 방어선" 조차 아니고 아무 방어선도 없었다.**

1. 콘텐츠 7표에서 `authenticated` 의 **TRUNCATE·TRIGGER·REFERENCES** 회수
2. 같은 7표에서 `anon` 의 **TRIGGER·REFERENCES** 회수 (네 동작은 0013 이 가져갔다)
3. `places` 에서 `authenticated` 의 **insert·update·delete** 회수 — 관리자 쓰기 정책이 없고(0009 는 여섯 표) 코드 경로도 없다. **`select` 는 남긴다.**
4. definer 함수 **셋**(`mark_notification_sent`·`mark_notification_failed`·`reap_stale_notifications`)의 `search_path` 를 `public, pg_temp` 로. **`create or replace`** 만 쓴다(drop 하면 기본 권한이 EXECUTE 를 공개 롤에 다시 부여한다).

### 🔴 `claim_pending_notifications` 는 **건드리지 않는다**
후속 목록이 `0005:96` 을 포함해 "함수 넷" 으로 적었는데 **그 함수는 이미 없다.** `0014` 가 1-인자 판을 `drop` 하고 2-인자 판을 만들었으며 그쪽은 처음부터 `public, pg_temp` 다. 0016 에서 1-인자 형태를 `create or replace` 하면 **없던 함수를 새로 만드는 것**이 되어 두 판이 공존하고, `claim_pending_notifications(10)` 호출이 **모호(42725)** 해져 발송기가 통째로 멈춘다(0014 §4 ①). 0016 의 자기검증 ⑥ 이 그 상태를 매번 다시 확인한다.

### TRIGGER 가 무력하지 않다는 근거 (0012 헤더 정정의 실측)
`CREATE TRIGGER` 는 ⓐ 표의 TRIGGER 권한과 ⓑ **이미 존재하는** 트리거 반환 함수의 EXECUTE 만 요구한다. ⓑ 가 이 DB 에 실재한다:
```sql
select n.nspname||'.'||p.proname, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prorettype = 'pg_catalog.trigger'::regtype
  and (has_function_privilege('anon', p.oid,'execute') or has_function_privilege('authenticated', p.oid,'execute'));
```
로컬 실측 22건 — 그중 **`supabase_functions.http_request`**(행이 바뀔 때마다 외부 URL 로 HTTP 호출)가 `anon`·`authenticated` 모두 `execute=true`.

### 적용 전 확인 질의 (0016 판 — 컬럼 단위 grant 와 PUBLIC 까지 본다)
`information_schema.role_table_grants` 를 **증거로 쓰지 않는다**(필터된 뷰). 아래 여덟 가지를 한 문장으로 묻는다.

아래 행렬(카탈로그 질의뿐)을 **읽기 확인용으로** SQL Editor 에 붙여 넣는다(적용 경로가 아니다). 붙이는 원문은 **이 runbook 의 블록뿐**이다.
(로컬 검사도 이 표식 사이의 원문을 읽어 그대로 돌린다 — P5-15 R5.)
<!-- P515:0016_MATRIX_SQL:BEGIN -->
```sql
select
  coalesce((select 'RLS_BLIND_LEAK ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')
     from (values ('public.notices'),('public.popups'),('public.gallery'),('public.gallery_albums'),('public.showcase_routes'),('public.vehicles'),('public.places')) t(tbl)
     cross join (values ('truncate'),('trigger'),('references')) p(priv)
    where has_table_privilege('authenticated', t.tbl, p.priv)
       or (p.priv = 'references' and has_any_column_privilege('authenticated', t.tbl, 'references'))), 'RLS_BLIND_NONE') as blind,
  coalesce((select 'ANON_EXTRA ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')
     from (values ('public.notices'),('public.popups'),('public.gallery'),('public.gallery_albums'),('public.showcase_routes'),('public.vehicles'),('public.places')) t(tbl)
     cross join (values ('insert'),('update'),('delete'),('truncate'),('trigger'),('references')) p(priv)
    where has_table_privilege('anon', t.tbl, p.priv)
       or case when p.priv in ('insert','update','references') then has_any_column_privilege('anon', t.tbl, p.priv) else false end), 'ANON_SELECT_ONLY') as anon_extra,
  coalesce((select 'ANON_SELECT_LOST ' || string_agg(t.tbl, ' ')
     from (values ('public.notices'),('public.popups'),('public.gallery'),('public.gallery_albums'),('public.showcase_routes'),('public.vehicles')) t(tbl)
    where not has_table_privilege('anon', t.tbl, 'select')), 'ANON_SELECT_OK') as anon_read,
  coalesce((select 'PLACES_WRITE_LEAK ' || string_agg(p.priv, ' ')
     from (values ('insert'),('update'),('delete')) p(priv)
    where has_table_privilege('authenticated', 'public.places', p.priv)
       or case when p.priv <> 'delete' then has_any_column_privilege('authenticated', 'public.places', p.priv) else false end), 'PLACES_WRITE_NONE') as places_write,
  coalesce((select 'PLACES_READ_LOST ' || string_agg(r.role, ' ')
     from (values ('anon'),('authenticated')) r(role)
    where not has_table_privilege(r.role, 'public.places', 'select')), 'PLACES_READ_OK') as places_read,
  coalesce((select 'FN_MISSING ' || string_agg(s.sig, ' ')
     from (values ('public.mark_notification_sent(bigint, text)'),('public.mark_notification_failed(bigint, text, boolean, bigint)'),('public.reap_stale_notifications()')) s(sig)
    where to_regprocedure(s.sig) is null), 'FN_ALL_PRESENT') as fn_present,
  coalesce((select 'PG_TEMP_MISSING ' || string_agg(s.sig, ' ')
     from (values ('public.mark_notification_sent(bigint, text)'),('public.mark_notification_failed(bigint, text, boolean, bigint)'),('public.reap_stale_notifications()')) s(sig)
     join pg_proc p on p.oid = to_regprocedure(s.sig)
    where not exists (
      select 1
        from unnest(coalesce(p.proconfig, '{}')) c
       cross join lateral regexp_split_to_table(substr(c, 13), ',(?=(?:[^"]*"[^"]*")*[^"]*$)') x(tok)
       cross join lateral (select btrim(x.tok, ' ' || chr(9) || chr(10) || chr(13) || chr(12)
                                    || case when current_setting('server_version_num')::int >= 170000 then chr(11) else '' end) as t) y
       where left(c, 12) = 'search_path='
         and case when y.t like '"%'
                  then replace(substr(y.t, 2, length(y.t) - 2), '""', '"')
                  else lower(y.t) end = 'pg_temp')), 'PG_TEMP_OK') as pg_temp,
  coalesce((select 'FN_EXEC_EXTRA ' || string_agg(format('%s/%s', p.proname, g.who), ' ')
     from (values ('public.mark_notification_sent(bigint, text)'),('public.mark_notification_failed(bigint, text, boolean, bigint)'),('public.reap_stale_notifications()')) s(sig)
     join pg_proc p on p.oid = to_regprocedure(s.sig)
     cross join lateral (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who
                           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE') g
    where g.who <> 'service_role' and g.who <> pg_get_userbyid(p.proowner)), 'FN_EXEC_ONLY_SERVICE') as fn_exec,
  coalesce((select 'FN_PUBLIC_ROLE_EXEC ' || string_agg(format('%s/%s', s.sig, r.role), ' ')
     from (values ('public.mark_notification_sent(bigint, text)'),('public.mark_notification_failed(bigint, text, boolean, bigint)'),('public.reap_stale_notifications()')) s(sig)
     cross join (values ('anon'),('authenticated')) r(role)
    where to_regprocedure(s.sig) is not null
      and has_function_privilege(r.role, to_regprocedure(s.sig), 'EXECUTE')), 'FN_NO_PUBLIC_ROLE_EXEC') as fn_public_exec,
  coalesce((select 'FN_SERVICE_LOST ' || string_agg(s.sig, ' ')
     from (values ('public.mark_notification_sent(bigint, text)'),('public.mark_notification_failed(bigint, text, boolean, bigint)'),('public.reap_stale_notifications()')) s(sig)
    where to_regprocedure(s.sig) is not null
      and not has_function_privilege('service_role', to_regprocedure(s.sig), 'EXECUTE')), 'FN_SERVICE_OK') as fn_service,
  case when to_regprocedure('public.claim_pending_notifications(int)') is not null
       then 'CLAIM_ONE_ARG_BACK' else 'CLAIM_ONE_ARG_GONE' end as claim_old,
  coalesce((select 'ADMIN_BROKEN ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')
     from (values ('public.notices'),('public.popups'),('public.gallery'),('public.gallery_albums'),('public.showcase_routes'),('public.vehicles')) t(tbl)
     cross join (values ('select')) p(priv)
    where not has_table_privilege('authenticated', t.tbl, p.priv)), 'ADMIN_OK') as admin_crud,
  coalesce((select 'SEQ_BROKEN ' || string_agg(s.seq, ' ')
     from (values ('public.notices_id_seq'),('public.popups_id_seq'),('public.gallery_id_seq'),('public.gallery_albums_id_seq'),('public.showcase_routes_id_seq'),('public.vehicles_id_seq')) s(seq)
    where not has_sequence_privilege('authenticated', s.seq, 'usage')), 'SEQ_OK') as seqs;
```
<!-- P515:0016_MATRIX_SQL:END -->

| # | 기대 문자열 | 뜻 |
|---|---|---|
| ① | `RLS_BLIND_NONE` | 7표에 `authenticated` 의 truncate/trigger/references 0 (컬럼 단위 references 포함) |
| ② | `ANON_SELECT_ONLY` · `ANON_SELECT_OK` | 7표에서 `anon` 은 select 만(insert·update·references 는 **컬럼 단위까지**) · 콘텐츠 6표의 `anon` select 는 **살아 있다**(사라지면 `ANON_SELECT_LOST …` = 공개 사이트가 빈다) (P5-15 R6) |
| ③ | `PLACES_WRITE_NONE` · `PLACES_READ_OK` | places 쓰기 0(insert·update 는 컬럼 단위까지) · 두 롤의 읽기 생존 |
| ④ | `PG_TEMP_OK` | 함수 셋의 **`search_path` 항목**을 스키마 목록으로 풀었을 때 `pg_temp` 가 있다(다른 설정 값에 `pg_temp` 가 적힌 것은 치지 않는다 · 따옴표 식별자는 푼 뒤 비교) (P5-15 R6). 토큰 앞뒤 공백은 PostgreSQL `scanner_isspace` 집합 — 스페이스·탭·LF·CR·FF 는 모든 버전, **세로 탭(`chr(11)`)은 17 이상에서만**. 실측(P5-15 R8 · `set_config('search_path', chr(11) \|\| 'public', true)` 뒤 `current_schemas(false)`): **15.17 `{}` · 16.15 `{}` · 17.6 `{public}` · 18.6 `{public}`** → 경계는 **17**. `E'\v'` 는 PG 이스케이프가 아니라(`v` 가 된다) `chr(11)` 로 쓴다 (P5-15 R7·R8) |
| ⑤ | `FN_ALL_PRESENT` · `FN_EXEC_ONLY_SERVICE` · `FN_NO_PUBLIC_ROLE_EXEC` | 세 시그니처가 **전부 있고**(없으면 `FN_MISSING …`), EXECUTE 보유자는 `service_role`(+소유자) 뿐이며(NULL ACL 은 기본값 = PUBLIC EXECUTE 로 읽는다), 공개 롤의 **유효** EXECUTE 0 (P5-15 R5) |
| ⑥ | `FN_SERVICE_OK` | `service_role` 이 여전히 실행할 수 있다(발송기) |
| ⑦ | `CLAIM_ONE_ARG_GONE` | 1-인자 claim 이 되살아나지 않았다 |
| ⑧ | `ADMIN_OK` · `SEQ_OK` | 콘텐츠 6표의 `authenticated` **select** 와 시퀀스 usage 생존 = **관리자 화면이 읽을 수 있다**. ⚠️ **2026-09-21 갱신(P5-16)**: 원래 이 칸은 6표 × **CRUD 네 동작**을 봤다. 0020 이 insert·update·delete 를 회수했으므로(`known-defects` D10) 이제 select 만 본다 — 관리자 **쓰기**의 생존은 0020 절 행렬의 `FN_OK` 가 본다. 시퀀스 usage 는 0020 뒤로 쓰이지 않는 잔여 부여다(0020 절 「남은 것」) |

### 로컬 실측 (2026-09-16, P5-12 구현)
적용 전 → 후, `has_table_privilege` 전수:

| 표 | 롤 | 적용 전 | 적용 후 |
|---|---|---|---|
| 콘텐츠 6표 | `authenticated` | delete, insert, references, select, trigger, truncate, update | **delete, insert, select, update** |
| 콘텐츠 6표 | `anon` | references, select, trigger | **select** |
| `places` | `authenticated` | (위와 같음 7종) | **select** |
| `places` | `anon` | references, select, trigger | **select** |
| 9표 | `service_role`·`postgres` | 7종 전부 | **변화 없음** |

함수 셋: `{search_path=public}` → `{"search_path=public, pg_temp"}`, EXECUTE 보유자 `postgres,service_role` **불변**.

**R5 수정 (2026-09-17, P5-15)**: ④ 의 EXECUTE 보유자 검사가 `aclexplode(p.proacl)` 이었다 — `proacl IS NULL`(기본 ACL = PUBLIC EXECUTE)이면 0행이라 통과한다. `coalesce(p.proacl, acldefault('f', p.proowner))` 로 고쳤다. 상행은 바로 뒤의 **유효 EXECUTE 검사**가 원래 있어 실제로는 멈췄지만(로컬 실측: NULL 로 만들면 `공개 롤이 … 를 실행할 수 있다 (anon=t · authenticated=t)`), **롤백 파일에는 그 검사가 없어 그대로 통과했다** — 롤백에도 두 가지(NULL 채움 · 유효 EXECUTE 거부)를 넣었다. 위 행렬도 함수 셋을 시그니처로 묶고(없으면 `FN_MISSING`) NULL ACL 과 유효 EXECUTE 를 본다. 이 절은 원격 미적용 전제다 — 공통 절 "① 원격 적용 이력" 을 먼저 본다.

### 적용 경로
**`supabase db push` 만**(맨 위 「적용 경로」 — SQL Editor 는 읽기 확인용). **`psql -f` 를 쓰지 마라**(리뷰 K1 — 파일이 원자적이지 않아 자기검증이 `raise` 해도 앞 문장이 남는다). 실제로 0016 을 만들면서 `supabase db reset` 이 **문장 단위로** 적용하다 6번째 문장에서 멈추는 것을 봤다(그 시점에 §1~§4 는 이미 적용돼 있었다) — 같은 성질이다.

### 롤백
`supabase/rollbacks/0016_privileges_rls_cannot_protect.down.sql` · **승인 플래그 요구**(`set bestour.rollback_0016_ack = '1';`). 근거: 되돌린 뒤의 세계가 **조용히** 위험하다(TRUNCATE 는 RLS 밖, TRIGGER 는 외부 유출, `pg_temp` 없는 `search_path` 는 엉뚱한 표를 고치고 성공을 돌려준다). 되돌린 것을 필요로 하는 정상 경로는 하나도 없다.

> **원격 적용 완료 (2026-09-21 00:17 KST, 컨트롤러).** `supabase db push --linked` 로 0012~0019 여덟 파일을 한 번에 적용했다 — 전부 성공, 이력 마지막이 `0019`. 상세는 문서 맨 아래 「원격 적용 기록」.

---

## 0017 — 개인정보 두 표의 TRIGGER·REFERENCES 와 `anon` SELECT 회수 (**원격 적용 완료 2026-09-21**)

**무엇을 하나**: 0016 은 브리프가 못박은 **콘텐츠 일곱 표**만 다뤘다. 같은 구멍이 `reservations`(고객 성명·전화번호·이메일·문의내용)·`notifications_log`(수신처·문자 본문)에도 남아 있었고, **그쪽이 더 위험하다.**

1. 두 표 × `anon`·`authenticated` 에서 **TRIGGER·REFERENCES** 회수
2. 두 표에서 **`anon` 의 SELECT** 회수 (`authenticated` 의 SELECT 는 남긴다 — 관리자 화면이 읽는다)

함수·정책·데이터는 건드리지 않는다. `drop function` 도, `create or replace function` 도 없다.

### 🔴 이것은 이론이 아니다 — 적용 **전에** 붙여 봤고, 붙었다 (2026-09-16 로컬 실측)
`set local role <롤>` 뒤 `supabase_functions.http_request` 트리거를 `CREATE TRIGGER` 로 붙이는 시도(마지막에 `raise` 로 전부 롤백 · **로컬에서만** 한 실측 — 아래 출력은 붙여 넣는 SQL 이 아니다):
```text
[anon → reservations]          CREATE TRIGGER 성공
[anon → notifications_log]     CREATE TRIGGER 성공
[authenticated → reservations] CREATE TRIGGER 성공
[authenticated → notifications_log] CREATE TRIGGER 성공
```
0017 적용 **후** 같은 시도:
```text
[anon → reservations]          거부 SQLSTATE=42501 MESSAGE=permission denied for table reservations
[anon → notifications_log]     거부 SQLSTATE=42501 MESSAGE=permission denied for table notifications_log
[authenticated → reservations] 거부 SQLSTATE=42501 MESSAGE=permission denied for table reservations
[authenticated → notifications_log] 거부 SQLSTATE=42501 MESSAGE=permission denied for table notifications_log
```
`CREATE TRIGGER` 는 표의 TRIGGER 권한 + **이미 존재하는** 트리거 함수의 EXECUTE 만 요구한다(스키마 CREATE 도, 소유권도 불필요). `supabase_functions.http_request` 는 `anon`·`authenticated` 모두 `execute=true` 다.

### `anon` 의 SELECT 를 회수한 근거
0012 의 "select 는 회수하지 않는다" 는 **관리자 화면이 읽는다** 였고, 그것은 `authenticated` 에만 해당한다. 두 표를 `anon` 으로 읽는 경로가 코드에 **하나도 없다**: `lib/queries/recent.ts`·`lib/reservation-check/db.ts`·`lib/notify/vars.ts`·`lib/retention/purge.ts` 전부 **서비스 롤**이고, 관리자 목록·발송 내역은 `authenticated`(SSR 세션)다. 0009 의 세 정책(`reservations_admin_select`·`reservations_admin_update`·`notifications_log_admin_select`)도 전부 `to authenticated` 다.

**거동 변화**: PostgREST 가 `200 []` 대신 **`401` + `42501`** 을 낸다. 그 0행은 *정책이 없어서* 나오던 결과라, 누가 `anon` 용 select 정책을 한 줄 붙이면 고객 표가 공개됐다 — 이제 정책과 무관하게 권한에서 먼저 막힌다. 바뀐 단언: `tests/notify-vars.test.ts` 의 "anon 키로는 0행" → "권한 거부(42501)".

### 적용 전/후 확인 질의 (0017 판 — 여덟 가지를 한 문장으로)
아래 행렬(카탈로그 질의뿐)을 **읽기 확인용으로** SQL Editor 에 붙여 넣어 대조한다(적용 경로가 아니다). 붙이는 원문은 **이 runbook 의 블록뿐**이다.
(로컬 테스트도 이 표식 사이의 원문을 읽어 그대로 돌린다 — P5-15 astra R3.)
<!-- P515:0017_MATRIX_SQL:BEGIN -->
```sql
select
  coalesce((select 'PII_BLIND_LEAK ' || string_agg(format('%s/%s/%s', r.role, t.tbl, p.priv), ' ')
     from (values ('anon'),('authenticated')) r(role)
     cross join (values ('public.reservations'),('public.notifications_log')) t(tbl)
     cross join (values ('trigger'),('references')) p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)
       or (p.priv = 'references' and has_any_column_privilege(r.role, t.tbl, 'references'))), 'PII_BLIND_NONE') as blind,
  coalesce((select 'ANON_PII_LEFT ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')
     from (values ('public.reservations'),('public.notifications_log')) t(tbl)
     cross join (values ('select'),('insert'),('update'),('delete'),('truncate'),('trigger'),('references')) p(priv)
    where has_table_privilege('anon', t.tbl, p.priv)), 'ANON_PII_NONE') as anon_pii,
  coalesce((select 'ADMIN_READ_LOST ' || string_agg(t.tbl, ' ')
     from (values ('public.reservations'),('public.notifications_log')) t(tbl)
    where not has_table_privilege('authenticated', t.tbl, 'select')
       or not has_any_column_privilege('authenticated', t.tbl, 'select')), 'ADMIN_READ_OK') as admin_read,
  coalesce((select 'SERVICE_LOST ' || string_agg(format('%s/%s', t.tbl, p.priv), ' ')
     from (values ('public.reservations'),('public.notifications_log')) t(tbl)
     cross join (values ('select'),('insert'),('update'),('delete'),('truncate'),('references')) p(priv)
    where not has_table_privilege('service_role', t.tbl, p.priv)), 'SERVICE_OK') as service,
  coalesce((select 'PII_COLUMN_LEAK ' || string_agg(format('%s/%s/%s', r.role, t.tbl, p.priv), ' ')
     from (values ('anon'),('authenticated')) r(role)
     cross join (values ('public.reservations'),('public.notifications_log')) t(tbl)
     cross join (values ('select'),('insert'),('update'),('references')) p(priv)
    where not (r.role = 'authenticated' and p.priv = 'select')
      and has_any_column_privilege(r.role, t.tbl, p.priv)), 'PII_COLUMN_NONE') as pii_col,
  coalesce((select 'PII_PUBLIC_ACL ' || string_agg(format('%s/%s', c.relname, a.privilege_type), ' ')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public' and c.relname in ('reservations','notifications_log')
      and a.grantee = 0), 'PII_PUBLIC_NONE') as pii_public,
  coalesce((select 'OUTBOX_FN_MISSING ' || string_agg(s.sig, ' ')
     from (values ('public.claim_pending_notifications(integer, text[])'),('public.mark_notification_sent(bigint, text)'),('public.mark_notification_failed(bigint, text, boolean, bigint)'),('public.reap_stale_notifications()')) s(sig)
    where to_regprocedure(s.sig) is null), 'OUTBOX_FN_ALL_PRESENT') as fn_present,
  coalesce((select 'OUTBOX_FN_EXTRA ' || string_agg(format('%s/%s', p.proname, g.who), ' ')
     from (values ('public.claim_pending_notifications(integer, text[])'),('public.mark_notification_sent(bigint, text)'),('public.mark_notification_failed(bigint, text, boolean, bigint)'),('public.reap_stale_notifications()')) s(sig)
     join pg_proc p on p.oid = to_regprocedure(s.sig)
     cross join lateral (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who
                           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE') g
    where g.who <> 'service_role' and g.who <> pg_get_userbyid(p.proowner)), 'OUTBOX_FN_ONLY_SERVICE') as fn_exec,
  coalesce((select 'OUTBOX_FN_PUBLIC_ROLE_EXEC ' || string_agg(format('%s/%s', s.sig, r.role), ' ')
     from (values ('public.claim_pending_notifications(integer, text[])'),('public.mark_notification_sent(bigint, text)'),('public.mark_notification_failed(bigint, text, boolean, bigint)'),('public.reap_stale_notifications()')) s(sig)
     cross join (values ('anon'),('authenticated')) r(role)
    where to_regprocedure(s.sig) is not null
      and has_function_privilege(r.role, to_regprocedure(s.sig), 'EXECUTE')), 'OUTBOX_FN_NO_PUBLIC_ROLE_EXEC') as fn_public_exec,
  coalesce((select 'OUTBOX_FN_SERVICE_LOST ' || string_agg(s.sig, ' ')
     from (values ('public.claim_pending_notifications(integer, text[])'),('public.mark_notification_sent(bigint, text)'),('public.mark_notification_failed(bigint, text, boolean, bigint)'),('public.reap_stale_notifications()')) s(sig)
    where to_regprocedure(s.sig) is not null
      and not has_function_privilege('service_role', to_regprocedure(s.sig), 'EXECUTE')), 'OUTBOX_FN_SERVICE_OK') as fn_service,
  coalesce((select 'PII_USER_TRIGGER ' || string_agg(tgname, ' ')
     from pg_trigger t
    where not t.tgisinternal
      and t.tgrelid in ('public.reservations'::regclass, 'public.notifications_log'::regclass)
      and not (t.tgrelid = 'public.reservations'::regclass and t.tgname = 'reservations_withdrawal_legacy_guard'
               and t.tgenabled = 'O' and t.tgqual is null and t.tgtype = 23
               and exists (select 1 from pg_proc gp join pg_namespace gn on gn.oid = gp.pronamespace
                            where gp.oid = t.tgfoid and gn.nspname = 'public' and gp.proname = 'reservations_withdrawal_legacy_guard'
                              and gp.pronargs = 0 and not gp.prosecdef
                              and md5(gp.prosrc) = '7bad11424b52c498a42b59cd4ab20a4f'))), 'PII_NO_USER_TRIGGER') as trg,
  coalesce((select 'PII_TRIGGER_PRIV ' || string_agg(format('%s/%s', c.relname, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end), ' ' order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = 'public' and c.relname in ('reservations','notifications_log')
      and a.privilege_type = 'TRIGGER' and a.grantee is distinct from c.relowner), 'PII_TRIGGER_OWNER_ONLY') as trg_priv;
```
<!-- P515:0017_MATRIX_SQL:END -->

| # | 기대 문자열 | 뜻 |
|---|---|---|
| ① | `PII_BLIND_NONE` | 두 표에 `anon`·`authenticated` 의 trigger/references 0 (컬럼 단위 references 포함) |
| ② | `ANON_PII_NONE` | `anon` 은 두 표에서 **일곱 동작 전부** 없음(select 까지) |
| ③ | `ADMIN_READ_OK` | `authenticated` 의 select 는 표·컬럼 단위 모두 생존 = 관리자 화면이 산다 |
| ④ | `SERVICE_OK` | `service_role` 의 **여섯 동작**(select·insert·update·delete·truncate·references) 불변 = 접수·enqueue·발송기·파기가 산다. **TRIGGER 는 0021 이 회수했다**(P1-7 R3 [P1-A] — 남겨 두면 `create or replace trigger` 로 청약철회 가드를 갈아끼울 수 있다). 그래서 이 검사에서 빼고 ⑨ 로 따로 본다 |
| ⑤ | `PII_COLUMN_NONE` · `PII_PUBLIC_NONE` | 컬럼 단위 grant 0 · PUBLIC 상속 0 |
| ⑥ | `OUTBOX_FN_ALL_PRESENT` · `OUTBOX_FN_ONLY_SERVICE` · `OUTBOX_FN_NO_PUBLIC_ROLE_EXEC` · `OUTBOX_FN_SERVICE_OK` | 아웃박스 definer 함수 **넷이 시그니처까지 전부 있고**(없으면 `OUTBOX_FN_MISSING …`), EXECUTE 보유자는 `service_role`(+소유자) 뿐이며(NULL ACL 은 기본값 = PUBLIC EXECUTE 로 읽는다), 공개 롤의 **유효** EXECUTE 0, service_role 은 실행 가능 (P5-15 astra R4) |
| ⑦ | `PII_NO_USER_TRIGGER` | 두 표에 사용자 트리거 0 — 단 **0021 의 legacy 가드 하나**만 제외한다. 제외 조건은 **표·이름·함수 신원(public 스키마 · 이름 · 인자 0 · invoker)·함수 본문 md5·`WHEN` 조건 없음(`tgqual is null`)·활성(`tgenabled='O'`)·발화 시점(`tgtype = 23` = 행 단위 BEFORE INSERT OR UPDATE — R4 [P2-D] astra: **UPDATE 만 거는 트리거**는 이름·본문·조건이 다 같아도 INSERT 강제를 없앤다)** 전부 일치다(P1-7 R3 [P2-E] · astra: 이름만 보면 **본문 교체**와 **`WHEN (false)`** 를 놓친다 — 둘 다 한 행도 막지 않게 만든다). 하나라도 어긋나면 `PII_USER_TRIGGER` 로 보고된다. 0021 적용 전 DB 에서는 함수가 없어 아무것도 제외되지 않는다. **본문을 고치는 마이그레이션을 내면 이 md5 도 함께 바꾼다**(`tests/write-privileges.test.ts §12` 가 로컬 DB 값과 대조한다) |
| ⑨ | `PII_TRIGGER_OWNER_ONLY` | 두 표의 `TRIGGER` 보유자는 **표 소유자뿐**이다(0021 R3 [P1-A] — `anon`·`authenticated` 는 0017, `service_role` 은 0021 에서 회수). 남는 우회(소유자·슈퍼유저 DDL)는 `known-defects.md` D11 |
| ⑧ | (같은 파일의 거동 테스트 — ⛔ **로컬 전용, 원격에 붙이지 마라**) | **0021 뒤로는 세 롤(`anon`·`authenticated`·`service_role`) × 두 표 = 6회가 전부 `42501`** 이다(P1-7 R3 [P1-A] — 0021 이 `service_role` 의 TRIGGER 도 회수했다). 대조군은 **일회용 표**(TRIGGER 만 준 `p513_control_tbl`)에서 세 롤 모두 성공한다. ~~`service_role` 2회는 성공~~ 은 0021 이전 서술이다 |

⛔ ⑧ 의 DO 블록은 원격 확인 절차가 아니다 — 원격에 붙이지 마라(P5-15 astra R2 — 원격 확인은 카탈로그 질의만). 거부될 시도조차 권한 검사 전에 SHARE ROW EXCLUSIVE 를 기다려 잡는다(아래 근거) — 접수가 막힌다. 원격에서는 위 행렬 `select` 만 붙인다. (0021 전에는 대조군이 **실제 두 표**에 `CREATE TRIGGER` 를 성공시켰다 — 지금은 일회용 표로 옮겼다.)

### 🔴 자기검증 ⑦ 개정 (2026-09-17, P5-15 astra R3) — 실제 두 표에 CREATE TRIGGER 를 치지 않는다
옛 ⑦ 은 적용 중에 `anon`·`authenticated`·`service_role` 로 **실제** 두 표에 `CREATE TRIGGER` 를 시도하고, 대조군이 만든 트리거를 `DROP TRIGGER` 했다. PostgreSQL 17 `src/backend/commands/trigger.c` `CreateTriggerFiringOn` 은 **표를 먼저 잠그고 권한은 나중에 본다**:
```c
if (OidIsValid(relOid))
    rel = table_open(relOid, ShareRowExclusiveLock);
else
    rel = table_openrv(stmt->relation, ShareRowExclusiveLock);
…
/* permission checks */
if (!isInternal)
{
    aclresult = pg_class_aclcheck(RelationGetRelid(rel), GetUserId(),
                                  ACL_TRIGGER);
    if (aclresult != ACLCHECK_OK)
        aclcheck_error(aclresult, get_relkind_objtype(rel->rd_rel->relkind),
                       RelationGetRelationName(rel));
```
그리고 `RemoveTriggerById` 는 `table_open(relid, AccessExclusiveLock)` — 대조군의 drop 은 **마이그레이션 커밋까지** ACCESS EXCLUSIVE 를 쥔다. 즉 거부를 기대한 탐침도 진행 중인 접수 뒤에 줄을 서고, 그 뒤의 새 접수는 탐침 뒤에 줄을 선다.
**로컬 실측**(다른 세션이 `reservations` 에 ROW EXCLUSIVE 를 쥔 채 · `lock_timeout = 3s` · 센티넬):
```text
== 옛 0017 (HEAD)   ERROR:  0017: 탐침이 권한 거부(42501)가 아닌 이유로 실패했다 — anon → reservations : SQLSTATE=55P03 MESSAGE=canceling statement due to lock timeout
== 새 0017          ERROR:  SENTINEL_NOT_STOPPED   (기다리지 않았다)
== 새 0018          ERROR:  SENTINEL_NOT_STOPPED
== 새 0019          ERROR:  SENTINEL_NOT_STOPPED
```
**개정된 ⑦**: ⑦-가 실제 두 표는 **카탈로그로만**(CREATE TRIGGER 를 허용하는 TRIGGER 권한이 `has_table_privilege` 로 하나라도 true 면 아무것도 시도하지 않고 멈춘다) · ⑦-나 거동은 서브트랜잭션 안의 **일회용 표**(`public.p0017_probe_tbl`, TRIGGER 는 `service_role` 에게만)에서 — `anon`·`authenticated` 42501, `service_role` 성공(대조군), `anon` 에게 TRIGGER 만 주면 성공(카탈로그 ↔ 거동 일치), 매 시도의 `has_table_privilege` 예측과 결과를 대조 — 끝에서 통째로 되돌린다. 적용 롤에 public 스키마 CREATE 가 필요하다(`postgres` 는 있다).
R4 추가: 일회용 표는 **PUBLIC 까지** 회수하고, 매 시도 직전에 의도한 유효 권한만(TRIGGER 는 service_role·그 단계의 anon 에게만, 나머지 전부 false — 종류 열거) 있는지 단언한다. 아웃박스 함수 검사는 NULL `proacl` 을 기본 ACL(PUBLIC EXECUTE)로 읽고 공개 롤의 유효 EXECUTE 를 따로 본다. **적용 직전 필수: 0019 절의 "이벤트 트리거 확인"**(일회용 표 생성이 CREATE TABLE·CREATE TRIGGER 태그를 낸다).

### 로컬 실측 (2026-09-16, P5-13 구현)
| 표 | 롤 | 적용 전 | 적용 후 |
|---|---|---|---|
| `reservations`·`notifications_log` | `anon` | references, select, trigger | **(없음)** |
| `reservations`·`notifications_log` | `authenticated` | references, select, trigger | **select** |
| 같은 두 표 | `service_role`·`postgres` | 7종 전부 | **변화 없음** |

PUBLIC 롤 grant 0 · 따로 부여된 컬럼 ACL 0(`pg_class.relacl`·`pg_attribute.attacl` 을 `aclexplode` 로 전수) — 적용 전후 모두.

### 적용 경로
**`supabase db push` 만**(맨 위 「적용 경로」 — SQL Editor 는 읽기 확인용). **`psql -f` 를 쓰지 마라**(리뷰 K1).
⚠️ 자기검증 ⑦ 이 `set local role` 로 롤을 바꿔 `CREATE TRIGGER` 를 시도한다 — **적용하는 롤이 `anon`·`authenticated`·`service_role` 의 멤버여야 한다**(`postgres`/`supabase_admin` 은 멤버다). 아니면 마이그레이션이 "롤 전환 실패" 로 **명시적으로 멈춘다**(조용히 건너뛰지 않는다).
✅ 탐침 뒤 복원은 `reset role` 이 아니라 **캡처한 적용 롤로 `set local role`** 한다(2026-09-17 수정, GPT 검증 P2 — 0018 과 같은 형태). 로컬 실측 세 방식 통과: postgres 로그인 · supabase_admin 로그인 뒤 적용 롤을 postgres 로 전환 · supabase_admin 로그인 그대로. 수정 전 파일은 두 번째 방식에서 멈췄다.

### 롤백
`supabase/rollbacks/0017_pii_tables_trigger_references.down.sql` · **승인 플래그 요구**(`set bestour.rollback_0017_ack = '1';`). 근거: 되돌리면 `http_request` 트리거로 **접수마다 고객 개인정보가 외부로 나가는** 경로가 오류·로그·화면 변화 없이 다시 열린다. 되돌린 것을 필요로 하는 정상 경로는 하나도 없다.

> **원격 적용 완료 (2026-09-21 00:17 KST, 컨트롤러).** `supabase db push --linked` 로 0012~0019 여덟 파일을 한 번에 적용했다 — 전부 성공, 이력 마지막이 `0019`. 상세는 문서 맨 아래 「원격 적용 기록」.

---

## 0018 — 공개 롤의 시퀀스 권한 회수 (**원격 적용 완료 2026-09-21**)

**출처**: 사람이 아니라 **P6-11 게이트**(`tests/db-privilege-gate.test.ts`)가 첫 실행에서 36건을 이름으로 대며 찾았다. 기본 권한이 새 객체를 공개 롤에 여는 같은 뿌리의 **다섯 번째 사례**다.

1. `anon` — 일곱 시퀀스(`notices`·`popups`·`gallery`·`gallery_albums`·`showcase_routes`·`vehicles`·`notifications_log` `_id_seq`)에서 usage·select·update **전부**
2. `authenticated` — 일곱 시퀀스에서 select·update
3. `authenticated` — `notifications_log_id_seq` 에서 usage 도

🔴 **남기는 것: `authenticated` 의 콘텐츠 여섯 시퀀스 `usage`.** 관리자 화면의 insert 가 serial 기본값으로 `nextval` 한다. 이것을 잃으면 **표 insert 권한은 멀쩡한데 저장만 `42501 permission denied for sequence …` 로 실패**한다(로컬에서 일부러 회수해 봤더니 `gallery_albums` insert 가 403 이었다).
`service_role`·`postgres` 불변 — 통지 적재(서비스 롤)와 0010 definer 함수(소유자)가 `notifications_log_id_seq` 를 `nextval` 한다. 표·함수 권한은 건드리지 않는다.

**왜 회수하나**: `update` = `setval()`. `notifications_log_id_seq` 를 되감으면 이후 통지 적재가 **기본키 중복으로 전부 실패**한다 — 접수는 되는데 문자가 한 통도 나가지 않고, `setval` 은 행을 바꾸지 않아 흔적도 없다. 오늘 PostgREST 로 부를 경로는 없지만(`/rpc/setval`·`/rpc/nextval` → 404 PGRST202, `write-privileges` §5 가 매번 확인) "경로가 없으니 괜찮다" 는 0017(TRIGGER)에서 이미 틀렸다.

### 로컬 실측 (2026-09-17, P5-14 구현 · `has_sequence_privilege` 실효값)
| 시퀀스 | 롤 | 적용 전 | 적용 후 |
|---|---|---|---|
| 콘텐츠 여섯 | `anon` | usage, select, update | **(없음)** |
| 콘텐츠 여섯 | `authenticated` | usage, select, update | **usage** |
| `notifications_log_id_seq` | `anon`·`authenticated` | usage, select, update | **(없음)** |
| 일곱 전부 | `service_role`·`postgres` | usage, select, update | **변화 없음** |

`relacl` 부여자는 로컬에서 `postgres` 하나였다. PUBLIC(grantee 0) grant 0 — 적용 전후 모두. 적용 전후 권한 사실(표·컬럼·함수·정책·트리거 전수) diff 는 **시퀀스 7줄뿐**이었고 시퀀스 값도 그대로였다.
⚠️ **원격은 부여자가 다를 수 있다**(CLAUDE.md §3 — `postgres`·`supabase_admin` 둘). `revoke` 는 실행 롤이 준 grant 만 지운다. 자기검증 ① 이 부여자와 무관한 실효값을 보므로 남으면 **적용이 멈춘다** — 그때는 힌트의 `aclexplode` 질의로 부여자를 확인할 것.

### 자기검증 (마이그레이션 안의 DO 블록 — 실행 순서대로)
| 순서 | 항 | 멈추는 조건 |
|---|---|---|
| 1 | ④ PUBLIC | public 스키마 시퀀스에 PUBLIC grant 가 있다 — **① 보다 먼저** 본다(상속된 권한을 anon 의 것으로 오진하지 않게) |
| 2 | ① 행렬 | public 스키마 **모든** 시퀀스(카탈로그 열거)에서 `anon`·`authenticated` 권한이 콘텐츠 6 × `authenticated.usage` 밖에 있다 |
| 3 | ② 관리자 | 콘텐츠 여섯 중 하나라도 `authenticated.usage` 가 없다 |
| 4 | ③ 서비스 롤 | `service_role`·`postgres` 가 일곱 × 셋 중 하나라도 잃었다 |
| 5 | ⑤ 거동 | ⑤-가 실제 시퀀스: 공개 롤이 setval·nextval 을 허용할 수 있는 권한(열거)을 하나라도 가지면 **시도 없이** 멈춘다. ⑤-나 일회용 시퀀스(PUBLIC 까지 회수 · 매 단계 의도한 유효 권한만 단언): anon 거부 42501 · USAGE 만 가진 authenticated 는 setval 거부·nextval 성공 · UPDATE 만 받은 anon 은 둘 다 성공(대조군) · 예측과 결과가 다르면 멈춤. 서브트랜잭션째 되돌림 (R4) |

로컬에서 각 항을 **일부러 깨뜨려** 전부 멈추는 것을 확인했다(P5-14 보고서 ⑤ — 7변형, 멈추지 않은 것 0).

### 적용 경로
**`supabase db push` 만**(맨 위 「적용 경로」 — SQL Editor 는 읽기 확인용). **`psql -f` 를 쓰지 마라**(리뷰 K1). 로컬 단건 적용은 `psql -1`(단일 트랜잭션).
⚠️ 자기검증 ⑤ 가 `set local role` 로 롤을 바꾼다 — **적용하는 롤이 `anon`·`authenticated` 의 멤버여야 한다**(0017 과 같다). 아니면 "롤 전환 실패" 로 명시적으로 멈춘다.
⚠️ ⑤ 의 대조군은 `public.p0018_probe_seq` 를 **만들었다 되돌린다**(커밋되지 않는다). 적용 롤에 public 스키마 CREATE 가 필요하다(`postgres` 는 있다).
⚠️ 탐침 뒤 롤 복원은 `reset role` 이 아니라 **캡처한 적용 롤로 `set local role`** 한다(GPT 검증 P2). 로컬 실측 세 방식 모두 통과: postgres 로그인 · supabase_admin 로그인 뒤 적용 롤을 postgres 로 전환 · supabase_admin 로그인 그대로.
~~🔴 **0017 에는 같은 결함이 남아 있다**~~ → **0017 도 같은 두 줄로 고쳤다 (2026-09-17, P5-14 후속).** 수정 전에는 supabase_admin 로그인 뒤 적용 롤을 postgres 로 전환해 적용하면 `0017: 탐침이 롤을 되돌리지 못했다 (current_user=supabase_admin · 기대=postgres)` 로 멈췄다(로컬 재현). `db push` 가 0012~0018 을 한 번에 미므로 0017 이 멈추면 0018 까지 막혔을 것이다. 수정 후 세 방식 모두 통과. ✅

**🔴 적용 직전 스냅샷 (필수 절차)** — 0018 롤백은 이전 ACL 이 아니라 **기본 기준선**(anon·authenticated 전권)으로 복원한다(롤백 헤더). 원격 적용 **직전** 아래를 실행해 결과를 이 절에 날짜와 함께 붙여 둔다:
```sql
select c.relname, c.relacl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'S' order by 1;
```
기대(기준선): 일곱 개 모두 `anon=rwU`·`authenticated=rwU` 를 포함. **다르면**(이미 좁혀진 권한이 있으면) 롤백 파일의 부여 목록을 스냅샷에 맞게 고쳐 둔다 — 아니면 롤백이 0018 이 지운 적 없는 권한까지 연다.
**표 스냅샷도 함께 뜬다 (P5-15 — `MAINTAIN` 포함)**. 0012~0019 가 한 번에 밀리므로 시퀀스만 떠서는 0019 롤백을 판단할 수 없다. 표의 `relacl` 에는 PG17 의 `m`(MAINTAIN)이 들어 있다 — **글자 하나까지** 그대로 붙인다:
```sql
select c.relname, c.relkind, c.relacl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') order by 1;
select current_setting('server_version_num');
```
기대(기준선, 0011 상태의 원격): 콘텐츠 7표·개인정보 2표의 `anon=…`·`authenticated=…` 항목에 **`m` 이 있다**(`arwdDxtm`). `m` 이 **없으면** 원격은 16 이하에서 업그레이드된 DB 이거나 누가 좁힌 것이다 — 0019 롤백은 그 표에 없던 `m` 을 새로 주게 되므로 파일을 고쳐 둔다(0019 절).
부여자(`/postgres`)도 함께 본다 — `supabase_admin` 부여가 섞여 있으면 0018 의 자기검증 ① 이 적용을 멈춘다(위 "부여자" 경고).

### 적용 전/후 확인
아래 행렬(카탈로그 질의뿐)을 **읽기 확인용으로** SQL Editor 에 붙여 넣는다(적용 경로가 아니다). 붙이는 원문은 **이 runbook 의 블록뿐**이다.
(로컬 테스트도 이 표식 사이의 원문을 읽어 그대로 돌린다 — P5-15 astra R3.) 기대 문자열: `SEQ_NONE` · `ADMIN_SEQ_OK` · `SERVICE_SEQ_OK` · `SEQ_PUBLIC_NONE` · `SEQ_COUNT 7`.
<!-- P515:0018_MATRIX_SQL:BEGIN -->
```sql
select
  coalesce((select 'SEQ_LEAK ' || string_agg(format('%s/%s/%s', r.role, c.relname, p.priv), ' ')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'),('authenticated')) r(role)
     cross join (values ('usage'),('select'),('update')) p(priv)
    where n.nspname = 'public' and c.relkind = 'S'
      and has_sequence_privilege(r.role, c.oid, p.priv)
      and not (r.role = 'authenticated' and p.priv = 'usage' and c.relname in ('notices_id_seq','popups_id_seq','gallery_id_seq','gallery_albums_id_seq','showcase_routes_id_seq','vehicles_id_seq'))), 'SEQ_NONE') as leak,
  coalesce((select 'ADMIN_SEQ_LOST ' || string_agg(c.relname, ' ')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('notices_id_seq','popups_id_seq','gallery_id_seq','gallery_albums_id_seq','showcase_routes_id_seq','vehicles_id_seq')
      and not has_sequence_privilege('authenticated', c.oid, 'usage')), 'ADMIN_SEQ_OK') as admin_seq,
  coalesce((select 'SERVICE_SEQ_LOST ' || string_agg(format('%s/%s/%s', r.role, s.seq, p.priv), ' ')
     from (values ('service_role'),('postgres')) r(role)
     cross join (values ('public.notices_id_seq'),('public.popups_id_seq'),('public.gallery_id_seq'),('public.gallery_albums_id_seq'),('public.showcase_routes_id_seq'),('public.vehicles_id_seq'),('public.notifications_log_id_seq')) s(seq)
     cross join (values ('usage'),('select'),('update')) p(priv)
    where not has_sequence_privilege(r.role, s.seq, p.priv)), 'SERVICE_SEQ_OK') as service_seq,
  coalesce((select 'SEQ_PUBLIC_ACL ' || string_agg(format('%s/%s', c.relname, a.privilege_type), ' ')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public' and c.relkind = 'S' and a.grantee = 0), 'SEQ_PUBLIC_NONE') as seq_public,
  (select 'SEQ_COUNT ' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S') as seq_count;
```
<!-- P515:0018_MATRIX_SQL:END -->

**자기검증 ⑤ 개정 (P5-15 astra R3 → R4)**: **실제 시퀀스에는 `setval`·`nextval` 을 치지 않는다.** PostgreSQL 17 `src/backend/commands/sequence.c`: `nextval_internal` → `init_sequence(relid, &elm, &seqrel)` 후 `pg_class_aclcheck(elm->relid, GetUserId(), ACL_USAGE | ACL_UPDATE)` · `do_setval` → `init_sequence` 후 `pg_class_aclcheck(…, ACL_UPDATE)` · `lock_and_open_sequence` 는 `LockRelationOid(seq->relid, RowExclusiveLock)` 를 **최상위 트랜잭션 소유자**로 잡는다. 즉 거부될 시도도 **권한 검사 전에** 시퀀스의 ROW EXCLUSIVE 를 **마이그레이션 커밋까지** 쥔다(예외를 잡아도 풀리지 않는다). 앱의 `nextval` 과는 직접 충돌하지 않지만, 그 사이 `ALTER SEQUENCE`(SHARE ROW EXCLUSIVE)가 이 잠금 뒤에 줄을 서면 **그 뒤의 앱 `nextval` 이 ALTER 뒤에 줄을 선다**(간접 정지 — R3 에서 "무해" 라고 한 판단은 이것을 놓쳤다. R3 의 잠금 실측은 `reservations` 에 잠금을 걸었으므로 시퀀스 DDL 안전을 증명하지 못했다). 그래서 컨트롤러 결정대로 0017 ⑦ 과 같은 원칙을 따른다:
⑤-가 실제 시퀀스는 **카탈로그로만** — 그 호출을 허용할 수 있는 권한(`acldefault('s')` 열거, 소스상 허용하지 않는 것만 제외: SELECT 는 둘 다, USAGE 는 setval · 허용 경로 authenticated×콘텐츠 여섯×nextval 의 USAGE 제외)이 하나라도 있으면 `(실제 시퀀스에는 아무것도 시도하지 않았다)` 로 멈춘다. ⑤-나 거동은 **일회용 시퀀스**에서만 — PUBLIC 까지 회수하고, 매 단계 의도한 유효 권한만(열거) 있는지 단언한 뒤, anon(거부)·authenticated USAGE 만(setval 거부·nextval 성공)·anon UPDATE 만(둘 다 성공, 대조군)을 실행해 예측(소스 그대로)과 대조한다. **적용 직전 필수: 0019 절의 "이벤트 트리거 확인"**(일회용 시퀀스 생성이 CREATE SEQUENCE 태그를 낸다).
⛔ 같은 절의 거동 DO 블록은 **로컬 전용 — 원격에 붙이지 마라**(P5-15 astra R2 — 원격 확인은 카탈로그 질의만). 실제 시퀀스에 `setval`(권한이 남아 있으면 실행된다)·`nextval`(대조군 — 운영 번호를 소모한다)을 친다. 적용 시점의 거동 확인은 0018 자기검증 ⑤ 가 한다.

### 롤백
`supabase/rollbacks/0018_sequence_privileges.down.sql` · **승인 플래그 요구**(`set bestour.rollback_0018_ack = '1';`). **복원 대상은 기본 기준선이다 — 실행 전에 위 스냅샷과 대조할 것.** 0012~0017 롤백도 같은 방식(상행이 회수한 고정 목록을 조건 없이 부여)이다. 근거: 되돌리면 공개 롤이 `setval` 로 통지 시퀀스를 되감는 문이 오류·로그·화면 변화 없이 다시 열린다. 되돌린 것을 필요로 하는 정상 경로는 없다(앱 코드는 시퀀스를 직접 부르지 않는다).
로컬 실측: 플래그 없이 실행 → 멈춤(exit 3, 권한 불변). 플래그와 함께 실행 → 적용 전 실효 권한으로 복원되고 **게이트가 다시 36건으로 빨개졌다**. 0018 재적용 뒤 사실 전수 diff 동일.
⚠️ 관리자 "새 글 저장" 이 죽어서 롤백을 생각한다면 원인은 0018 이 아닐 가능성이 높다 — 0018 은 콘텐츠 여섯의 `authenticated` usage 를 남긴다. 먼저 `has_sequence_privilege('authenticated', 'public.notices_id_seq', 'usage')` 를 볼 것.

> **원격 적용 완료 (2026-09-21 00:17 KST, 컨트롤러).** `supabase db push --linked` 로 0012~0019 여덟 파일을 한 번에 적용했다 — 전부 성공, 이력 마지막이 `0019`. 상세는 문서 맨 아래 「원격 적용 기록」.

---

## 0019 — 공개 롤의 표 `MAINTAIN` 회수 (**원격 적용 완료 2026-09-21** · **PostgreSQL 17+ 전용, 버전 조건부**)

**출처**: P6-13 이 범위 밖에서 발견, 컨트롤러가 재측정. 그리고 **P6-11 게이트가 놓쳤다** — 권한 종류를 하드코딩했기 때문이다(후속 목록의 해당 항목). 기본 권한이 새 표를 `arwdDxtm` 으로 여는 같은 뿌리의 **여섯 번째 사례**다.

**`MAINTAIN` 이 허용하는 것**: `VACUUM` · `ANALYZE` · `CLUSTER` · `REINDEX` · `REFRESH MATERIALIZED VIEW` · **`LOCK TABLE`(모든 모드)**. **RLS 는 이것을 보지 않는다**(TRUNCATE·TRIGGER 와 같은 부류).
적용 전 로컬 실측(⛔ 아래 두 문장은 로컬에서 쟀다 — 원격에 붙이지 마라 · `set local role anon`): `lock table public.reservations in access exclusive mode nowait` → **`LOCK TABLE` 성공**, `analyze public.reservations` → **실제로 돌았다**(`pg_stat_user_tables.last_analyze` 갱신). 강한 잠금을 쥐는 동안 **예약 접수가 전부 멈춘다.** 오늘 PostgREST 로 도달할 경로는 없다 — 그러나 그 판단은 TRIGGER 때 틀렸다(0017).

1. `anon`·`authenticated` — public 스키마 **모든 표·뷰**(카탈로그 열거, 시퀀스 제외)에서 `MAINTAIN`
2. `service_role`·`postgres` 불변 · 다른 권한 전부 불변(자기검증 ④ 가 전후 ACL 전수를 대조)
3. 관리자 화면은 MAINTAIN 을 쓰지 않는다 — `tests/write-privileges.test.ts` §5-6 이 0019 뒤 관리자 CRUD(공지·팝업·앨범·사진·노선) 2xx, 앱의 실제 `enqueue`, 실제 파기 어댑터를 실행으로 확인한다.

### 🔴 적용 직전 필수 — 원격 버전 확인
```sql
select current_setting('server_version_num'), version();
```
- `>= 170000` → 0019 가 회수한다. 적용 로그에 `NOTICE: 0019: PostgreSQL 17.x — 공개 롤의 MAINTAIN 회수 완료 · 거동 탐침 N건 거부 확인 · 대조군 성공` 이 나와야 한다(로컬 N=14).
- `< 170000` → 0019 는 **아무것도 하지 않고** `NOTICE: 0019: PostgreSQL … MAINTAIN 권한이 없는 버전이다(17 부터). 회수를 건너뛴다.` 만 남긴다. **이 조건부가 없으면** 16 이하에서 `revoke maintain` 이 `ERROR: unrecognized privilege type "maintain"` 로 멈추고, `db push` 가 0012~0019 를 한 번에 밀므로 **원격 푸시 전체가 막힌다**(PostgreSQL 15 컨테이너에서 재현).
  그 경우 **17 로 업그레이드한 뒤**에는 기존 표 ACL 에 `m` 이 없을 수 있다(업그레이드는 옛 ACL 을 옮긴다). 그래도 **새로** 만드는 표는 기본 권한으로 `m` 을 받는다 — 고친 게이트가 이름을 대며 잡는다. 그때 0019 를 다시 돌리면 된다(재실행 안전).
- 🔴 **0016 의 `pg_temp` 판정도 버전 조건을 탄다** (P5-15 R8): `search_path` 항목을 스키마 목록으로 풀 때 **세로 탭(`chr(11)`)을 공백으로 치는 것은 17 이상뿐**이다(실측: 15.17 `{}` · 16.15 `{}` · 17.6 `{public}` · 18.6 `{public}`). 스페이스·탭·LF·CR·FF 는 모든 버전에서 공백이다. 원격이 **15·16 이면** `search_path` 에 세로 탭이 섞인 값만 판정이 달라진다 — 0016 은 `set search_path = public, pg_temp` 라는 **평범한 값**을 쓰므로 이 조건이 적용을 막지 않는다. 같은 판정이 0016 ④·0016 롤백·0016 절 행렬·게이트 네 곳에 있고 모두 서버 버전을 읽어 맞춘다.
- 자기검증 ⑤ 가 **버전 판정과 서버 능력**(`aclexplode(acldefault('r', …))` 에 MAINTAIN 이 있는가)을 대조한다. 어긋나면 멈춘다 — 버전 번호만 믿고 조용히 건너뛰지 않는다.
- 위 0018 절의 **적용 직전 스냅샷(표 포함)**을 함께 뜬다 — 0019 롤백 판단에 필요하다.

### 🔴 적용 직전 필수 — 이벤트 트리거 확인 (0017·0018·0019 공통, P5-15 astra R4)
세 마이그레이션의 자기검증은 적용 중에 **일회용 객체**를 만든다(0017: 표 `p0017_probe_tbl` 과 그 위 트리거 · 0018: 시퀀스 `p0018_probe_seq` · 0019: 표 `p0019_probe_tbl` — 명령 태그 CREATE TABLE·CREATE TRIGGER·CREATE SEQUENCE). 끝에서 통째로 되돌리지만, **이벤트 트리거는 명령 태그로 분기할 수 있고 외부 부수효과는 되돌려지지 않는다.** "REVOKE 도 DDL 이니 같다" 는 틀린 논거였다(R3 에서 그렇게 적었다 — 정정). 원격 적용 **직전**에 아래 읽기 질의를 실행한다:
```sql
select evtname, evtevent, evttags, evtfoid::regproc, evtenabled, md5(pg_get_functiondef(evtfoid)) as body_md5
  from pg_event_trigger order by evtname;
```
**로컬 기준 목록**(2026-09-17 · Supabase 기본 — 전부 소유자 supabase_admin · `evtenabled = O`):

| evtname | evtevent | evttags | evtfoid | body_md5 |
|---|---|---|---|---|
| `issue_graphql_placeholder` | `sql_drop` | `{DROP EXTENSION}` | `set_graphql_placeholder` | `4f4a0b1162d1c629f29d40d8fd787e30` |
| `issue_pg_cron_access` | `ddl_command_end` | `{CREATE EXTENSION}` | `grant_pg_cron_access` | `efa7df0e6a8d3588febef183c9146993` |
| `issue_pg_graphql_access` | `ddl_command_end` | `{CREATE EXTENSION}` | `grant_pg_graphql_access` | `2be0ce49a11c5163eb837b1f21901124` |
| `issue_pg_net_access` | `ddl_command_end` | `{CREATE EXTENSION}` | `grant_pg_net_access` | `397e5cbc06c307d43caf104cd97c2e22` |
| `pgrst_ddl_watch` | `ddl_command_end` | (없음 — 모든 태그) | `pgrst_ddl_watch` | `c87f2ceb165e84c9f894808613facb4d` |
| `pgrst_drop_watch` | `sql_drop` | (없음) | `pgrst_drop_watch` | `7d26bc43b1e03b4de5aa79cb5b8cb28a` |

**멈추고 컨트롤러에게 보고할 조건**: ⓐ 위 목록에 **없는** 트리거가 있다 ⓑ 어떤 트리거의 `evttags` 가 `CREATE TABLE`·`CREATE SEQUENCE`·`CREATE TRIGGER` 를 포함한다 ⓒ 위 목록의 트리거가 다른 함수를 가리키거나 **함수 본문 md5 가 다르다**(원격은 Supabase 버전에 따라 다를 수 있다 — 다르면 본문을 읽고 판단을 받는다).
**R3 논거가 틀렸다는 실례가 이 DB 에 있다**: `pgrst_ddl_watch` 는 트리거 수준 태그 필터가 없지만 **함수 안에서** `command_tag IN ('CREATE TABLE', …, 'CREATE TRIGGER', …)` 로 분기해 `NOTIFY pgrst, 'reload schema'` 를 낸다 — GRANT/REVOKE 에는 반응하지 않는다. 일회용 객체 생성에만 반응하는 것이다. 이 경우는 NOTIFY 가 트랜잭션에 묶여 있어 되돌려진 서브트랜잭션의 알림이 나가지 않으므로 무해하다(적용 트랜잭션이 커밋돼도 되돌려진 부분의 알림은 버려진다 — 로컬 실측: `listen pgrst` 세션에서 savepoint 안의 표 생성을 되돌리고 커밋 → 알림 없음 · 대조군으로 생성·삭제를 커밋 → `Asynchronous notification "pgrst" with payload "reload schema"` 수신).

### 로컬 실측 (2026-09-17, P5-15 구현 · PostgreSQL 17.6)
| 표 | 롤 | 적용 전 | 적용 후 |
|---|---|---|---|
| 콘텐츠 6 · places · reservations · notifications_log | `anon`·`authenticated` | `has_table_privilege(…, 'MAINTAIN')` = true | **false** |
| 위 9 + admin_users | `service_role` | true | **true (불변)** |
| admin_users | `anon`·`authenticated` | false (0009) | false |

적용 전후 권한 사실 전수(표·컬럼·시퀀스 ACL, 함수 ACL·설정, 정책, 트리거, 스키마 ACL, 기본 권한) diff 는 **9표의 `m` 글자뿐**이었다. PUBLIC(grantee 0) MAINTAIN 0.
적용 후 공개 롤로 직접 시도: `LOCK … ACCESS EXCLUSIVE` → `42501 permission denied for table …` · `VACUUM`/`ANALYZE` → `WARNING: permission denied to vacuum/analyze "…", skipping it`(통계 시각 불변). `service_role` 은 셋 다 성공.

### 자기검증 (DO 블록 하나 — 실행 순서대로)
| 순서 | 항 | 멈추는 조건 |
|---|---|---|
| 1 | ⑤ 분기 | 버전 판정(`>= 170000`)과 서버 능력(MAINTAIN 을 아는가)이 어긋난다. 17 미만이면 여기서 notice 후 `return` |
| 2 | ③ PUBLIC | public 표에 PUBLIC 의 MAINTAIN 이 있다 — **① 보다 먼저**(상속을 anon 의 것으로 오진하지 않게) |
| 3 | ① 행렬 | public **모든** 표·뷰(카탈로그)에서 `anon`·`authenticated` 의 MAINTAIN 이 true |
| 4 | ② 서비스 롤 | `service_role`·`postgres` 의 MAINTAIN 이 적용 전과 다르다(업그레이드 DB 의 옛 ACL 을 이유로 막지 않도록 "true" 가 아니라 "불변" 을 본다) |
| 5 | ④ 불변 | 적용 전후 ACL 전수(종류 불문 · 컬럼 포함)에서 공개 롤 MAINTAIN 외에 달라진 것이 있다 |
| 6 | ⑥ 거동 | **시도 직전** 그 롤이 그 표에 SELECT 외 권한(열거)을 하나라도 가지면 LOCK 없이 멈춘다. 통과하면 `set local role` 로 공개 롤이 되어, "강한 잠금을 허용할 수 있는 것이 MAINTAIN 뿐인" 조합 전부(로컬 14)에 `LOCK … ACCESS EXCLUSIVE MODE NOWAIT` 를 쳐서 42501 이 아니면 멈춘다. 대조군: MAINTAIN **하나만** 준 임시 표에서 같은 문장이 성공해야 한다(서브트랜잭션째 되돌림). 탐침 대상 0 도 멈춘다 |

로컬에서 **10변형을 일부러 깨뜨려 전부 멈추는 것**을 확인했다(P5-15 보고서 ⑧). 기준선(원본)은 센티넬에서만 멈췄고 실행 뒤 사실 전수 diff 0.

### 적용 경로
**`supabase db push` 만**(맨 위 「적용 경로」 — SQL Editor 는 읽기 확인용). **`psql -f` 를 쓰지 마라**(리뷰 K1). 로컬 단건 적용은 `psql -1`.
⚠️ ⑥ 이 `set local role` 로 롤을 바꾼다 — 적용 롤이 `anon`·`authenticated` 의 멤버여야 한다(0017·0018 과 같다). 복원은 `reset role` 이 아니라 **캡처한 적용 롤로 `set local role`**. 로컬 세 방식 모두 통과: postgres 로그인 · supabase_admin 로그인 뒤 적용 롤을 postgres 로 전환 · supabase_admin 로그인 그대로(각각 `after|<session>|<적용 롤>` 유지). `reset role` 로 바꾼 변형은 B 방식에서 `0019: 탐침 뒤 적용 롤(postgres)로 돌아오지 못했다 (current_user=supabase_admin)` 로 멈춘다(실측).
⚠️ ⑥ 의 대조군은 `public.p0019_probe_tbl` 을 만들었다 되돌린다 — 적용 롤에 public 스키마 CREATE 가 필요하다. 탐침은 `NOWAIT` 이고 거부되는 시도는 잠금을 잡지 않는다(권한 검사가 먼저다).
⚠️ **0019 가 닫지 못한 것**: `authenticated` 는 콘텐츠 여섯 표를 UPDATE·DELETE 권한으로 여전히 강하게 잠글 수 있었다(`known-defects` D10). → **0020(P5-16)이 닫았다** — 아래 0020 절.

### 적용 전/후 확인
🔴 **원격에서는 카탈로그 질의만 실행한다** (astra R2 P1-A · 컨트롤러 결정 2026-09-17). 잠금·DDL·DML·롤 전환 문장은 원격 확인 절차에 **하나도 없다**. 로컬 검사가 0017·0018·0019 절의 모든 코드 블록(``` · ~~~ · 언어 무관)과 산문을 문장 모양으로 훑고, 저장소의 검사 파일·검사 절 번호를 붙이라는 안내도 잡는다. ⚠️ **그것은 회귀 방지 보조일 뿐 보증이 아니다** — 정규식 휴리스틱이라 문장을 쪼개거나 풀어 쓰면 빠진다. 원격에 붙이기 전에 사람이 블록을 읽는다(P5-15 astra R4). 적용 시점의 거동 확인(실제 LOCK 거부)은 0019 자기검증 ⑥ 이 이미 했다(시도 직전 사전 검사로 잠금 획득이 구조적으로 불가능한 조합만 친다 — 아래 근거).

아래 행렬(카탈로그 질의뿐)을 **읽기 확인용으로** SQL Editor 에 붙여 넣는다(적용 경로가 아니다). 붙이는 원문은 **이 runbook 의 블록뿐**이다.
(로컬 테스트도 이 표식 사이의 원문을 읽어 그대로 돌린다.) 기대 문자열: `MAINTAIN_NONE` · `SERVICE_MAINTAIN_OK` · `MAINTAIN_PUBLIC_NONE` · `BASELINE_PRESENT 9`. (17 미만이면 이 질의는 `unrecognized privilege type` 으로 실패한다 — 버전부터 볼 것.)
<!-- P515:MAINTAIN_MATRIX_SQL:BEGIN -->
```sql
select
  coalesce((select 'MAINTAIN_LEAK ' || string_agg(format('%s/%s', r.role, c.relname), ' ')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'),('authenticated')) r(role)
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
      and has_table_privilege(r.role, c.oid, 'MAINTAIN')), 'MAINTAIN_NONE') as leak,
  coalesce((select 'SERVICE_MAINTAIN_LOST ' || string_agg(c.relname, ' ')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not has_table_privilege('service_role', c.oid, 'MAINTAIN')), 'SERVICE_MAINTAIN_OK') as svc,
  coalesce((select 'MAINTAIN_PUBLIC_ACL ' || string_agg(c.relname, ' ')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','f') and a.grantee = 0 and a.privilege_type = 'MAINTAIN'), 'MAINTAIN_PUBLIC_NONE') as pub,
  (select 'BASELINE_PRESENT ' || count(*) from unnest(array['public.notices','public.popups','public.gallery','public.gallery_albums','public.showcase_routes','public.vehicles','public.places','public.reservations','public.notifications_log']) t(n) where to_regclass(t.n) is not null) as baseline;
```
<!-- P515:MAINTAIN_MATRIX_SQL:END -->

⚠️ **`SERVICE_MAINTAIN_LOST …` 가 나와도 곧바로 실패가 아니다**(astra P2-6). 원격이 16→17 업그레이드 DB 면 기존 표 ACL 에 `m` 이 원래 없을 수 있다 — 0019 는 service_role 을 건드리지 않는다(상행 ② 는 "불변" 을 본다). **적용 직전 스냅샷과 대조**해서, 스냅샷에 `service_role=…m…` 이 있던 표만 문제로 본다. 롤백의 같은 검사도 그래서 경고(`WARNING`)만 한다.

⛔ **LOCK 거동 블록(`LOCK_PROBE_SQL`)은 로컬 테스트 전용이다 — 원격에 붙이지 마라.** (1라운드에서 이 절이 그것을 붙이라고 했다. 거부를 "기대" 할 뿐이라 권한이 예상과 달리 남아 있으면 실제 표 잠금이 **잡히고** 되돌릴 때까지 접수가 막힌다. 일회용 표 DDL 은 운영 이벤트 트리거를 태운다.)

**0019 ⑥ 이 적용 중에 실제 표에 LOCK 을 시도해도 잠금을 얻을 수 없는 이유**: ① 이 ⑥ 보다 먼저 돌아 공개 롤의 MAINTAIN 이 남았으면 거기서 멈춘다. 그리고 ⑥ 은 **시도 직전에** 그 롤이 그 표에 SELECT 외의 권한(종류는 `acldefault` 에서 열거 — MAINTAIN·UPDATE·DELETE·TRUNCATE·INSERT…)을 하나라도 가지면 **LOCK 없이 멈춘다**(`… — 잠금을 시도하지 않고 멈춘다`). ACCESS EXCLUSIVE 는 아래 `LockTableAclCheck` 대로 MAINTAIN|UPDATE|DELETE|TRUNCATE 중 하나를 요구하므로, 사전 검사를 통과한 조합은 잠금을 얻을 수 없고 권한 검사에서 42501 로 끝난다. 사전 검사가 없던 판은 ① 을 가린 깨뜨리기 변형에서 `gallery` 의 잠금을 **실제로 잡았다가** 되돌렸다(P5-15 보고서 수정 라운드 2).
⑥ 의 대조군(일회용 표 `p0019_probe_tbl`)은 적용 중의 DDL 이다 — 이벤트 트리거가 태그로 분기할 수 있으므로 위 "적용 직전 필수 — 이벤트 트리거 확인" 을 거친다(R3 의 "revoke 도 DDL 이니 같다" 는 틀렸다 — 정정). 대조군 표는 PUBLIC 까지 회수하고, LOCK 직전에 anon 의 MAINTAIN **하나만** 유효한지(열거) 단언한다(R4).
⚠️ **수용한 한계(TOCTOU)**: ⑥ 의 사전 검사와 LOCK 은 별개의 문장이다. 그 사이에 다른 세션이 공개 롤의 멤버십(예: `pg_maintain`)을 바꾸면 사전 검사가 본 상태와 LOCK 의 권한 검사가 다를 수 있다 — 적용 중 동시 멤버십 변경이 전제이므로 수용한다(컨트롤러 2026-09-17).
PostgreSQL 17 `src/backend/commands/lockcmds.c`:
```c
reloid = RangeVarGetRelidExtended(rv, lockstmt->mode,
                                  lockstmt->nowait ? RVR_NOWAIT : 0,
                                  RangeVarCallbackForLockTable,
                                  (void *) &lockstmt->mode);
/*
 * Before acquiring a table lock on the named table, check whether we have
 * permission to do so.
 */
static void RangeVarCallbackForLockTable(…)
    …
    /* Check permissions. */
    aclresult = LockTableAclCheck(relid, lockmode, GetUserId());
    if (aclresult != ACLCHECK_OK)
        aclcheck_error(aclresult, …, rv->relname);
```
`src/backend/catalog/namespace.c` `RangeVarGetRelidExtended` 머리 주석: *"Callback allows caller to check permissions or acquire additional locks prior to grabbing the relation lock."* — 콜백이 `LockRelationOid`/`ConditionalLockRelationOid` 보다 먼저 불린다. `LockTableAclCheck` 는 `ACL_MAINTAIN | ACL_UPDATE | ACL_DELETE | ACL_TRUNCATE`(약한 모드는 +SELECT·INSERT)를 요구한다 — 그래서 `authenticated` 는 UPDATE·DELETE 가 있는 콘텐츠 표를 잠글 수 있다(`known-defects` D10). 로컬 실측 오류 위치도 `aclcheck_error, aclchk.c` 였다.

### 롤백
`supabase/rollbacks/0019_maintain_privilege.down.sql` · **승인 플래그 요구**(`set bestour.rollback_0019_ack = '1';`), 버전 판정보다 먼저. **복원 대상은 기본 기준선**(아홉 표 × 두 공개 롤 MAINTAIN, `admin_users` 제외, 표 이름 고정 목록)이다 — 실행 전에 적용 직전 표 스냅샷과 대조할 것. 16 이하에서는 notice 만 남기고 아무것도 하지 않는다.
근거: 되돌리면 `anon` 이 `LOCK TABLE reservations … ACCESS EXCLUSIVE` 로 접수를 멈추는 문이 오류·로그·화면 변화 없이 다시 열린다. 되돌린 것을 필요로 하는 정상 경로는 없다.
⚠️ **플래그는 기준선이 맞는지를 검증하지 않는다**(astra P2-6). 롤백은 고정 목록(아홉 표 × 두 롤)을 부여한다 — 적용 직전 스냅샷에서 `m` 이 없던 표가 있으면 **파일을 고친 뒤** 실행한다. 롤백 검증의 service_role MAINTAIN 검사는 **경고(WARNING)만** 한다: 롤백은 그 권한을 없앨 수 없고, 업그레이드 DB 에서는 원래 없었을 수 있기 때문이다(로컬 실측: 되돌려지는 트랜잭션에서 places 의 service_role `m` 을 뺀 뒤 롤백 본문 → `WARNING` 후 끝까지 진행).
로컬 실측: 플래그 없이 → 멈춤(exit 3, ACL 불변). 플래그와 함께 → 사실 전수가 **0019 적용 전과 동일**. 그 상태에서 게이트가 다시 **18건으로 빨개지고** §18·§5-6 도 빨개졌다(`MAINTAIN_LEFT`). 0019 재적용 두 번 → exit 0 · 사실이 최초 적용과 동일(멱등). PostgreSQL 15 컨테이너에서도 롤백은 플래그 없이 멈추고, 플래그와 함께면 notice 만 남기고 ACL 불변.

> **원격 적용 완료 (2026-09-21 00:17 KST, 컨트롤러).** `supabase db push --linked` 로 0012~0019 여덟 파일을 한 번에 적용했다 — 전부 성공, 이력 마지막이 `0019`. 상세는 문서 맨 아래 「원격 적용 기록」.

---

## 0020 — 관리자 콘텐츠 쓰기를 definer 함수로 (**D10 을 닫는다** · **원격 적용 완료 2026-09-21**)

**무엇을 하나**: 콘텐츠 여섯 표(`notices`·`popups`·`gallery`·`gallery_albums`·`showcase_routes`·`vehicles`)에서
`authenticated` 의 **쓰기 세 동작을 회수**하고, 관리자 화면의 쓰기를 **security definer 함수 18개**로 옮긴다.
0009 의 `*_admin_all` 정책은 같은 조건(`is_admin()`)의 `*_admin_select` 로 좁힌다 — **관리자 읽기는 그대로**다.

**왜**(`known-defects` D10): PostgreSQL 은 `ACCESS EXCLUSIVE` 같은 강한 표 잠금을 **MAINTAIN·UPDATE·DELETE·TRUNCATE
중 하나**로 허용한다(0019 절 맨 아래 `LockTableAclCheck` 인용). 0019 가 MAINTAIN 을 걷었지만 관리자 화면 때문에
`authenticated` 에 UPDATE·DELETE 가 남아 있었고, 그래서 **로그인만 하면(관리자 명단에 없어도)** 그 여섯 표를 잠가
공개 화면과 관리자 화면을 함께 멈출 수 있었다. RLS 는 이것을 보지 않는다. 0020 적용 직전 로컬 실측에서 여섯 표 전부
실제로 잠겼다. 지금까지의 결정은 "공개 가입이 막혀 있다(D2)" 에 기댄 **C(기록하고 둠)** 였고, 사장님 지시로 **A** 를 구현했다.

**정상 경로가 막히지 않는 이유**: 관리자 쓰기는 definer 함수가 소유자 권한으로 수행하고, 함수 첫 문장이 `is_admin()`
가드다(0010 이 예약 전이에 쓴 것과 같은 구조). 공개 접수·아웃박스 적재·파기 크론은 서비스 롤이라 무관하다.
`vehicles` 는 **관리자 쓰기 경로가 저장소에 없다**(읽기 전용) — 함수를 만들지 않고 회수만 했다.

### 🔴 배포 순서 — **원격 적용이 코드 배포보다 먼저다**
이 마이그레이션과 앱 코드(`lib/admin/*.ts`)는 **짝**이다. 한쪽만 하면 관리자 화면의 저장이 전부 실패한다:
- 코드를 먼저 배포하면 → 새 RPC 가 아직 없어 `PGRST202`
- 적용만 하고 옛 코드가 남으면 → 표 쓰기 권한이 없어 `42501`
순서: **0020 적용 → 스키마 캐시 갱신 확인(아래) → 코드 배포.** 되돌릴 때는 반대다(0020 절 「롤백」).
🔴 **적용 직전 필수 — 옛 쓰기 코드가 어디에도 돌고 있지 않은가** (GPT astra P2, P5-16). 위 두 실패는 **어느 순서로 해도 그 사이 창에서는 생긴다** — 짝을 동시에 바꿀 방법이 없다. 그래서 창을 짧게 하는 것이 아니라 **창에서 저장하는 사람이 없음**을 확인하고 적용한다:
- **운영 배포본**: 2026-09-21 기준 `main` 에는 관리자 쓰기 경로가 없다(`git ls-tree main` 에 `lib/admin/*` 쓰기 없음 — 0014 때와 같은 확인). 적용 직전에 **Vercel 운영 배포본이 어느 커밋인지** 다시 본다.
- **프리뷰 배포본**: `feature/implementation` 의 옛 커밋으로 만든 프리뷰가 **운영 DB 를 가리키면** 그 프리뷰의 관리자 저장이 적용 순간부터 42501 로 실패한다. 프리뷰 env 가 별도 프로젝트(P0-2)인지 확인한다. 같다면 적용 전에 프리뷰를 새 코드로 다시 배포하거나 사용하지 않음을 확인한다.
- **사람**: 사장님이 그 시간에 관리자 화면에서 저장하지 않는다(관리자 화면은 아직 운영에 공개되지 않았다 — 오늘은 해당 없음).
이 셋이 확인되면 창은 무해하다. 하나라도 불명이면 **멈추고 컨트롤러에게 보고한다.**
⚠️ **스키마 캐시** — PostgREST 는 함수 목록을 캐시한다. 이 DB 의 `pgrst_ddl_watch` 이벤트 트리거가
`NOTIFY pgrst, 'reload schema'` 를 내므로 자동 갱신되지만(2026-09-21 원격 본문 확인), 적용 직후 아래 행렬의 `FN_OK` 와
관리자 화면 저장 한 번으로 실제 반영을 확인한다.

### 적용 경로
**`supabase db push` 만**(맨 위 「적용 경로」 — SQL Editor 는 읽기 확인용). **`psql -f` 를 쓰지 마라**(리뷰 K1). 로컬 단건 적용은 `psql -1`.
⚠️ 자기검증 ⑧ 이 롤을 바꾼다 — 적용 롤이 `anon`·`authenticated` 의 멤버여야 한다(0017·0018·0019 와 같다). 복원은 `reset role` 이 아니라 **캡처한 적용 롤**이다. 로컬 세 방식 모두 통과: postgres 로그인 · supabase_admin 로그인 뒤 적용 롤을 postgres 로 전환 · supabase_admin 로그인 그대로.
⚠️ 자기검증 ⑧ 의 대조군은 `public.p0020_probe_tbl` 을 만들었다 되돌린다 — 적용 롤에 public 스키마 CREATE 가 필요하고, 그 DDL 이 이벤트 트리거를 태운다(맨 위 ③).
⚠️ 탐침은 `NOWAIT` 이고, 시도 직전 사전 검사를 통과한 조합은 잠금을 **얻을 수 없다**(권한 검사가 잠금 획득보다 먼저다 — 0019 절의 `lockcmds.c` 인용과 같은 근거).

### 적용 전/후 확인
🔴 **원격에서는 카탈로그 질의만 실행한다** (astra R2 P1-A · 컨트롤러 결정 2026-09-17). 잠금·DDL·DML·롤 전환 문장은 원격 확인 절차에 **하나도 없다**. ⚠️ 로컬 스캐너는 회귀 방지 보조일 뿐 보증이 아니다 — 원격에 붙이기 전에 사람이 블록을 읽는다.

아래 행렬(카탈로그 질의뿐)을 **읽기 확인용으로** SQL Editor 에 붙여 넣는다(적용 경로가 아니다). 붙이는 원문은 **이 runbook 의 블록뿐**이다.
(로컬 검사도 이 표식 사이의 원문을 읽어 그대로 돌린다.)
- **적용 전** 기대: `CONTENT_EXTRA …`(여섯 표 × `authenticated` 에 쓰기 셋이 보인다) · `FN …`(18개가 전부 없다) · `POLICY …`(`*_admin_all` 이 있다)
- **적용 후** 기대: `CONTENT_SELECT_ONLY` · `CONTENT_SELECT_OK` · `CONTENT_PUBLIC_NONE` · `SERVICE_OK` · `FN_OK` · `POLICY_OK` · `CONTENT_COUNT 6`

<!-- P515:0020_MATRIX_SQL:BEGIN -->
```sql
select
  coalesce((select 'CONTENT_EXTRA ' || string_agg(format('%s/%s/%s', r.role, c.relname, lower(d.privilege_type)), ' ' order by c.relname, r.role, d.privilege_type)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'),('authenticated')) r(role)
     cross join lateral aclexplode(acldefault('r', c.relowner)) d
    where n.nspname = 'public'
      and c.relname = any (array['notices','popups','gallery','gallery_albums','showcase_routes','vehicles'])
      and d.privilege_type <> 'SELECT'
      and has_table_privilege(r.role, c.oid, d.privilege_type)), 'CONTENT_SELECT_ONLY') as content,
  coalesce((select 'CONTENT_SELECT_LOST ' || string_agg(format('%s/%s', r.role, c.relname), ' ' order by c.relname, r.role)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'),('authenticated')) r(role)
    where n.nspname = 'public'
      and c.relname = any (array['notices','popups','gallery','gallery_albums','showcase_routes','vehicles'])
      and not has_table_privilege(r.role, c.oid, 'SELECT')), 'CONTENT_SELECT_OK') as reads,
  coalesce((select 'CONTENT_PUBLIC_ACL ' || string_agg(format('%s/%s', c.relname, lower(a.privilege_type)), ' ' order by c.relname, a.privilege_type)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = 'public'
      and c.relname = any (array['notices','popups','gallery','gallery_albums','showcase_routes','vehicles'])
      and a.grantee = 0), 'CONTENT_PUBLIC_NONE') as pub,
  coalesce((select 'SERVICE_LOST ' || string_agg(format('%s/%s/%s', w.role, c.relname, lower(d.privilege_type)), ' ' order by c.relname, w.role, d.privilege_type)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('service_role'),('postgres')) w(role)
     cross join lateral aclexplode(acldefault('r', c.relowner)) d
    where n.nspname = 'public'
      and c.relname = any (array['notices','popups','gallery','gallery_albums','showcase_routes','vehicles'])
      and not has_table_privilege(w.role, c.oid, d.privilege_type)), 'SERVICE_OK') as service,
  coalesce((select 'FN ' || string_agg(x, ' ' order by x) from (
     select format('MISSING:%s', s.sig) as x
       from unnest(array['public.admin_create_notice(text,text,text,date,boolean)','public.admin_update_notice(integer,text,text,text,date,boolean)','public.admin_delete_notice(integer)','public.admin_set_notice_active(integer,boolean)','public.admin_create_popup(text,text,text,date,date,boolean)','public.admin_update_popup(integer,text,text,text,date,date,boolean)','public.admin_delete_popup(integer)','public.admin_set_popup_active(integer,boolean)','public.admin_create_gallery_photo(text,text,integer,integer,integer,integer,text,integer,boolean)','public.admin_update_gallery_photo(integer,text,integer,integer)','public.admin_set_gallery_photo_active(integer,boolean)','public.admin_delete_gallery_photo(integer)','public.admin_create_album(text,text,integer,boolean)','public.admin_update_album(integer,text,text,integer,boolean)','public.admin_set_album_active(integer,boolean)','public.admin_delete_album(integer)','public.admin_update_route(integer,text,text,integer,integer,boolean)','public.admin_set_route_active(integer,boolean)']) s(sig)
      where to_regprocedure(s.sig) is null
     union all
     select format('OPEN:%s/%s', s.sig, w.role)
       from unnest(array['public.admin_create_notice(text,text,text,date,boolean)','public.admin_update_notice(integer,text,text,text,date,boolean)','public.admin_delete_notice(integer)','public.admin_set_notice_active(integer,boolean)','public.admin_create_popup(text,text,text,date,date,boolean)','public.admin_update_popup(integer,text,text,text,date,date,boolean)','public.admin_delete_popup(integer)','public.admin_set_popup_active(integer,boolean)','public.admin_create_gallery_photo(text,text,integer,integer,integer,integer,text,integer,boolean)','public.admin_update_gallery_photo(integer,text,integer,integer)','public.admin_set_gallery_photo_active(integer,boolean)','public.admin_delete_gallery_photo(integer)','public.admin_create_album(text,text,integer,boolean)','public.admin_update_album(integer,text,text,integer,boolean)','public.admin_set_album_active(integer,boolean)','public.admin_delete_album(integer)','public.admin_update_route(integer,text,text,integer,integer,boolean)','public.admin_set_route_active(integer,boolean)']) s(sig)
       cross join (values ('anon'),('service_role')) w(role)
      where to_regprocedure(s.sig) is not null and has_function_privilege(w.role, to_regprocedure(s.sig), 'execute')
     union all
     select format('NOADMIN:%s', s.sig)
       from unnest(array['public.admin_create_notice(text,text,text,date,boolean)','public.admin_update_notice(integer,text,text,text,date,boolean)','public.admin_delete_notice(integer)','public.admin_set_notice_active(integer,boolean)','public.admin_create_popup(text,text,text,date,date,boolean)','public.admin_update_popup(integer,text,text,text,date,date,boolean)','public.admin_delete_popup(integer)','public.admin_set_popup_active(integer,boolean)','public.admin_create_gallery_photo(text,text,integer,integer,integer,integer,text,integer,boolean)','public.admin_update_gallery_photo(integer,text,integer,integer)','public.admin_set_gallery_photo_active(integer,boolean)','public.admin_delete_gallery_photo(integer)','public.admin_create_album(text,text,integer,boolean)','public.admin_update_album(integer,text,text,integer,boolean)','public.admin_set_album_active(integer,boolean)','public.admin_delete_album(integer)','public.admin_update_route(integer,text,text,integer,integer,boolean)','public.admin_set_route_active(integer,boolean)']) s(sig)
      where to_regprocedure(s.sig) is not null and not has_function_privilege('authenticated', to_regprocedure(s.sig), 'execute')
     union all
     select format('PUBLIC:%s', s.sig)
       from unnest(array['public.admin_create_notice(text,text,text,date,boolean)','public.admin_update_notice(integer,text,text,text,date,boolean)','public.admin_delete_notice(integer)','public.admin_set_notice_active(integer,boolean)','public.admin_create_popup(text,text,text,date,date,boolean)','public.admin_update_popup(integer,text,text,text,date,date,boolean)','public.admin_delete_popup(integer)','public.admin_set_popup_active(integer,boolean)','public.admin_create_gallery_photo(text,text,integer,integer,integer,integer,text,integer,boolean)','public.admin_update_gallery_photo(integer,text,integer,integer)','public.admin_set_gallery_photo_active(integer,boolean)','public.admin_delete_gallery_photo(integer)','public.admin_create_album(text,text,integer,boolean)','public.admin_update_album(integer,text,text,integer,boolean)','public.admin_set_album_active(integer,boolean)','public.admin_delete_album(integer)','public.admin_update_route(integer,text,text,integer,integer,boolean)','public.admin_set_route_active(integer,boolean)']) s(sig)
       join pg_proc p on p.oid = to_regprocedure(s.sig)
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
     union all
     select format('MODE:%s(prosecdef=%s,config=%s)', s.sig, p.prosecdef, coalesce(array_to_string(p.proconfig, ' '), '(none)'))
       from unnest(array['public.admin_create_notice(text,text,text,date,boolean)','public.admin_update_notice(integer,text,text,text,date,boolean)','public.admin_delete_notice(integer)','public.admin_set_notice_active(integer,boolean)','public.admin_create_popup(text,text,text,date,date,boolean)','public.admin_update_popup(integer,text,text,text,date,date,boolean)','public.admin_delete_popup(integer)','public.admin_set_popup_active(integer,boolean)','public.admin_create_gallery_photo(text,text,integer,integer,integer,integer,text,integer,boolean)','public.admin_update_gallery_photo(integer,text,integer,integer)','public.admin_set_gallery_photo_active(integer,boolean)','public.admin_delete_gallery_photo(integer)','public.admin_create_album(text,text,integer,boolean)','public.admin_update_album(integer,text,text,integer,boolean)','public.admin_set_album_active(integer,boolean)','public.admin_delete_album(integer)','public.admin_update_route(integer,text,text,integer,integer,boolean)','public.admin_set_route_active(integer,boolean)']) s(sig)
       join pg_proc p on p.oid = to_regprocedure(s.sig)
      where not p.prosecdef or coalesce(array_to_string(p.proconfig, ' '), '') <> 'search_path=public, pg_temp'
   ) y), 'FN_OK') as fns,
  coalesce((select 'POLICY ' || string_agg(x, ' ' order by x) from (
     select format('NO_ADMIN_SELECT:%s', t.n) as x
       from unnest(array['notices','popups','gallery','gallery_albums','showcase_routes','vehicles']) t(n)
      where not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                         where c.relname = t.n and p.polname = t.n || '_admin_select' and p.polcmd = 'r')
     union all
     select format('OLD_ADMIN_ALL:%s', t.n)
       from unnest(array['notices','popups','gallery','gallery_albums','showcase_routes','vehicles']) t(n)
      where exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                     where c.relname = t.n and p.polname = t.n || '_admin_all')
     union all
     select format('NO_PUBLIC_SELECT:%s', t.n)
       from unnest(array['notices','popups','gallery','gallery_albums','showcase_routes','vehicles']) t(n)
      where not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                         where c.relname = t.n and p.polname = t.n || '_select_active')
     union all
     select format('WRITE_POLICY:%s/%s', c.relname, p.polname)
       from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname = any (array['notices','popups','gallery','gallery_albums','showcase_routes','vehicles'])
        and p.polcmd <> 'r'
        and 'authenticated' = any (select r.rolname from pg_roles r where r.oid = any (p.polroles))
   ) z), 'POLICY_OK') as policies,
  (select 'CONTENT_COUNT ' || count(*) from unnest(array['public.notices','public.popups','public.gallery','public.gallery_albums','public.showcase_routes','public.vehicles']) t(n) where to_regclass(t.n) is not null) as cnt;
```
<!-- P515:0020_MATRIX_SQL:END -->

⛔ **거동 확인(실제 잠금 시도)은 로컬 테스트 전용이다 — 원격에 붙이지 마라.** 적용 시점의 거동 확인은 0020 자기검증 ⑧ 이 이미 한다(시도 직전 사전 검사로 잠금 획득이 구조적으로 불가능한 조합만 친다 · 대조군은 일회용 표).

**남은 것 (후속)**: 0018 이 남긴 `authenticated` 의 콘텐츠 여섯 시퀀스 `usage` 는 0020 뒤로 **쓰이지 않는다**(표 insert 가 없으니 serial 기본값도 부르지 않는다. definer 함수는 소유자 권한으로 돈다). 시퀀스 권한으로는 표를 잠글 수 없어 D10 과 무관하므로 0020 의 범위에서 뺐다 — 다음 권한 정리 때 함께 걷는다.

### 롤백
`supabase/rollbacks/0020_admin_content_writes.down.sql` · **승인 플래그 요구**(`set bestour.rollback_0020_ack = '1';`), 조건 없이 먼저.
되돌리는 것: 여섯 표의 `authenticated` 쓰기 세 동작 · 0009 의 `*_admin_all` 정책 · definer 함수 18개 제거.
🔴 **되돌리면 D10 이 다시 열린다** — 오류도 로그도 화면 변화도 없이. 그것이 플래그를 조건 없이 요구하는 이유다.
⚠️ **코드 롤백과 짝이다**: 앱을 0020 이전 코드로 먼저 되돌린 뒤 이 파일을 돌린다. 한쪽만 하면 관리자 저장이 `PGRST202`(함수 없음) 또는 `42501`(표 권한 없음)로 전부 실패한다.
재실행 가능: 로컬 실측(2026-09-21 P5-16) — 플래그 없이 멈춤 · 플래그 있으면 복원(ACL·정책·함수 스냅샷이 0020 이전과 **한 줄도 다르지 않다**) · 두 번 연달아 돌려도 오류 없음 · 그 뒤 0020 재적용 스냅샷이 첫 적용과 같다.
(처음 판은 되살리는 `*_admin_all` 을 먼저 지우지 않아 **두 번째 실행이 `policy … already exists` 로 멈췄다** — 인계 뒤 고쳤다.)

---

## 0021 — 청약철회 제한 확인 시각 칸 + 동의 기록 도입 뒤의 모든 접수에 필수 (**원격 미적용** · P1-7 · 수정 라운드 2 에서 설계 교체)

**무엇을 하나**: `reservations` 에 칸 둘을 더하고, 제약 셋과 트리거 하나를 건다.
- `withdrawal_consent_at timestamptz` — nullable · 기본값 없음. 앱이 접수 때 서버 시각을 넣는다(`lib/reservations/consent.ts`).
- `withdrawal_consent_legacy boolean not null` — **이 파일이 표를 쥔 순간에 있던 행만 `true`**, 그 뒤 들어오는 행은 기본값 `false`.
- `reservations_withdrawal_consent_required` — `withdrawal_consent_at is not null or withdrawal_consent_legacy` (VALID)
- `reservations_withdrawal_consent_before_created` · `reservations_withdrawal_consent_not_stale` — 0003 과 같은 폭(+5분 / -1일)
- 트리거 `reservations_withdrawal_legacy_guard`(before insert or update · 행 단위 · WHEN 조건 없음) — 새 행을 legacy=true 로 넣는 것, legacy 를 false→true 로, true→false 로 바꾸는 것을 전부 `23000` 으로 거부한다. 트리거 함수의 EXECUTE 는 공개 롤·`service_role` 모두에서 회수한다(발화에는 필요 없다 — 0015 선례).
- **두 개인정보 표(`reservations`·`notifications_log`)의 `TRIGGER` 권한을 `service_role` 에서 회수**한다 (R3 [P1-A] · astra R2 재현). **실제로 회수한 표는 트리거 함수 주석에 기록**되고 롤백이 그 목록만 되돌린다(R4 [P2-F] — 이미 굳혀 둔 DB 에서 없던 권한을 만들지 않는다).
- 자기검증이 함께 보는 것(R4 [P2-C]): 두 표의 유효 TRIGGER 를 **`pg_roles` 전수**로 보고(소유자·소유자 롤의 멤버·슈퍼유저만 검사 밖 — 그 이름은 적용 NOTICE 에 찍힌다), **`session_replication_role` 에 SET 권한 부여가 0** 인지 본다(`pg_parameter_acl` — 그 권한을 가진 롤은 `replica` 로 트리거를 통째로 끈다). 남겨 두면 `create or replace trigger` 한 줄로 위 가드를 무해한 함수로 바꾼 뒤 **동의 기록 없는 접수**를 넣을 수 있다. 앱은 트리거를 만들지 않으므로 접수·확정·취소·파기에 영향이 없다(로컬 실측 — 아래). 남는 우회(소유자·슈퍼유저 DDL)는 `known-defects.md` D11.

**왜**: 위저드 6단계에 청약철회 제한 고지(원장 `WITHDRAWAL.notice` — 사장님 답변 2026-09-21 A-2)와 필수 체크박스가 생겼다.
확인 사실의 입증은 사업자 몫이라 행마다 서버 시각을 남기고, 값 없는 **새** 접수는 DB 가 거부한다(앱은 zod 로 먼저 거부한다).

**설계 — 시각에 기대지 않는다**(자세히는 파일 헤더 · astra P1-3 반영). 첫 판은 `created_at < '<적용 시각>'` 을 예외로 둔 CHECK 였다. 버린 이유:
`created_at default now()` 는 **트랜잭션 시작 시각**이라 적용 전에 시작한 트랜잭션이 적용 뒤에 동의 없이 넣을 수 있었고, `created_at` 을 과거로 넣으면 통째로 우회됐다.
이 판은 행이 스스로 "도입 전 행" 인지 표시한다. legacy 칸을 **기본값 true 로 붙인 뒤 같은 트랜잭션에서 기본값을 false 로 바꾼다** — 기존 행은 빠른 기본값으로 true 가 되고(행을 다시 쓰지 않는다 · 행 UPDATE 트리거를 태우지 않는다), 칸을 붙이는 ALTER 가 ACCESS EXCLUSIVE 를 쥔 채라 그 사이 들어오는 행이 없다.
잠금을 기다리던 접수도 커밋 뒤에 들어오므로 false 를 받는다 — **시각이 아니라 순서로** 정해진다. `NOT NULL`(기존 행 때문에 불가 · 채우면 허위) · `NOT VALID`(기존 행을 고치는 순간 새 튜플에 검사되어 옛 예약 확정이 23514) 는 버렸다.
legacy 행의 다른 칸 갱신(관리자 확정·완료·취소·메모 — 0010 definer 함수)은 legacy 값이 그대로라 통과한다. 관리자 예약 상세는 legacy 행을 **"기록 없음(동의 기록 도입 전 접수)"** 으로 보여 준다(날짜를 박지 않는다).

### 🔴 환경별 순서 — **환경마다 DB 적용이 코드 배포보다 먼저다** (0020 과 같은 짝 문제 · astra P1-5)
이 마이그레이션과 앱 코드(`lib/reservations/consent.ts` · `lib/admin/reservations.ts`)는 **짝**이다. 새 코드는 **모든 접수**에 `withdrawal_consent_at` 을 싣는다.
- **새 코드 · 옛 스키마**(0021 전 DB): 접수 insert 가 없는 칸을 보내 **`PGRST204` 로 접수가 실패**하고, 관리자 예약 상세가 없는 칸을 읽어 `42703` 으로 열리지 않는다.
- **옛 코드 · 새 스키마**(0021 뒤 DB): 옛 코드는 칸을 보내지 않으므로 그 접수가 **`23514 reservations_withdrawal_consent_required` 로 실패**한다.
짝을 한순간에 바꿀 수 없으므로, **적용 창(그 환경의 DB 적용 ~ 그 환경의 새 코드 배포 완료) 동안 그 환경의 접수는 실패한다.** 그래서 환경 하나씩, 이 순서로만 간다:

1. **시험 DB**(`gjnieoojgmhulkohdcnl`)에 0021 — `db push --db-url`(`docs/ops/environments.md`). 자기검증 통과(`NOTICE: 0021: … 탐침 default_path=23514:… backdated=23514:…`)와 아래 확인 질의 기대값을 본다.
2. **프리뷰 재배포**(새 코드) — 프리뷰에서 견적 신청 1건이 접수되고 관리자 상세에 확인 시각이 보이는지 본다. 1 과 2 사이에 프리뷰의 옛 배포본으로 들어온 접수는 23514 로 실패한다(시험 데이터라 무해).
3. **운영 DB**(`expexkhcuogkavpacrem`)에 0021 — 맨 위 「적용 직전 필수」·「적용 경로」 그대로(`supabase db push` 하나).
4. **운영 배포**(새 코드). 3 과 4 사이가 운영의 적용 창이다.

**오늘(2026-09-22) 운영에는 접수가 가능한 배포본이 없다**(컨트롤러 전달 — P1-7 수정 라운드 2 브리프 [P1-5]). 그러면 3~4 의 창에서 실패할 운영 접수가 없다.
🔴 **이 전제는 적용 직전에 컨트롤러가 다시 확인한다**: Vercel 운영 배포본이 어느 커밋인지, 그 배포본이 공개 접수를 받는지(`GUARD_SECRET`·Turnstile 키 유무 · `/quote` 제출이 fail-closed 인지). 접수가 열려 있으면 창을 접수가 적은 시간대로 잡고, 창의 길이(적용 → 배포 완료)를 보고서에 적는다.
- **프리뷰 env 가 아직 운영 DB 를 가리키면**(시험 프로젝트 env 를 Preview 범위에 넣기 전 — `environments.md` 「아직 남은 설정」 1) 옛 커밋 프리뷰의 접수가 **3 의 순간부터** 실패하고, 1·2 는 운영 DB 를 건드린 셈이 된다 — 1 을 시작하기 전에 프리뷰가 시험 프로젝트를 가리키는지 확인한다.
- **개발 서버**: 저장소 워킹트리로 도는 dev 서버가 운영 DB 를 가리키면, **이 코드가 워킹트리에 들어온 순간부터 운영 적용 전까지** 관리자 예약 상세가 `42703` 으로 열리지 않는다. 그 서버의 공개 접수는 `GUARD_SECRET` 이 없어 닫혀 있다(fail-closed).
하나라도 불명이면 **멈추고 컨트롤러에게 보고한다.**

### 적용 경로
**`supabase db push` 만**(맨 위 「적용 경로」 — 시험 프로젝트 먼저, 운영 나중). **`psql -f` 를 쓰지 마라**. 로컬 단건 적용은 `psql -1` 또는 `supabase migration up --db-url postgresql://…@127.0.0.1:…`.
⚠️ 자기검증은 **실제 `reservations` 에 탐침 문장을 치지 않는다**(astra P2-8 · P5-15 규칙) — 롤 전환 0 · 잠금 문장 0 · 실제 표 쓰기 0. 실제 표에는 행 수를 **세기만** 한다(legacy 가 아닌 기존 행 0 · 소급 채움 0 — 본문의 칸 추가가 이미 쥔 잠금 안에서). 권한은 카탈로그(`has_column_privilege` · `has_function_privilege`)로 보고, 거동은 `pg_temp.p0021_probe`(LIKE 복제본 — CHECK 정의를 실제 표와 글자 그대로 대조하고, 트리거는 실제 트리거 정의에서 표 이름만 바꿔 붙인다)에 친 뒤 서브트랜잭션째 되돌린다. 임시 표·트리거 생성이 이벤트 트리거를 태운다(맨 위 ③). 적용 롤에 임시 표 권한이 필요하다(기본값).
  탐침이 치는 경로: 기본값 경로(created_at·legacy 를 지정하지 않은 insert) · created_at 을 과거로 넣은 insert · legacy=true 삽입 · 새 행의 동의 시각 지우기 · 새 행 legacy 올리기 · legacy 행의 상태·확정 시각·메모 갱신 · legacy 행 내리기. 기대 줄: `default_path=23514:reservations_withdrawal_consent_required backdated=23514:reservations_withdrawal_consent_required legacy_insert=23000 new_with=legacy_false wipe=23514:reservations_withdrawal_consent_required promote=23000 legacy_update=OK demote=23000` — 한 글자라도 다르면 파일째 멈춘다.
⚠️ 다시 돌리면 ① 에서 멈춘다(칸이 이미 있다) — 두 번 돌면 그 사이 들어온 접수까지 legacy 가 되어 동의 강제에서 빠지기 때문이다.

### 적용 전/후 확인 (읽기 질의뿐 — SQL Editor 에 **읽기 확인용으로만** 붙인다)
- **적용 전** 기대: `COLS_MISSING` · `CONS_MISSING` · `TRIGGER_MISSING` · `FN_MISSING`
- **적용 후** 기대:
  - `cols` = `withdrawal_consent_at:null=true,def=none withdrawal_consent_legacy:null=false,def=false`
  - `cons` = `reservations_withdrawal_consent_before_created:true reservations_withdrawal_consent_not_stale:true reservations_withdrawal_consent_required:true`
  - `required_def` = `CHECK (((withdrawal_consent_at IS NOT NULL) OR withdrawal_consent_legacy))` — 시각 리터럴이 없다
  - `trg` = `TRIGGER_OK`(붙어 있고 · 켜져 있고 · **WHEN 조건 없음** · 행 단위 BEFORE 에 삽입·갱신 둘 다 · 함수가 invoker)
  - `trg_priv` = `TRIGGER_PRIV_OWNER_ONLY`(두 개인정보 표의 TRIGGER 보유자는 소유자뿐 — R3 [P1-A])
  - `fn_exec` = `FN_EXEC_NONE`(anon·authenticated·service_role·PUBLIC 누구도 트리거 함수를 직접 실행하지 못한다)
- 🔴 **권한은 "불변" 이 아니라 "허용된 차이만"** (R4 [P2-E] astra: 옛 서술은 **정상 적용을 절차에서 막았다** — 0021 은 TRIGGER 두 건을 **의도적으로** 회수하므로 전수 해시는 반드시 달라진다):
  - **허용된 차이**는 정확히 두 항목이다 — `reservations` · `notifications_log` 각각의 `service_role` **TRIGGER** 제거. 그 차이는 첫 질의의 `trg_priv` 가 이름으로 보여 준다(적용 전 `TRIGGER_PRIV reservations/service_role …` → 적용 후 `TRIGGER_PRIV_OWNER_ONLY`).
  - **그 밖에는 불변**: 아래 둘째 질의는 그 두 항목을 **뺀** 집합의 `md5` 이므로 **적용 전과 후에 같아야 한다**(표·칸 ACL 전수 — 권한 종류를 나열하지 않고 `aclexplode` 로 전부 본다). 다르면 다른 것이 함께 바뀐 것이다 — 멈추고 보고한다.
  - 적용 전 DB 에 이미 그 TRIGGER 가 없다면(이미 굳혀 둔 DB) 차이는 0 이고 두 해시도 같다 — 그때 롤백은 **없던 권한을 만들지 않는다**(0021 이 실제로 회수한 목록만 되돌린다 — 「롤백」 절).

<!-- P17:0021_CHECK_SQL:BEGIN -->
```sql
select
  (select coalesce(string_agg(format('%s:null=%s,def=%s', a.attname, (not a.attnotnull)::text, coalesce(pg_get_expr(d.adbin, d.adrelid), 'none')), ' ' order by a.attname), 'COLS_MISSING')
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.reservations'::regclass and a.attname like 'withdrawal_consent%' and not a.attisdropped) as cols,
  (select coalesce(string_agg(format('%s:%s', conname, convalidated::text), ' ' order by conname), 'CONS_MISSING')
     from pg_constraint where conrelid = 'public.reservations'::regclass and conname like 'reservations_withdrawal_consent_%') as cons,
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.reservations'::regclass and conname = 'reservations_withdrawal_consent_required') as required_def,
  (select coalesce(max(case when t.tgenabled = 'O' and t.tgqual is null
                             and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16
                             and t.tgfoid = to_regprocedure('public.reservations_withdrawal_legacy_guard()') and not p.prosecdef
                            then 'TRIGGER_OK' else 'TRIGGER_BAD' end), 'TRIGGER_MISSING')
     from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.reservations'::regclass and not t.tgisinternal and t.tgname = 'reservations_withdrawal_legacy_guard') as trg,
  (select coalesce('TRIGGER_PRIV ' || string_agg(format('%s/%s', c.relname, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end), ' ' order by c.relname), 'TRIGGER_PRIV_OWNER_ONLY')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = 'public' and c.relname in ('reservations','notifications_log')
      and a.privilege_type = 'TRIGGER' and a.grantee is distinct from c.relowner) as trg_priv,
  (select case
            when f.oid is null then 'FN_MISSING'
            when has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('authenticated', f.oid, 'EXECUTE')
              or has_function_privilege('service_role', f.oid, 'EXECUTE')
              or exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = f.oid and x.grantee = 0)
            then 'FN_EXEC_LEAK'
            else 'FN_EXEC_NONE' end
     from (select to_regprocedure('public.reservations_withdrawal_legacy_guard()')::oid as oid) f) as fn_exec;

select md5(string_agg(x, E'\n' order by x)) as acl_md5_without_allowed_delta, count(*) as acl_rows from (
  select format('%s|%s|%s|%s|%s', c.relname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable) as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
     and not (c.relname in ('reservations','notifications_log') and a.grantee = 'service_role'::regrole and a.privilege_type = 'TRIGGER')
  union all
  select format('%s.%s|%s|%s|%s|%s', c.relname, at.attname, a.grantee::regrole, a.grantor::regrole, a.privilege_type, a.is_grantable)
    from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(at.attacl) a
   where n.nspname = 'public' and at.attacl is not null
) s;
```
<!-- P17:0021_CHECK_SQL:END -->

### 로컬 실측 (2026-09-22, P1-7 수정 라운드 2 · PostgreSQL 17.6)
- 옛 0021(적용 시각 설계)은 로컬에서 롤백 파일로 되돌리고 이력을 `reverted` 로 맞춘 뒤 새 0021 을 적용했다(원격에는 어느 판도 적용된 적 없다).
- 세 연결 방식 모두 자기검증 통과(드라이런 — `begin; … rollback;`): postgres 로그인 · supabase_admin 로그인 뒤 `set local role postgres` · supabase_admin 로그인 그대로. 탐침 줄은 위 기대 줄과 글자 그대로 같다.
- 양성 대조(적용 전에 접수 2건 — 신규·확정): 두 행 모두 legacy=true · 동의 시각 null · 적용 뒤 확정·취소·메모 갱신 통과.
- (R3, 2026-09-23) **TRIGGER 회수 뒤에도 앱 경로는 그대로**: 접수(REST insert) · 관리자 확정·완료·취소·메모(0010 definer 함수) · 파기(delete) 전부 통과(전량 테스트 · 사본 서버 제출 흐름). `service_role` 로 두 표에 `create trigger`·`create or replace trigger` 는 **42501**(`tests/write-privileges.test.ts §12` · `tests/withdrawal-consent.test.ts §4 (i)`), 같은 시도를 TRIGGER 를 준 일회용 표에 하면 성공(대조군).
- (R4, 2026-09-23) 깨뜨리기 3종 추가 — `session_replication_role` 에 SET 권한이 부여된 DB → `session_replication_role 에 SET 권한이 부여돼 있다 — authenticated(SET)`(소유자·슈퍼유저 항목은 멈춤 사유가 아니다) · 소유자도 슈퍼유저도 아닌 다른 롤이 TRIGGER 를 가진 DB → 직접 부여 검사가 이름을 댄다 · **직접 부여 검사를 지운 변형**으로 유효 권한(pg_roles 전수) 검사를 단독 확인 → `소유자도 슈퍼유저도 아닌 롤에 두 표의 유효 TRIGGER 권한이 남았다 — public.notifications_log/dashboard_user`.
- (R3) 깨뜨리기 5종 추가 — 회수 없음 → `개인정보 두 표의 TRIGGER 를 소유자 말고 다른 롤이 갖고 있다 — notifications_log/service_role reservations/service_role` · 한 표만 회수 → 남은 표 이름 · 가드에 `when (false)` → `WHEN 조건이 붙어 있다 (false)` · 의도 밖 권한 변경(delete 회수) → `의도한 것 말고 다른 권한이 바뀌었다 — -reservations|service_role|postgres|DELETE|f` · 회수 뒤 다시 grant → 소유자 외 보유자로 보고.
- 깨뜨리기 16종(R2) — **전부 이름을 대며 멈춤**: NOT VALID · legacy 예외 없는 CHECK(NOT VALID · 빈 표의 VALID) · 기본값을 false 로 되돌리지 않음 · **옛 설계 둘**(`created_at` 과거 우회 → `backdated=INSERTED` · 트랜잭션 시작 시각 경로 → `default_path=INSERTED`) · 트리거 없음 · 트리거가 갱신에만 · legacy=true 삽입을 막지 않는 함수 · true→false 를 허용하는 함수 · EXECUTE 회수 없음 · 회수에서 `service_role` 빠짐 · definer 함수 · 기존 행 소급 채우기 · 새 칸에 anon 칸 권한 · 다른 표 권한 변경.
- 다른 세션이 `reservations` 에 ROW EXCLUSIVE(쓰기 중인 접수와 같은 잠금)를 쥔 채 적용 → 6초 뒤 `canceling statement due to lock timeout` · 파일째 롤백(칸 없음 · 이력 0020).
- 원문: 보고서 `P1-7-report.md` 「수정 라운드 2」.

### 롤백 — **잠금 먼저, 그다음 센다** (astra P1-6)
`supabase/rollbacks/0021_withdrawal_consent.down.sql` — 파일이 `begin … commit` 을 스스로 쥔다. 순서:
1. `set local lock_timeout = '5s'`(이 파일의 모든 잠금 대기 상한)
2. **승인 플래그** `set bestour.rollback_0021_ack = '1';` — 조건 없이 먼저
3. `reservations` 에 **EXCLUSIVE 잠금** — 쓰기(접수·관리자 확정)를 막고 읽기는 허용한다. 여기부터 커밋까지 기록 수가 바뀌지 않는다
4. 확인 기록 수를 센다 → 한 건이라도 있으면 **내보냄 확인 플래그** `set bestour.rollback_0021_evidence_exported = '1';` 를 추가로 요구 — 칸을 지우면 확인 기록(분쟁 때 사업자 측 증거)이 되돌릴 수 없게 사라진다
5. 트리거 → 트리거 함수 → 제약 셋 → 칸 둘(주석 포함) 제거
6. **권한 복원** — 0021 이 회수한 두 표의 `service_role` TRIGGER 를 되돌린다(적용 전과 같은 세계로). ⚠️ 되돌리면 가드를 갈아끼울 수 있는 상태로 함께 돌아간다(`known-defects.md` D11)

첫 판은 잠금 없이 센 뒤 지웠다 — 세는 순간과 지우는 순간 사이에 들어온 접수의 기록은 "내보냈다" 는 확인 밖에서 사라질 수 있었다.
⚠️ **코드 롤백과 짝이다**: 앱을 0021 이전 코드로 먼저 되돌린 뒤 돌린다(칸만 지우면 모든 접수가 `PGRST204`).
로컬 실측(2026-09-22 R2):
- 플래그 없이 → 멈춤.
- ack 만 · 확인 기록 0건인데 **다른 세션이 기록 1건을 넣고 2초 뒤 커밋**하는 도중에 시작 → 롤백이 잠금에서 약 2초 기다린 뒤 **1건을 세고 멈춤**(칸 유지). 잠금 없이 셌다면 0건으로 보고 진행했을 자리다.
- 다른 세션이 쓰기 잠금(ROW EXCLUSIVE)을 쥔 채 → 잠금 문장에서 약 5.9초 뒤 `canceling statement due to lock timeout`(칸 유지).
- 두 플래그 → 제거 · 스냅샷(표·칸 ACL + 칸 + 제약 + 트리거 + public 함수 ACL)이 **적용 전과 md5 동일**(R3·R4 실측 `86612466… rows=297` — 회수한 `service_role` TRIGGER 두 항목이 6번 단계에서 되돌아온 것을 포함한다) · 두 번째 실행 오류 0(되돌릴 것이 없으면 `되돌릴 것이 없다(칸·함수 모두 없음) — 권한도 건드리지 않는다`).
- (R4 실측) **이미 굳혀 둔 DB**(그 TRIGGER 가 처음부터 없는 DB)에 적용 → 회수 기록이 빈 목록(`TRIGGER 회수 [이미 없음]`) → 롤백이 **아무 권한도 만들지 않는다**(`되돌릴 TRIGGER 없음`). 보통 DB 에서는 `[notifications_log,reservations]` 을 기록하고 그대로 되돌린다.
- (R4 실측) 기록이 없는 상태(옛 판이 적용된 DB 등)에서 칸이 남아 있으면 롤백은 **멈추고** `set bestour.rollback_0021_restore_trigger = 'reservations,notifications_log'`(있었다) 또는 `'none'`(없었다)을 요구한다 — 스냅샷 사실을 사람이 넘겨야 권한을 만든다.
- `migration repair --status reverted 0021` → `migration up` 재적용 → 스냅샷이 첫 적용과 **md5 동일**(R3 실측 `c18d8fb8… rows=302` = 적용 전 297 + 칸 2 + 제약 3 + 트리거 1 + 함수 1 − TRIGGER ACL 2) · 다시 돌리면 ① 에서 멈춤.
- 재적용하면 **그 순간의 모든 행이 legacy** 가 된다 — 롤백과 재적용 사이의 접수는 "기록 없음(도입 전)" 으로 남는다(되살릴 수 없다).

---

## 0022 — 관리자 통계 함수 `admin_stats` (**원격 미적용** · P5-17)

**무엇을 하나**: `public.admin_stats(p_from date, p_to date) returns jsonb` **함수 하나**를 만들고 그 EXECUTE 를 `authenticated` 에만 준다.
표·칸·제약·트리거·정책·데이터 변경은 **0 건**이다. 지금까지의 마이그레이션 중 가장 좁다.

- `language plpgsql · stable · security definer · set search_path = public, pg_temp`
- **첫 문장이 가드**: `if not is_admin() then raise exception 'admin_stats: 관리자 명단에 없는 호출자다' using errcode = '42501'`
  — `lib/admin/adminRpc.ts` 의 `ADMIN_GUARD_MESSAGE` 와 한 글자도 같아야 한다(앱이 이 문구로 가드 거부와 EXECUTE 거부를 가른다).
- 입력 검증 `22023` 세 가지: 양끝 중 null · `p_from > p_to` · 366일 초과.
- `revoke all on function admin_stats(date, date) from public, anon, service_role;` + `grant execute … to authenticated;`
  (`pg_default_acl` 이 새 함수에 네 롤을 연다 — CLAUDE.md §3. **`drop function` 을 쓰지 않는다**: `create or replace` 만.)
- 돌려주는 것은 **(버킷 또는 코드, 건수)뿐**이다. 이름·전화·메일·메모·접수번호·수신처는 집계에도 쓰지 않는다.
  분해표(여행 구분·차량·구간·리드타임)에서 **1~2건인 칸은 함수 안에서** 건수를 지우고(`count: null`) 하나의 "기타" 로 합친다(k=3).
- **보완 숨김**: 가려질 칸이 **하나뿐이면** 보이는 칸 중 가장 작은 것도 함께 가린다 — 한 칸만 가리면
  `총건수 − 보이는 칸들의 합` 이 그 칸의 건수라, 흔한 배치에서 그 한 줄짜리 복원을 막는다.
- **추이의 상태 칸**(수정 라운드 3): 상태 칸(대기·확정·취소) 중 **어느 하나라도 1~2건이면** 그 버킷을 쪼개지 않는다(`split: false`).
  총건수만 보던 옛 판은 하루 3건이 1·1·1 일 때 세 칸을 그대로 내보냈다(astra 반례). 0건 버킷은 쪼갠 채로 둔다.
- 🔴 **이 장치는 익명화가 아니다.** "기타" 가 가려진 채 보이면 1건짜리 칸이 **정확히 둘**이라는 뜻이고, 동률 처리 규칙까지 알면
  어느 칸인지도 좁혀진다(리드타임 `(2,3,3,3)` → 가려진 둘이 `d0_7=2 · d91_plus=3` 으로 유일하게 풀린다 — astra 전수 열거).
  `confirmation.pending` 같은 다른 숫자와 맞물리면 1건짜리 날의 상태도 드러난다. 목적은 **캡처가 밖으로 나갔을 때의 예의 수준**이지
  보장이 아니다 — 관리자는 예약 목록에서 원본을 본다. 남는 경로와 뒤집을 조건은 `known-defects.md` **D13**.
- **축별 합이 총건수와 다를 수 있는 이유**는 병합 자체가 아니다(수정 라운드 3 정정): ① 건수를 가린 칸은 합에 더할 수 없고
  ② 구간(⑨)은 상위 10개까지만 보여 준다. "기타" 에 숫자가 있으면 보이는 칸들 + 기타 = 총건수로 **정확히** 맞는다.
- 입력 검증은 **유한성 → 지원 범위(1900-01-01 ~ 2200-01-01) → 앞뒤 → 길이** 순서다. `infinity` 가 산술보다 먼저 걸린다.
- KST: 경계는 `(p_from::timestamp at time zone 'Asia/Seoul')` ~ `((p_to + 1)::timestamp at time zone 'Asia/Seoul')`,
  버킷은 `… at time zone 'Asia/Seoul'` 뒤에 `date_trunc`. **`current_date`·`now()::date` 를 쓰지 않는다**(세션 TZ 가 UTC — 0004 가 고친 버그).
- 인덱스·뷰·캐시를 만들지 않는다(수백~수천 행 규모).

**왜**: 사용자(2026-09-21) 요청 — 사장님이 홈페이지가 문의를 얼마나 가져오는지 볼 화면. 지표 10개는 조사 보고서
`.superpowers/sdd/2026-09-06-bestour-implementation-v4/ADMIN-STATS-RESEARCH.md` 「권장 v1」 그대로다.

### 🔴 배포 순서 — **적용 → 배포**
`/admin/stats` 화면과 `lib/admin/stats.ts` 가 이 함수를 부른다. 적용 전에 코드를 배포하면 그 탭이 `PGRST202`(함수 없음)로 열리지 않는다.
**반대 방향의 사고는 없다** — 이 파일은 기존 코드가 쓰는 것을 아무것도 바꾸지 않으므로, 적용만 먼저 해도 옛 코드에 영향이 없다.
그래서 0020·0021 과 달리 "적용 창" 개념이 없다(접수·확정·통지·파기 경로가 이 함수를 부르지 않는다).

### 적용 경로
**`supabase db push` 만**(맨 위 「적용 경로」 — 시험 프로젝트 먼저, 운영 나중). 로컬 단건은 `psql -1` 또는
`supabase migration up --db-url postgresql://…@127.0.0.1:54322/postgres`.
자기검증은 **실제 표에 문장을 치지 않는다**: 롤 전환 0 · 잠금 문장 0 · 쓰기 0. 거동 탐침은 **가드 하나뿐이고 읽기다** —
적용 롤이 관리자 명단에 없으면 `NOTICE: 0022: 가드 탐침 통과 — 42501:admin_stats: 관리자 명단에 없는 호출자다` 가 찍힌다
(명단에 있으면 탐침을 건너뛴다는 NOTICE 가 대신 찍힌다). 마지막 줄은 언제나
`NOTICE: 0022: 자기검증 통과 — admin_stats(date,date) definer·stable·pg_temp, EXECUTE 는 authenticated 뿐.` 이다.

### 적용 전/후 확인 (읽기 질의뿐)
- **적용 전** 기대: `fn` = `FN_MISSING`
- **적용 후** 기대: `fn` = `FN_OK`(definer · stable · `search_path=public, pg_temp`) · `priv` = `PRIV_AUTH_ONLY`

<!-- P517:0022_CHECK_SQL:BEGIN -->
```sql
select
  (select case
            when f.oid is null then 'FN_MISSING'
            when p.prosecdef and p.provolatile = 's' and coalesce(array_to_string(p.proconfig, ' '), '') = 'search_path=public, pg_temp'
              then 'FN_OK'
            else format('FN_BAD secdef=%s vol=%s cfg=%s', p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ' '), '(none)'))
          end
     from (select to_regprocedure('public.admin_stats(date,date)')::oid as oid) f
     left join pg_proc p on p.oid = f.oid) as fn,
  (select case
            when to_regprocedure('public.admin_stats(date,date)') is null then 'FN_MISSING'
            when has_function_privilege('anon', 'public.admin_stats(date,date)', 'execute')
              or has_function_privilege('service_role', 'public.admin_stats(date,date)', 'execute')
              or exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                          where p.oid = 'public.admin_stats(date,date)'::regprocedure and x.grantee = 0 and x.privilege_type = 'EXECUTE')
            then 'PRIV_LEAK'
            when not has_function_privilege('authenticated', 'public.admin_stats(date,date)', 'execute') then 'PRIV_NO_ADMIN'
            else 'PRIV_AUTH_ONLY'
          end) as priv;
```
<!-- P517:0022_CHECK_SQL:END -->

- 표·칸 권한은 **불변**이다(이 파일은 표를 건드리지 않는다). 0021 절 둘째 질의의 `acl_md5` 가 적용 전후로 같아야 한다.

### 로컬 실측 (2026-09-23, P5-17 구현 + 수정 라운드 2 · PostgreSQL 17.6)
- 드라이런(`begin; … rollback;`) · 정식 적용(`migration up --db-url …@127.0.0.1:54322`) 모두 자기검증 통과.
- 깨뜨리기 **17종** 전부 이름을 대며 멈춘다(수정 라운드 2 에서 4종 추가: 가드가 첫 문장이 아님 · 결과 키 추가 ·
  본문이 `name` 칸 참조 · 최상위 키 들여쓰기 변경). 전수와 UI 실측은 보고서 `P5-17-report.md` ⑥·⑦·⑩.
- vitest `tests/admin-stats.test.ts` — anon·service_role EXECUTE 거부 · 명단 밖 로그인 가드 거부 · KST 경계 ·
  k=3 숨김 + **보완 숨김**(astra 배치 3·3·3·1) · 추이 상태 숨김 · 결과 키 집합 고정 · `infinity` 거부.

### 롤백
`supabase/rollbacks/0022_admin_stats.down.sql` — 함수 하나를 지운다(`drop function if exists public.admin_stats(date, date)`).
**승인 플래그가 없다.** 0015~0020 의 기준은 "실행한 뒤의 세계가 조용히 위험한가" 인데, 이 롤백은
① 열리는 권한이 없고(함수가 사라지면 그 ACL 도 사라진다 · 표 권한은 처음부터 안 건드렸다) ② 조용하지 않으며(통계 탭이 곧바로 PGRST202)
③ 데이터가 사라지지 않는다. 근거는 그 파일 헤더에 적혀 있다. ⚠️ **앱을 0022 이전 코드로 먼저 되돌린 뒤** 돌린다.
되돌린 뒤 `supabase migration repair --status reverted 0022`.

---

# 원격 적용 기록 — 0012~0019 (2026-09-21 00:17 KST · 컨트롤러)

사장님 지시로 적용했다. 경로는 「적용 경로」대로 **`npx --no-install supabase db push --linked --yes` 하나**(SQL Editor·`psql -f` 안 씀).

## 적용 직전 필수 — 결과
| # | 확인 | 기대 | 원격 실측 |
|---|---|---|---|
| ① | 적용 이력 | 마지막 `0011` | `0001`~`0011` ✅ (0012~0019 없음) |
| ② | 서버 버전 | — | **PostgreSQL 17.6 (`170006`)** → 0019 의 회수 분기가 실제로 돈다 ✅ |
| ③ | 이벤트 트리거 | 기준 6개 · CREATE TABLE/SEQUENCE/TRIGGER 태그 없음 | 이름·태그·소유자(`supabase_admin`)·`evtenabled=O` 전부 일치 ✅ / **본문 md5 6개 모두 로컬과 다름** → 조건 ⓒ 대로 본문을 읽었다: 이번에 발동할 수 있는 `pgrst_ddl_watch`·`pgrst_drop_watch` 는 원격도 **`NOTIFY pgrst, 'reload schema'` 뿐**이고 `schema_name is distinct from 'pg_temp'` 분기도 같다. 나머지 넷은 `CREATE/DROP EXTENSION` 전용이라 이번 적용과 무관하다. 차이는 Supabase 버전 차이로 판단하고 진행 ✅ |
| ④ | 적용 직전 스냅샷 | — | `public` 의 표 10 · 시퀀스 7 `relacl` 전수를 스크래치패드에 저장(저장소 밖) |
| — | 적용 창 | 접수 적은 시간 · 다른 DDL 없음 | 00:16 KST · `pg_stat_activity` 활성 질의 0 · `wait_event_type='Lock'` 0 ✅ |

## 적용 결과
여덟 파일 전부 성공(`Finished supabase db push.`) · 시간 초과(55P03) 없음 · 부분 적용 없음.
**적용 직후 이력**: `0012`~`0019` 여덟 줄이 붙고 마지막이 `0019` ✅

## 적용 전 → 후 (원격 `relacl` 실측)
| 대상 | 적용 전 | 적용 후 |
|---|---|---|
| `reservations` | `anon=arwdDxtm` · `authenticated=arwdDxtm` | **anon 없음** · `authenticated=r` |
| `notifications_log` | 같음 | **anon 없음** · `authenticated=r` |
| 콘텐츠 6표(`notices`·`popups`·`gallery`·`gallery_albums`·`showcase_routes`·`vehicles`) | `anon=arwdDxtm` · `authenticated=arwdDxtm` | `anon=r` · `authenticated=arwd` (D·x·t·m 없음) |
| `places` | 같음 | `anon=r` · `authenticated=r` |
| 시퀀스 7개 | `anon=rwU` · `authenticated=rwU` | **anon 없음** · `authenticated=U`(`notifications_log_id_seq` 는 authenticated 도 없음) |
| `admin_users` | `postgres`·`service_role` 만 | 변화 없음 |
| `service_role`·`postgres` | 전권 | 변화 없음 ✅ |

적용 전 `anon=arwdDxtm` 는 **`D`(TRUNCATE)·`t`(TRIGGER)·`m`(MAINTAIN)** 를 포함한다 — 즉 원격에서도 익명 롤이 개인정보 표를 비우고, 트리거를 걸고, 접수 표를 잠글 수 있는 상태였다. 이번 적용이 그것을 닫았다.

## 함수 (0014·0016·0017)
- `claim_pending_notifications(p_limit integer, p_channels text[])` **2-인자 1개만** 존재 — 옛 1-인자는 없다 ✅ (모호 호출로 발송기가 멈추는 경우 없음)
- `mark_notification_sent`·`mark_notification_failed`·`reap_stale_notifications` 모두 `prosecdef=true` ✅
- EXECUTE 보유자·`pg_temp` search_path 는 **0016·0017 의 자기검증이 적용 시점에 확인**했다(어긋나면 그 파일이 멈춘다 — 여덟 파일 모두 통과했다). 별도 원격 행렬 질의는 이 세션의 자동 승인 정책에 막혀 돌리지 못했다.

## 배포 순서 — 이번에는 문제가 없다
「0014 원격 적용 → 코드 배포 → 크론 `?dry=0`」 순서가 오픈 게이트였다. 확인 결과 **`main` 에는 `vercel.json` 도 `app/api/cron/*` 도 없다** — 알림 크론과 2-인자 호출은 `feature/implementation` 에만 있다. 따라서 옛 1-인자 호출을 하는 배포본이 존재하지 않고, 0014 를 먼저 적용해도 PGRST202 가 날 곳이 없다. **남은 조건은 그대로다**: 코드 배포 전에 Resend 키와 `OWNER_EMAIL` 실수신 1통을 끝낼 것.

## 남은 것
- 롤백은 `supabase/rollbacks/` 에 있고 **승인 플래그**를 요구한다. 되돌리려면 적용 직전 스냅샷과 대조할 것(위 ④).
- **D10**(`authenticated` 는 쓰기 권한만으로 콘텐츠 표를 잠글 수 있다)은 이번 적용으로 닫히지 않는다 — 공개 가입이 막혀 있다는 전제(D2)에 기댄다.

---

# 원격 적용 기록 — 0020 (2026-09-21 16:02 KST · 컨트롤러)

사장님 승인으로 적용했다. 경로는 `npx --no-install supabase db push --linked --yes`.

## 적용 직전 확인
| 확인 | 결과 |
|---|---|
| 적용 이력 | 마지막 `0019` ✅ |
| 서버 버전 | PostgreSQL 17.6 (오늘 00:17 확인과 같음) |
| 이벤트 트리거 | 6개 · 본문 md5 가 00:17 에 읽고 판단한 것과 **같다** ✅ |
| 스냅샷 | `public` 표 10 `relacl` + 정책 15 를 스크래치패드에 저장(저장소 밖). 적용 전 `*_admin_all` 6개 존재 확인 |
| 활동 | 활성 질의 0 · 잠금 대기 0 ✅ |
| 적용 창 | 16:01 KST 로 **접수 적은 시간대가 아니다.** 그러나 이 DB 를 쓰는 사이트가 **아직 공개되지 않았다**(도메인은 옛 카페24 사이트) — 접수 트래픽이 없다 |

## 🔴 옛 쓰기 코드가 어디에도 돌고 있지 않은가 — 확인 결과 (0020 절 「배포 순서」의 필수 항목)
Vercel 은 GitHub 앱으로 연결돼 있다. GitHub 배포 기록(`GET /repos/…/deployments`, 공개 API)으로 **살아 있는 배포본의 커밋**을 확인했다:
| 배포본 | 커밋 | 관리자 쓰기 코드 |
|---|---|---|
| **Production** (유일, 2026-08-31) | `d61ee48` | `lib/admin/*` 없음 · `app/admin/*` 없음 |
| Preview (마지막, 2026-09-13) | `ef20718` | `lib/admin/*` 없음 · `app/admin/` 는 `layout.tsx`·`page.tsx` 뼈대뿐 · 콘텐츠 표 쓰기 0건 |
| Preview (그 이전 8건) | `1052457`~`27cd195` | 같음 |

즉 **어느 배포본도 콘텐츠 표에 직접 쓰지 않는다** — 프리뷰가 운영 DB 를 가리키든 아니든 0020 이 깨뜨릴 것이 없었다. 프리뷰의 쓰기는 예약·아웃박스·파기뿐이고 전부 서비스 롤이라 0020(authenticated 권한만 바꾼다)과 무관하다.
⚠️ **2026-09-13 이후 Vercel 빌드가 계속 실패하고 있다**(`683d33c` 의 커밋 상태 `Vercel: failure — Deployment failed`). 그래서 그 뒤 커밋의 프리뷰는 없다. 원인은 Vercel 대시보드 로그로만 볼 수 있다(저장소 CI 의 프로덕션 빌드 잡 `legal-pages-http` 는 매 푸시 통과한다 — 코드가 아니라 Vercel 쪽 env 누락일 가능성이 높다). **배포 전 반드시 확인.**

## 적용 결과
성공(`Finished supabase db push.`). 이력 마지막 `0020` ✅. 자기검증(⑦ `authenticated` 로 여섯 표 `LOCK … NOWAIT` → 42501 포함)이 적용 시점에 통과했다 — 실패했다면 push 가 멈췄다.
| 대상 | 적용 전 | 적용 후 |
|---|---|---|
| 콘텐츠 6표 `authenticated` | `arwd` | **`r`** |
| 콘텐츠 6표 `anon` | `r` | `r` (불변) |
| `service_role`·`postgres` | 전권 | 불변 ✅ |
| 정책 | `*_admin_all` 6 (`for all`) | **`*_admin_select` 6 (`SELECT`)** |
| `admin_%` 함수 | 4 (0010) | **22** (0010 의 4 + 0020 의 18) |

## 프리뷰 DB 분리 — 권고 (P0-2, 미이행)
플랜 P0-2 는 **프리뷰를 별도 Supabase 프로젝트로** 두라고 했지만 `docs/ops/environments.md` 가 없고 저장소에 Vercel 연결 흔적(`.vercel/`)도 없다 — 이행 기록이 없다. 프리뷰 env 가 운영 키를 쓰는지는 Vercel 대시보드에서만 보인다.
**권고: 프리뷰 전용 Supabase 프로젝트를 만들고 Vercel 의 Preview 환경변수를 그쪽으로 분리한다.** 이유 — 프리뷰에서 견적을 넣으면 운영 DB 에 **실제 고객 개인정보 표로** 들어가고, 파기·통지 규칙이 그 행에 그대로 적용된다. 이번 0020 처럼 "어느 배포본이 운영 DB 에 붙어 있나" 를 매번 추적해야 하는 부담도 사라진다. Vercel 계정 접근이 필요하다(사장님 명의 — P0-1).

---

# 원격 적용 기록 — 0021 (2026-09-23 · 컨트롤러)

사용자 승인으로 **시험 먼저, 운영 나중** 순서로 적용했다(`docs/ops/environments.md` 의 새 규칙 첫 적용).

## 시험 프로젝트 `gjnieoojgmhulkohdcnl` (12:5x KST)
`db push --db-url`(로컬 link 는 운영 그대로). 적용 전 `0020` → 적용 후 **`0021`**. 실측: 새 칸 2 · 가드 트리거 1 · `service_role` 의 `reservations` TRIGGER **false**. 자기검증 통과(실패했으면 파일째 멈췄다).

## 운영 `expexkhcuogkavpacrem` (13:0x KST)
### 적용 직전 확인
| 확인 | 결과 |
|---|---|
| 이력 | 마지막 `0020` ✅ |
| 활동 | 활성 질의 0 · 잠금 대기 0 ✅ |
| **예약 표 행 수** | **0행** — 실제 고객 데이터가 아직 없다. 백필·마이그레이션 위험 없음 |
| 옛 접수 코드가 붙어 있나 | 운영 배포본 `d61ee48`(2026-08-31)에 접수 파일 **0개** ✅ / ⚠️ 프리뷰 `ef20718`(2026-09-13)에는 **3개 있다** — 그 프리뷰가 아직 운영 DB 를 보고 있다면 적용 뒤 그 화면의 접수가 23514 로 실패한다. 사용자에게 알리고 승인받았다(프리뷰를 시험 DB 로 옮기는 것이 원래 계획) |

### 결과
성공. 이력 마지막 **`0021`**. 실측: 새 칸 2 · 가드 트리거 1 · `service_role` TRIGGER 가 `reservations`·`notifications_log` 둘 다 **false** · `pg_parameter_acl` 의 `session_replication_role` 부여 **0건**.

### 🔴 다음 — 코드 배포
0021 이 적용됐으므로 **이제 옛 코드는 접수를 못 한다**(동의 칸이 없어 23514). 운영에는 접수 가능한 배포본이 없어 지금은 영향이 없지만, **다음 배포는 반드시 이 커밋 이후의 코드**여야 한다. 프리뷰도 마찬가지 — Vercel Preview 환경변수를 시험 프로젝트로 옮기고 다시 배포하면 해소된다(`environments.md` 「아직 남은 설정」).
