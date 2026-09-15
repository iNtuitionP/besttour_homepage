import { describe, expect, test } from "vitest";
import { maskEmailAddress, maskName, maskPhone, maskStoredPhone } from "@/lib/mask";

describe("maskName", () => {
  test("masks a 3-character Korean name, keeping the first character", () => {
    expect(maskName("한지원")).toBe("한**");
  });

  test("masks a 1-character name", () => {
    expect(maskName("한")).toBe("한*");
  });

  test("masks a Latin name", () => {
    expect(maskName("John")).toBe("J**");
  });
});

describe("maskPhone", () => {
  test("masks a hyphenated 11-digit phone number", () => {
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
  });

  test("masks a non-hyphenated 11-digit phone number identically", () => {
    expect(maskPhone("01012345678")).toBe("010-****-5678");
  });

  test("masks a hyphenated 10-digit phone number", () => {
    expect(maskPhone("010-123-4567")).toBe("010-***-4567");
  });

  test("falls back to '***' for unrecognized input", () => {
    expect(maskPhone("abc")).toBe("***");
  });
});

/**
 * maskStoredPhone / maskEmailAddress — P5-8 이 lib/reservation-check/view.ts 에서 여기로 올린 공용 변환.
 * 두 화면(예약확인·발송 내역)이 같은 함수를 부르므로, 판정이 바뀌면 두 곳이 함께 바뀐다.
 * 아래 기대값은 P6-3a 리뷰 M-1 이 정한 fail-closed 규칙 그대로다 — tests/reservation-check.test.ts 가 화면 쪽에서 같은 것을 단언한다.
 */
describe("maskStoredPhone (저장형 E.164)", () => {
  test("+82 휴대전화만 국내 표기로 되돌려 가운데를 가린다", () => {
    expect(maskStoredPhone("+821012345678")).toBe("010-****-5678");
    expect(maskStoredPhone("+82 10 1234 5678")).toBe("010-****-5678");
    expect(maskStoredPhone("+821112345678")).toBe("011-****-5678");
    expect(maskStoredPhone("+82101234567")).toBe("010-***-4567");
  });

  test("그 밖은 전부 '***' — 해외 번호·유선·국내 표기 원문·형식 불명·빈 값 (fail-closed)", () => {
    for (const other of [
      "+15551234567",
      "+6581234567",
      "+447911123456",
      "+82212345678",
      "+8221234567",
      "+82",
      "010-1234-5678",
      "01012345678",
      "garbage",
      "",
      "   ",
    ]) {
      expect(maskStoredPhone(other), JSON.stringify(other)).toBe("***");
    }
  });

  test("해외 번호를 국내 번호처럼 오독하지 않는다 (리뷰 M-1 재현)", () => {
    expect(maskStoredPhone("+15551234567")).not.toBe("155-****-4567");
    expect(maskStoredPhone("+6581234567")).not.toBe("658-***-4567");
  });
});

describe("maskEmailAddress", () => {
  test("로컬 파트를 통째로 가리고 도메인만 남긴다", () => {
    expect(maskEmailAddress("bestour2013@naver.com")).toBe("***@naver.com");
    expect(maskEmailAddress("  a@b.co  ")).toBe("***@b.co");
    expect(maskEmailAddress("first.last+tag@example.test")).toBe("***@example.test");
  });

  test("@ 가 없거나 로컬 파트·도메인이 비면 '***'", () => {
    for (const bad of ["no-at-sign", "@naver.com", "local@", "", "   "]) {
      expect(maskEmailAddress(bad), JSON.stringify(bad)).toBe("***");
    }
  });
});
