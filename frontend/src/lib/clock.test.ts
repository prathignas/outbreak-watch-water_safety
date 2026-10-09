import { describe, expect, it } from "vitest";
import { istDay } from "./clock";

describe("clock (IST)", () => {
  it("gives the India day, whatever the machine's timezone", () => {
    // 20:00 UTC on 9 Oct is 01:30 on 10 Oct in India.
    expect(istDay(Date.UTC(2026, 9, 9, 20, 0))).toBe("2026-10-10");
    // 18:29 UTC is 23:59 IST: still the same day.
    expect(istDay(Date.UTC(2026, 9, 9, 18, 29))).toBe("2026-10-09");
    expect(istDay(Date.UTC(2026, 9, 9, 18, 30))).toBe("2026-10-10");
  });
});
