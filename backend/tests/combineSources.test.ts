import { describe, expect, it } from "vitest";
import { SignalIndex } from "@outbreak/detection";
import { combineSources } from "../src/detector/combineSources.js";

describe("combineSources (before P1's runDetector / wardRisk)", () => {
  const synthetic = { wardId: 18, signalType: "complaint" as const, date: "2026-10-07", count: 2, sourceTag: "synthetic" as const, reportedOn: "2026-10-07" };
  const user = { ...synthetic, count: 1, sourceTag: "user" as const };

  it("adds simulated and form complaints for the same ward and day, in either order", () => {
    for (const rows of [[synthetic, user], [user, synthetic]]) {
      const view = new SignalIndex(combineSources(rows)).asOf("2026-10-07");
      expect(view.count(18, "complaint", "2026-10-07")).toBe(3);
    }
  });

  it("without it, P1's index keeps only the last row (the bug this fixes)", () => {
    expect(new SignalIndex([synthetic, user]).asOf("2026-10-07").count(18, "complaint", "2026-10-07")).toBe(1);
  });

  it("keeps other rows as they are, and uses the latest reportedOn of the parts", () => {
    const late = { ...synthetic, signalType: "hospital" as const, date: "2026-10-05", reportedOn: "2026-10-06" };
    const lateUser = { ...late, sourceTag: "user" as const, reportedOn: "2026-10-07" };
    const out = combineSources([late, lateUser, { ...synthetic, wardId: 19 }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ count: 4, reportedOn: "2026-10-07" });
    expect(out[1]).toEqual({ ...synthetic, wardId: 19 });
  });
});
