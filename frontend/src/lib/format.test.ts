import { describe, it, expect } from "vitest";
import { RUN_DETECTOR } from "@engine/params.live.js";
import { ALERT_LINE, wardStatuses, topCause, addDays } from "./format";

describe("format helpers", () => {
  it("uses exactly the detection module's live alert line", () => {
    expect(ALERT_LINE).toBe(RUN_DETECTOR.bayesAlertProbability);
  });
  it("derives ward status from risk and unresolved alerts", () => {
    const s = wardStatuses(
      [{ wardId: 1, probability: 0.05, contributingSignals: [] }, { wardId: 2, probability: 0.2, contributingSignals: [] }, { wardId: 3, probability: 0.9, contributingSignals: [] }, { wardId: 4, probability: 0.01, contributingSignals: [] }],
      [{ status: "acknowledged", alert: { wardId: 4 } }, { status: "resolved", alert: { wardId: 1 } }] as never,
    );
    expect([...s.entries()]).toEqual([[1, "calm"], [2, "watch"], [3, "alert"], [4, "alert"]]);
  });
  it("picks the top cause and adds days in UTC", () => {
    expect(topCause({ water: 0.2, food: 0.1, p2p: 0.1, seasonal: 0.05, unknown: 0.55 })).toBe("unknown");
    expect(addDays("2026-07-08", -56)).toBe("2026-05-13");
  });
});
