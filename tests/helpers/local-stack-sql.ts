import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 * 출력 형식은 **CLI 버전마다 다르다**(JSON · ASCII 표). 호출자는 부분 문자열만 단언하거나,
 * 값·오류 메시지가 필요하면 아래 `sqlCells()` · `sqlErrorText()` 로 형식을 지우고 단언한다 (P5-15 R9).
 */
export function runLocalSql(sql: string): string {
  const res = execLocalSql(sql);
  if (res.ok) return res.stdout;
  throw new Error(
    `runLocalSql: ${res.command} 실패 (exit ${res.status ?? "?"}) — 도구 문제일 수 있다. ` +
      `stderr: ${res.stderr.slice(0, 500)} stdout: ${res.stdout.slice(0, 500)}`,
  );
}

/**
 * **실패가 기대되는** SQL 을 실행하고 CLI 출력(stdout + stderr)을 **잘라내지 않고** 돌려준다 (P6-11).
 *
 * 용도: `do $$ … raise exception '<결과>' $$` 처럼 **마지막에 일부러 터뜨려 트랜잭션 전체를 되돌리는** 탐침.
 * `db query` 는 한 호출에 한 문장만 받고(여러 문장은 "cannot insert multiple commands into a prepared statement")
 * 호출마다 세션이 새로 뜨므로, 임시 객체를 만든 채 결과를 읽고 **흔적 없이** 되돌리는 길은 이것뿐이다.
 * `runLocalSql` 은 실패 출력을 500자로 자르므로 결과를 실어 나를 수 없다.
 *
 * 성공(exit 0)하면 throw 한다 — 탐침이 터지지 않았다는 것은 되돌림이 일어나지 않았다는 뜻이다.
 */
export function runLocalSqlExpectingError(sql: string): string {
  const res = execLocalSql(sql);
  if (res.ok) {
    throw new Error(
      "runLocalSqlExpectingError: SQL 이 성공했다 — 마지막 raise 로 되돌려야 할 탐침이 커밋됐을 수 있다. " +
        `stdout: ${res.stdout.slice(0, 500)}`,
    );
  }
  return `${res.stdout}\n${res.stderr}`;
}

/**
 * **로컬 스택의 슈퍼유저(`supabase_admin`)로** 실패가 기대되는 SQL 을 실행한다 (P5-15 astra 수정 라운드).
 *
 * 왜 필요한가: 게이트의 이빨 중 둘은 `postgres` 로는 만들 수 없다 —
 *   · `alter role authenticated bypassrls` → `"authenticated" is a reserved role, only superusers can modify it`
 *   · `create function graphql_public.…` → `permission denied for schema graphql_public` (스키마 소유자가 supabase_admin)
 * 그래서 같은 CLI 채널에 `--db-url` 로 슈퍼유저 연결을 준다. **호스트는 127.0.0.1 로 고정**하고 포트는
 * supabase/config.toml 의 `[db] port` 에서 읽는다(로컬 스택의 기본 비밀번호 `postgres` — CI 의 `supabase start` 도 같다).
 * 원격 URL 을 받지 않는다 — 인자로 URL 을 넘길 수 없게 만들었다. `isLocalStack()` 도 이중으로 본다.
 * 용도는 **되돌려지는 탐침**뿐이다: 성공(exit 0)하면 throw 한다(커밋됐을 수 있으므로).
 */
export function runLocalSuperuserSqlExpectingError(sql: string): string {
  const res = execLocalSql(sql, localSuperuserDbUrl());
  if (res.ok) {
    throw new Error(
      "runLocalSuperuserSqlExpectingError: SQL 이 성공했다 — 슈퍼유저 탐침이 커밋됐을 수 있다. 즉시 확인할 것. " +
        `stdout: ${res.stdout.slice(0, 500)}`,
    );
  }
  return `${res.stdout}\n${res.stderr}`;
}

function localSuperuserDbUrl(): string {
  const toml = readFileSync(path.resolve(import.meta.dirname, "..", "..", "supabase", "config.toml"), "utf8");
  const db = toml.split(/^\[db\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  const port = Number(db.match(/^port\s*=\s*(\d+)/m)?.[1]);
  if (!Number.isInteger(port) || port <= 0) throw new Error("runLocalSuperuserSql: supabase/config.toml 의 [db] port 를 읽지 못했다");
  return `postgresql://supabase_admin:postgres@127.0.0.1:${port}/postgres`;
}

/**
 * CLI 출력에서 **값**만 꺼낸다 — 출력 형식에 기대지 않는다 (P5-15 R9).
 *
 * 왜: `supabase db query` 의 출력 형식은 **CLI 버전마다 다르다.** 로컬 2.117.0 은 JSON(`{"rows":[{"a":"…"}]}`)을,
 * CI(`supabase/setup-cli@v1` · `version: latest`)는 **ASCII 표**(`│ 값 │`)를 낸다. 값 끝의 따옴표나 표 테두리에
 * 기댄 단언은 **로컬만 통과하고 CI 에서 깨진다**(f696020 의 DB Smoke 실패가 그것이었다).
 *
 * 돌려주는 것: 머리글 칸을 포함한 모든 칸의 문자열(값이 하나뿐인 탐침에서는 `["a", "<값>"]` 꼴).
 * 머리글을 굳이 가려내지 않는다 — 단언은 "이 값이 칸 중에 있다" 로 쓰면 충분하고, 그쪽이 형식 변화에 더 둔하다.
 */
export function sqlCells(output: string): string[] {
  const parsed = tryJson(output) as { rows?: unknown[] } | undefined;
  if (parsed && Array.isArray(parsed.rows)) {
    return parsed.rows.flatMap((row) =>
      row !== null && typeof row === "object" ? Object.values(row as Record<string, unknown>).map(cellText) : [cellText(row)],
    );
  }
  const cells: string[] = [];
  for (const line of output.replace(/\r\n/g, "\n").split("\n")) {
    if (isRuleLine(line)) continue;
    for (const part of splitRow(line)) {
      const cell = part.trim();
      if (cell !== "" && !isRuleLine(cell)) cells.push(cell);
    }
  }
  return cells;
}

/**
 * 실패 출력에서 **오류 메시지**만 꺼낸다 — 형식에 기대지 않는다 (P5-15 R9).
 * JSON 이면 `error.message`(이스케이프가 풀린 상태)를, 아니면 표 테두리를 지운 본문을 돌려준다.
 * 되돌려지는 탐침이 `raise exception '<라벨> <payload>'` 로 실어 보낸 내용을 두 형식에서 **같은 글자**로 만든다.
 */
export function sqlErrorText(output: string): string {
  const parsed = tryJson(output) as { error?: { message?: unknown }; message?: unknown } | undefined;
  const msg = parsed?.error?.message ?? parsed?.message;
  if (typeof msg === "string") return msg;
  return output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !isRuleLine(line))
    .map((line) => splitRow(line).map((p) => p.trim()).filter((p) => p !== "").join(" "))
    .join("\n");
}

/**
 * 표의 한 줄을 칸으로 가른다. 칸 구분자는 **박스 문자 `│` 뿐**이고, ASCII `|` 는 줄 전체가 `|`로 시작·끝나는
 * 표 모양일 때만 구분자로 본다 — **값 안의 `|`**(예: `PG_TEMP_OK | search_path=…`)를 자르지 않기 위해서다
 * (P5-15 R9 실측: 이 구분을 두지 않으면 표 형식에서 탐침 하나가 깨졌다).
 */
function splitRow(line: string): string[] {
  if (line.includes("│")) return line.split("│");
  if (/^\s*\|.*\|\s*$/.test(line)) return line.split("|");
  return [line];
}

/** 표 테두리 줄(─ │ ┌ ┼ … · `-` `+` `=` 만으로 된 줄)인가. */
function isRuleLine(line: string): boolean {
  return /^[\s─-╿+=-]*$/.test(line) && /[─-╿+=-]/.test(line);
}

function cellText(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function tryJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  for (const candidate of [text.slice(start, end + 1), text.trim()]) {
    try {
      const v: unknown = JSON.parse(candidate);
      if (v !== null && typeof v === "object") return v;
    } catch {
      // 표 형식이거나 JSON 이 아닌 출력 — 호출자가 표 경로로 간다
    }
  }
  return undefined;
}

type ExecResult =
  | { ok: true; stdout: string }
  | { ok: false; command: string; status: number | null | undefined; stdout: string; stderr: string };

function execLocalSql(sql: string, superuserUrl?: string): ExecResult {
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
  if (superuserUrl !== undefined && !superuserUrl.startsWith("postgresql://supabase_admin:postgres@127.0.0.1:")) {
    throw new Error("runLocalSql: 슈퍼유저 연결은 127.0.0.1 로컬 스택만 허용한다");
  }
  const target = superuserUrl === undefined ? ["--local"] : ["--db-url", superuserUrl];
  // 출력 형식 강제 (P5-15 R9 · **실측 전용 손잡이**): 기본은 CLI 기본값이다(로컬 2.117.0 = JSON · CI latest = 표).
  // `P515_DB_QUERY_OUTPUT=table|csv|json` 을 주면 그 형식으로 받아, 같은 테스트가 **다른 CLI 형식에서도** 통과하는지
  // 로컬에서 재현할 수 있다. 단언은 형식을 지우고(sqlCells·sqlErrorText) 보므로 어느 값이든 통과해야 한다.
  const forced = process.env.P515_DB_QUERY_OUTPUT;
  const outputFlag = forced !== undefined && ["table", "csv", "json"].includes(forced) ? ["-o", forced] : [];
  const args = ["db", "query", ...target, "--yes", ...outputFlag, "-f"];
  const notFound: string[] = [];

  try {
    for (const [bin, prefix, shell] of candidates) {
      try {
        const stdout = execFileSync(bin, [...prefix, ...args, shell ? `"${file}"` : file], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120_000,
          windowsHide: true,
          shell,
        });
        return { ok: true, stdout };
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; status?: number | null };
        if (err.code === "ENOENT") {
          notFound.push(bin);
          continue;
        }
        return {
          ok: false,
          command: `${bin} ${[...prefix, ...args].join(" ")}`,
          status: err.status,
          stdout: (err.stdout ?? "").toString(),
          stderr: (err.stderr ?? "").toString(),
        };
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  throw new Error(`runLocalSql: supabase CLI 를 찾지 못했다 (시도: ${notFound.join(", ")})`);
}
