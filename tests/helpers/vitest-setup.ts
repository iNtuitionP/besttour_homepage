/**
 * vitest setupFiles — 모든 테스트 파일이 시작하기 전에 돈다 (P4-7 수정 라운드 2·3 · 리뷰 P1-1·P1-A).
 *
 * ① 실제 발송으로 이어질 수 있는 env 를 **빈 문자열로 고정**한다. 이유와 세 겹 방어는 ./notify-env.ts 헤더에 있다.
 *    셸에서 넘긴 값도 덮는다 — 테스트가 그 값이 필요하면 자기 안에서 가짜 값을 넣는다.
 * ② URL 이 로컬 스택이 아니면 service role 키를 비운다 — 테스트 프로세스가 운영 키를 들고 있지 못하게(로더도 같은 판정을 끝에서 다시 건다).
 */
import { SCRUBBED_NOTIFY_ENV, scrubRemoteServiceRole } from "./notify-env";

for (const key of SCRUBBED_NOTIFY_ENV) process.env[key] = "";
scrubRemoteServiceRole(process.env);
