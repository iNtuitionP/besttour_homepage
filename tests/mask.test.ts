import { describe, expect, test } from "vitest";
import { maskName, maskPhone } from "@/lib/mask";

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
