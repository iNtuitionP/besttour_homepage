import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { nightsBetween, parseKst } from "@/lib/kst";

describe("parseKst", () => {
  test("parses KST wall-clock string to correct UTC instant", () => {
    expect(parseKst("2026-09-01T08:00").toISOString()).toBe(
      "2026-08-31T23:00:00.000Z",
    );
  });

  test("handles midnight boundary correctly", () => {
    expect(parseKst("2026-09-01T00:00").toISOString()).toBe(
      "2026-08-31T15:00:00.000Z",
    );
  });

  describe("is independent of server TZ", () => {
    let originalTz: string | undefined;

    beforeEach(() => {
      originalTz = process.env.TZ;
      process.env.TZ = "America/New_York";
    });

    afterEach(() => {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    });

    test("still resolves to the same UTC instant", () => {
      expect(parseKst("2026-09-01T08:00").toISOString()).toBe(
        "2026-08-31T23:00:00.000Z",
      );
      expect(parseKst("2026-09-01T00:00").toISOString()).toBe(
        "2026-08-31T15:00:00.000Z",
      );
    });
  });

  test("throws on UTC 'Z' suffix input", () => {
    expect(() => parseKst("2026-09-01T08:00:00Z")).toThrow();
  });

  test("throws on invalid month", () => {
    expect(() => parseKst("2026-13-01T08:00")).toThrow();
  });

  test("throws on empty string", () => {
    expect(() => parseKst("")).toThrow();
  });
});

describe("nightsBetween", () => {
  test("same day departure/return is 0 nights", () => {
    expect(nightsBetween("2026-09-01T08:00", "2026-09-01T20:00")).toBe(0);
  });

  test("next day return is 1 night", () => {
    expect(nightsBetween("2026-09-01T08:00", "2026-09-02T09:00")).toBe(1);
  });

  test("multi-day return is counted correctly", () => {
    expect(nightsBetween("2026-09-01T08:00", "2026-09-04T09:00")).toBe(3);
  });

  test("throws when return precedes departure", () => {
    expect(() =>
      nightsBetween("2026-09-02T08:00", "2026-09-01T09:00"),
    ).toThrow();
  });
});
