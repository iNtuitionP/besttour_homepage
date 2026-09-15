/**
 * P5-10 — tests/helpers/db-lock.ts 계약 테스트.
 *
 * 이 잠금이 지키는 불변식은 하나다: **같은 이름의 임계구역 안에는 한 번에 하나만 들어간다.**
 * 그 위에 통지 아웃박스(0005 claim / 0007 reap 이 표 전체를 훑는다)의 파일 간 배타성이 서 있으므로,
 * 잠금이 조용히 깨지면 그 위의 모든 DB 단언이 스케줄링에 따라 흔들린다 — 그래서 잠금 자체를 단언한다.
 *
 * §2 는 회귀다. 구현 도중 "남겨진 잠금 회수(stale steal)" 를 두 가지로 만들어 봤고 둘 다 상호배제를 깼다:
 *   ① `rmSync` 로 치우기 — 대기자 여럿이 각자 치우고 각자 만들어 넷이 동시에 쥐었다.
 *   ② 원자적 `rename` + "살아 있으면 되돌리기" — 되돌리는 사이 제3자가 자리를 차지하면 되돌릴 곳이 없다.
 * 그래서 회수를 **없앴다.** 남의 잠금은 어떤 경우에도 건드리지 않고, 정말 새면 제한시간 뒤 크게 실패한다.
 * 아래 테스트가 그 계약을 못 박는다 — 누군가 "편의상" 회수를 다시 넣으면 여기서 빨간불이 난다.
 *
 * 네트워크도 DB 도 쓰지 않는다 — 파일시스템만.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { acquireDbLock, listHeldLocks, GALLERY_LOCK, NOTIFICATIONS_LOCK, type DbLock } from "./helpers/db-lock";

const LOCK_ROOT = path.join(tmpdir(), "besttour-test-db-locks");
const names: string[] = [];

/** 실제 스위트가 쓰는 이름(notifications-log)과 절대 겹치지 않는 임시 이름. */
function uniqueName(label: string): string {
  const n = `p510-${label}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  names.push(n);
  return n;
}

const dirOf = (name: string) => path.join(LOCK_ROOT, `${name}.lock`);

/** 잠금 디렉터리에 적힌 소유자 pid (없으면 null). */
function ownerOf(name: string): number | null {
  try {
    return Number.parseInt(readFileSync(path.join(dirOf(name), "owner"), "utf8").trim(), 10);
  } catch {
    return null;
  }
}

afterEach(() => {
  for (const n of names.splice(0)) rmSync(dirOf(n), { recursive: true, force: true });
});

/** 확실히 죽은 pid — 자식을 띄웠다가 끝내고 그 번호를 쓴다(임의의 큰 숫자보다 확실하다). */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", "0"], { stdio: "ignore" });
  if (typeof r.pid !== "number") throw new Error("자식 프로세스를 띄우지 못했다");
  return r.pid;
}

/** 소유자 pid 가 `pid` 이고 `ageMs` 만큼 나이 먹은 잠금을 미리 깔아 둔다(강제 종료된 워커의 잔해를 흉내낸다). */
function seedLock(name: string, pid: number, ageMs: number): void {
  const dir = dirOf(name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "owner"), String(pid), "utf8");
  const when = new Date(Date.now() - ageMs);
  utimesSync(dir, when, when);
}

/**
 * n 명이 동시에 잠금을 잡았다 놓는다. 임계구역 안의 동시 인원을 세어 최대치를 돌려준다.
 * 1 이 아니면 상호배제가 깨진 것이다.
 */
async function contend(name: string, n: number, holdMs = 30): Promise<{ maxInside: number; entered: number }> {
  let inside = 0;
  let maxInside = 0;
  let entered = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      const lock = await acquireDbLock(name, 20_000);
      inside++;
      entered++;
      maxInside = Math.max(maxInside, inside);
      await new Promise((r) => setTimeout(r, holdMs));
      inside--;
      lock.release();
    }),
  );
  return { maxInside, entered };
}

describe("1. 상호배제", () => {
  test("동시에 다섯이 달려들어도 임계구역 안에는 언제나 하나뿐이고, 다섯 다 결국 들어간다", async () => {
    const name = uniqueName("mutex");
    const { maxInside, entered } = await contend(name, 5);
    expect(maxInside, "둘 이상이 동시에 잠금을 쥐었다 — 상호배제가 깨졌다").toBe(1);
    expect(entered).toBe(5);
    expect(existsSync(dirOf(name)), "다 끝난 뒤에는 잠금이 남아 있지 않다").toBe(false);
  });

  test("잡은 동안 소유자 pid 가 적혀 있고, 풀면 디렉터리째 사라진다", async () => {
    const name = uniqueName("owner");
    const lock = await acquireDbLock(name, 5_000);
    expect(ownerOf(name)).toBe(process.pid);
    expect(listHeldLocks()).toContain(`${name}.lock`);
    lock.release();
    expect(existsSync(dirOf(name))).toBe(false);
  });

  test("release 는 여러 번 불러도 안전하고, 푼 뒤에는 다음 사람이 곧바로 잡는다", async () => {
    const name = uniqueName("release");
    const a: DbLock = await acquireDbLock(name, 5_000);
    a.release();
    a.release();
    const b = await acquireDbLock(name, 5_000);
    b.release();
    expect(existsSync(dirOf(name))).toBe(false);
  });
});

describe("2. 남의 잠금은 절대 건드리지 않는다 (회수를 다시 넣으면 여기서 깨진다)", () => {
  test("소유자가 죽었어도 뺏지 않는다 — 기다리다 제한시간에 걸려, 지우는 법을 적어 실패한다", async () => {
    const name = uniqueName("dead-owner");
    seedLock(name, deadPid(), 10_000);

    await expect(acquireDbLock(name, 400)).rejects.toThrow(/잠금을 얻지 못했다/);
    expect(existsSync(dirOf(name)), "죽은 소유자의 잠금을 뺏었다 — 회수는 상호배제를 깨뜨린다(주석 참고)").toBe(true);

    // 실패 메시지는 사람이 곧바로 손쓸 수 있어야 한다: 경로와 rm 명령이 들어 있다.
    await expect(acquireDbLock(name, 200)).rejects.toThrow(new RegExp(`rm -rf[\\s\\S]*${name}\\.lock`));
  });

  test("아주 오래된 잠금도 뺏지 않는다 — 시간은 소유권을 옮기지 않는다", async () => {
    const name = uniqueName("ancient");
    seedLock(name, deadPid(), 24 * 60 * 60 * 1000);
    await expect(acquireDbLock(name, 300)).rejects.toThrow(/잠금을 얻지 못했다/);
    expect(existsSync(dirOf(name))).toBe(true);
  });

  test("살아 있는 소유자의 잠금도 당연히 그대로다 — 소유 pid 가 메시지에 찍힌다", async () => {
    const name = uniqueName("alive");
    seedLock(name, process.pid, 10_000);
    await expect(acquireDbLock(name, 300)).rejects.toThrow(new RegExp(`소유 pid ${process.pid}`));
    expect(existsSync(dirOf(name)), "살아 있는 소유자의 잠금이 사라졌다").toBe(true);
  });

  test("사람이 잔해를 지우면 곧바로 다시 돌아간다 (복구 절차가 실제로 통한다)", async () => {
    const name = uniqueName("recover");
    seedLock(name, deadPid(), 10_000);
    await expect(acquireDbLock(name, 200)).rejects.toThrow();
    rmSync(dirOf(name), { recursive: true, force: true }); // 메시지가 시키는 그대로
    const lock = await acquireDbLock(name, 5_000);
    expect(ownerOf(name)).toBe(process.pid);
    lock.release();
  });
});

// =============================================================================
// 3. 잠금이 둘이 되었다 (P6-3b) — 이름이 다르면 서로를 막지 않는다
// =============================================================================
/**
 * 갤러리 표에도 같은 부류의 경합이 있어 두 번째 잠금을 세웠다(`GALLERY_LOCK`).
 * 여기서 잠그는 계약은 둘이다:
 *   ① 이름이 다르면 **서로를 막지 않는다** — 막으면 아웃박스 블록과 갤러리 블록이 공연히 줄을 서고,
 *     "전체 직렬 실행을 피한다" 는 이 잠금의 존재 이유가 사라진다.
 *   ② 이름이 같으면 당연히 막는다(§1 과 같은 성질이지만 실제 상수로 한 번 더 확인한다).
 * 실제 상수를 쓰되 **잡지는 않는다** — 스위트가 도는 중에 진짜 잠금을 잡으면 그 블록들을 세운다.
 */
describe("3. 두 잠금 (P6-3b)", () => {
  test("이름이 서로 다르다 — 같은 이름이면 갤러리와 아웃박스가 한 줄에 선다", () => {
    expect(NOTIFICATIONS_LOCK).not.toBe(GALLERY_LOCK);
    for (const n of [NOTIFICATIONS_LOCK, GALLERY_LOCK]) {
      expect(n, `잠금 이름이 파일명으로 쓰이므로 경로 문자가 들어가면 안 된다: ${n}`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  test("이름이 다른 두 잠금은 동시에 잡힌다 (공연히 줄 세우지 않는다)", async () => {
    const a = uniqueName("pair-a");
    const b = uniqueName("pair-b");
    const lockA = await acquireDbLock(a, 5_000);
    // b 를 짧은 제한시간으로 잡는다 — a 가 막는다면 여기서 던진다.
    const lockB = await acquireDbLock(b, 1_000);
    expect(ownerOf(a)).toBe(process.pid);
    expect(ownerOf(b)).toBe(process.pid);
    lockA.release();
    lockB.release();
  });

  test("같은 이름 둘은 여전히 줄을 선다 (§1 과 같은 성질 — 이름 분리가 배타성을 약하게 만들지 않았다)", async () => {
    const name = uniqueName("same-name");
    const held = await acquireDbLock(name, 5_000);
    await expect(acquireDbLock(name, 300)).rejects.toThrow(/잠금을 얻지 못했다/);
    held.release();
    const next = await acquireDbLock(name, 5_000);
    next.release();
  });
});
