# 환경 구성 — 운영 · 시험(프리뷰) · 로컬 (플랜 P0-2)

2026-09-21 작성. 이 문서가 생기기 전까지 **프리뷰 배포가 어느 DB 를 쓰는지 기록이 없었다** — 0020 적용 때 GitHub 배포 기록으로 역추적해야 했다(`migration-runbook.md` 「원격 적용 기록 — 0020」).

## 세 환경

| 환경 | Supabase 프로젝트 | ref | 리전 | 누가 쓰나 |
|---|---|---|---|---|
| **운영** | `bestour_hompage` | `expexkhcuogkavpacrem` | 서울 `ap-northeast-2` | Vercel **Production** · 실제 손님 개인정보 |
| **시험(프리뷰)** | `bestour_homepage_preview` | `gjnieoojgmhulkohdcnl` | 서울 `ap-northeast-2` | Vercel **Preview** · 시험 데이터만 |
| **로컬** | `supabase start` 스택 | — | `127.0.0.1:54321` | 개발·테스트·CI `db-test` |

두 원격 프로젝트는 같은 조직(`bestour_homepage`)에 있다. 저장소의 `supabase link` 는 **운영**을 가리킨다(`supabase/.temp/project-ref`) — **시험 프로젝트로 다시 link 하지 마라.** 시험 프로젝트에는 `--db-url` 로 붙는다(아래).

## 왜 나눴나
프리뷰에서 견적 신청을 시험하면 그 행이 **운영 DB 의 실제 고객 표**에 들어가고, 보관·파기·통지 규칙이 그 행에 그대로 적용된다. 시험 데이터와 실제 예약이 섞이고, "어느 배포본이 운영 DB 에 붙어 있나" 를 매번 추적해야 한다. 나누면 둘 다 사라진다.

## 시험 프로젝트의 상태 (2026-09-21 생성 직후 실측)
- 마이그레이션 **0001~0020** 적용(`db push --db-url`, 빈 DB 에서 처음부터 — 모든 자기검증 통과).
- 기본 데이터는 마이그레이션이 넣는다: 대표 노선 16 · 차량 5 · 장소 17 — **운영과 같은 수**.
- Storage 버킷 `gallery`(public) · `gallery-originals`(private) — 운영과 같은 설정(20MB, jpeg·png·webp·heic·heif). 버킷은 SQL 이 아니라 **Storage API** 로 만들었다(0011 헤더 — SQL insert 는 대시보드 메타를 건너뛴다).
- 예약·통지 0건.

## ⚠️ 아직 남은 설정 (사람이 해야 한다)
1. **Vercel Preview 환경변수** — Vercel 대시보드 → Settings → Environment Variables 에서 **Preview 범위만** 체크하고 아래 셋을 시험 프로젝트 값으로 넣는다. 값은 `docs/private/preview-supabase.env`(저장소에 올라가지 않는다):
   - `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY`
   - **Production 범위의 값은 건드리지 않는다**(운영 그대로).
   - 넣은 뒤 프리뷰를 다시 배포해야 반영된다(`NEXT_PUBLIC_*` 는 빌드 시점에 박힌다).
2. **시험 프로젝트의 공개 회원가입 끄기** — Supabase 대시보드 → 시험 프로젝트 → Authentication → Sign In / Providers → "Allow new users to sign up" 끄기. 운영은 2026-09-13 에 껐다(`known-defects.md` D2). 시험 프로젝트의 anon 키도 프리뷰 번들에 실려 공개되므로 같은 조치가 필요하다. 새 프로젝트의 기본값은 **켜짐**이다.
3. 시험 프로젝트에 관리자 계정이 필요하면 `admin_users` 에 행을 넣는다(운영과 같은 절차 — `docs/ops/admin-manual.md`).

## 🔴 앞으로의 마이그레이션 — **시험 먼저, 운영 나중**
두 프로젝트의 스키마가 어긋나면 프리뷰에서 통과한 코드가 운영에서 깨진다. 그래서:
1. CI green 뒤 **시험 프로젝트에 먼저** 적용한다:
   ```
   # 비밀번호는 docs/private/preview-supabase.env 의 PREVIEW_DB_PASSWORD
   npx --no-install supabase db push --db-url "postgresql://postgres.gjnieoojgmhulkohdcnl:<비밀번호>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"
   ```
   (`aws-1-…` 호스트는 이 프로젝트에서 `tenant/user not found` 로 실패했다 — `aws-0` 이 맞다.)
2. 시험 프로젝트에서 자기검증이 통과하고 프리뷰 배포가 정상이면 **운영에** `migration-runbook.md` 의 「적용 직전 필수」 절차대로 적용한다.
시험 적용이 **운영 적용의 리허설**이 된다 — 빈 DB 에서 처음부터 도는 경로를 매번 확인하는 효과도 있다.

## 비용
Supabase 조직의 요금제에 따라 프로젝트 하나를 더하면 월 컴퓨팅 비용이 붙을 수 있다. **생성 전에 요금제를 확인하지 못했다** — 조직 결제 화면에서 확인할 것. 필요 없어지면 시험 프로젝트는 일시정지(pause)할 수 있다.
