import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isLocalStack } from "./load-env-local";

/**
 * 로컬 스택의 Postgres 에 SQL 을 실행하고 CLI 의 stdout 을 문자열로 돌려준다.
 *
 * 채널: `supabase db query --local -f <file>` (CLI 2.117.0 의 `db query` 서브커맨드). PostgREST 로는
 * pg_catalog(pg_policy·pg_attrdef)를 못 읽어 정책 정의문 검증에 이 채널이 필요하다. 저장소에 pg 드라이버가
 * 없고(새 패키지 금지) psql 도 개발 PC 에 없어 CLI 를 쓴다 — CI(db-test) 는 setup-cli 로 supabase 가 PATH 에 있다.
 *
 * 안전장치: isLocalStack() 이 아니면 throw. `--local` 은 어차피 로컬 컨테이너만 보지만 이중으로 막는다.
 * SQL 은 임시 파일로 넘긴다 — Windows 에서 .cmd 를 shell 로 띄울 때 따옴표·공백 인용 문제를 피한다.
 * 출력(텍스트 표)을 파싱하지 않는다 — 호출자는 부분 문자열만 단언한다(형식이 바뀌어도 깨지지 않게).
 */
export function runLocalSql(sql: string): string {
  if (!isLocalStack()) {
    throw new Error("runLocalSql: NEXT_PUBLIC_SUPABASE_URL 이 로컬 스택이 아니다 — 원격에는 실행하지 않는다");
  }

  const dir = mkdtempSync(path.join(tmpdir(), "p13-sql-"));
  const file = path.join(dir, "query.sql");
  writeFileSync(file, sql, "utf8");

  const win = process.platform === "win32";
  // [실행 파일, 앞에 붙는 인자, shell 필요 여부]. Node 18.20+/20.12+ 는 .cmd 를 shell 없이 spawn 하면 EINVAL 이다.
  const candidates: [string, string[], boolean][] = win
    ? [
        ["supabase.exe", [], false],
        ["npx.cmd", ["--no-install", "supabase"], true],
      ]
    : [
        ["supabase", [], false],
        ["npx", ["--no-install", "supabase"], false],
      ];
  const args = ["db", "query", "--local", "--yes", "-f"];
  const notFound: string[] = [];

  try {
    for (const [bin, prefix, shell] of candidates) {
      try {
        return execFileSync(bin, [...prefix, ...args, shell ? `"${file}"` : file], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120_000,
          windowsHide: true,
          shell,
        });
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; status?: number | null };
        if (err.code === "ENOENT") {
          notFound.push(bin);
          continue;
        }
        throw new Error(
          `runLocalSql: ${bin} ${[...prefix, ...args].join(" ")} 실패 (exit ${err.status ?? "?"}) — 도구 문제일 수 있다. ` +
            `stderr: ${(err.stderr ?? "").toString().slice(0, 500)} stdout: ${(err.stdout ?? "").toString().slice(0, 500)}`,
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  throw new Error(`runLocalSql: supabase CLI 를 찾지 못했다 (시도: ${notFound.join(", ")})`);
}
