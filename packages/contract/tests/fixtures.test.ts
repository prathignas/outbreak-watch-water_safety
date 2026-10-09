import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAUSE_TYPES,
  DETECTION_METHODS,
  SIGNAL_TYPES,
  SOURCE_TAGS,
  type Alert,
  type LiveSignalRow,
} from "../src/index.js";

/* The fixtures are P1's handoff samples, made by P1's own code. */
function loadSample<T>(name: string): T {
  const path = new URL(`../../../detection/handoff/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

describe("signal rows (handoff/sample-live-day-normal.json)", () => {
  const signals = loadSample<{ rows: LiveSignalRow[] }>("sample-live-day-normal").rows;

  it("is not empty", () => {
    expect(signals.length).toBeGreaterThan(0);
  });

  it("every row matches the types and is tagged synthetic", () => {
    for (const row of signals) {
      expect(SIGNAL_TYPES).toContain(row.signalType);
      expect(SOURCE_TAGS).toContain(row.sourceTag);
      expect(row.sourceTag).toBe("synthetic");
      expect(row.date).toMatch(YYYY_MM_DD);
      expect(row.reportedOn >= row.date).toBe(true);
      expect(Number.isInteger(row.wardId)).toBe(true);
      expect(row.count).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("alerts (handoff/sample-run-detector.json)", () => {
  const sample = loadSample<{ firstDetection: { alerts: Alert[]; causeEvidence: Record<string, string[]> } }>("sample-run-detector");
  const alerts = sample.firstDetection.alerts;

  it("is not empty", () => {
    expect(alerts.length).toBeGreaterThan(0);
  });

  it.each(alerts)("alert for ward $wardId matches the types", (alert) => {
    expect(DETECTION_METHODS).toContain(alert.method);
    expect(alert.date).toMatch(YYYY_MM_DD);
    expect(alert.score).toBeGreaterThanOrEqual(0);
    expect(alert.score).toBeLessThanOrEqual(1);
    for (const signal of alert.contributingSignals) {
      expect(SIGNAL_TYPES).toContain(signal);
    }
    expect(Object.keys(alert.causeProbs).sort()).toEqual([...CAUSE_TYPES].sort());
    const total = Object.values(alert.causeProbs).reduce((sum, p) => sum + p, 0);
    expect(Math.abs(total - 1)).toBeLessThanOrEqual(0.001);
  });

  it("every sent alert has classifier reasons ending with the triage-hint line", () => {
    for (const alert of alerts) {
      const reasons = sample.firstDetection.causeEvidence[String(alert.wardId)];
      expect(reasons.at(-1)).toMatch(/^triage hint, not a diagnosis/);
    }
  });
});
