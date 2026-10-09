import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MemoryDatabase } from "../src/db/repository.js";
import { MockSesService, SesService } from "../src/notifications/ses.js";
import { executeDetector, getCurrentIstDate, validateAlert } from "../src/detector/orchestrator.js";
import { getCity } from "../src/city.js";
import { DETECTOR } from "../src/config.js";
import {
  addDays,
  dateRange,
  emptyDetectorState,
  generateHistory,
  generateLiveDay,
  LIVE,
  type Alert,
} from "@outbreak/detection";

/*
 * The handoff scenario from P1 (detection/scripts/handoff.ts): seed 2026, a water outbreak
 * injected at ward 18 (zone 14) from 2026-07-06, runDetector run day by day from 2026-07-03.
 * The orchestrator must give exactly P1's sample output (detection/handoff/sample-run-detector.json).
 */
const SEED = 2026;
const START = "2026-07-06";
const FIRST_RUN = "2026-07-03";
const sample = JSON.parse(
  readFileSync(new URL("../../detection/handoff/sample-run-detector.json", import.meta.url), "utf8")
) as { firstDetection: { today: string; alerts: Alert[]; causeEvidence: Record<string, string[]> } };

async function seedHandoffScenario(db: MemoryDatabase) {
  const city = getCity();
  const inject = { injectOutbreak: "water" as const, wardId: 18, startDate: START, city };
  await db.insertSignals([
    ...generateHistory(START, LIVE.recommendedHistoryDays, SEED, { city }),
    ...dateRange(START, "2026-07-14").flatMap((d) => generateLiveDay(d, SEED, inject)),
  ]);
  // The sample starts from an empty state on FIRST_RUN; this saved state is the same thing "as of" the day before.
  await db.saveDetectorDay({
    method: "bayes",
    asOfDate: addDays(FIRST_RUN, -1),
    state: { ...emptyDetectorState("bayes"), lastRunDate: addDays(FIRST_RUN, -1) },
    alerts: [],
    actor: DETECTOR.actor,
    keepStateDays: DETECTOR.keepStateDays,
  });
}

describe("Detector Orchestration & Alert Persistence", () => {
  let db: MemoryDatabase;
  let ses: MockSesService;

  beforeEach(() => {
    db = new MemoryDatabase();
    ses = new MockSesService();
  });

  it("calculates valid IST date format YYYY-MM-DD", () => {
    expect(getCurrentIstDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("validates alert structure against the contract", () => {
    const valid = sample.firstDetection.alerts[0];
    expect(validateAlert(valid)).toBe(true);
    expect(validateAlert({ ...valid, score: 1.5 })).toBe(false);
    expect(validateAlert({ ...valid, wardId: "21" as any })).toBe(false);
    expect(validateAlert({ ...valid, date: "08-07-2026" })).toBe(false);
    expect(validateAlert({ ...valid, causeProbs: null as any })).toBe(false);
  });

  it("formats SES notification with required Subject format and all required fields", () => {
    const realSes = new SesService("from@example.com", "to@example.com");
    const alert = sample.firstDetection.alerts[0];
    const content = realSes.buildEmailContent(
      {
        ...alert,
        id: "00000000-0000-4000-8000-000000000001",
        status: "open",
        createdAt: new Date().toISOString(),
        causeEvidence: sample.firstDetection.causeEvidence[String(alert.wardId)],
      },
      "Kodigehalli (Ward 21)"
    );

    expect(content.subject).toBe(`Suspected Outbreak Signal — Ward ${alert.wardId}`);
    expect(content.textBody).toContain("SUSPECTED, NOT CONFIRMED");
    expect(content.textBody).toContain("Kodigehalli (Ward 21)");
    expect(content.textBody).toContain(alert.date);
    expect(content.textBody).toContain(`${(alert.score * 100).toFixed(1)}%`);
    expect(content.textBody).toContain("bayes");
    expect(content.textBody).toContain("triage hint, not a diagnosis");
    expect(content.textBody).toContain(`Zone ${alert.suspectedZoneId}`);
    expect(content.textBody).toContain(alert.evidence[0]);
    expect(content.textBody).toContain(sample.firstDetection.causeEvidence["21"][0]);
    expect(content.textBody).toContain("This is an automated early-warning signal and is not a confirmed outbreak.");

    expect(content.htmlBody).toContain("SUSPECTED, NOT CONFIRMED");
    expect(content.htmlBody).toContain("Suspected Outbreak Signal");
    expect(content.htmlBody).toContain(`Ward ${alert.wardId}`);
    expect(content.htmlBody).toContain("triage hint, not a diagnosis");
  });

  it("runs P1's runDetector day by day and stores exactly P1's sample alerts, causeEvidence and state", async () => {
    await seedHandoffScenario(db);

    const run = await executeDetector({ date: sample.firstDetection.today, db, sesService: ses });
    expect(run.daysRun).toEqual(dateRange(FIRST_RUN, sample.firstDetection.today));
    expect(run.signalsRead).toBeGreaterThan(70 * 243 * 3);

    const stored = await db.getAlerts({ date: sample.firstDetection.today });
    const byWard = new Map(stored.map((a) => [a.wardId, a]));
    expect([...byWard.keys()].sort()).toEqual(sample.firstDetection.alerts.map((a) => a.wardId).sort());
    for (const expected of sample.firstDetection.alerts) {
      const got = byWard.get(expected.wardId)!;
      const { id, status, createdAt, causeEvidence, ...alert } = got;
      expect(alert).toEqual(expected);
      expect(status).toBe("open");
      expect(causeEvidence).toEqual(sample.firstDetection.causeEvidence[String(expected.wardId)]);
      expect(causeEvidence.at(-1)).toMatch(/^triage hint, not a diagnosis/);
    }

    // State saved for the last day, so tomorrow's run continues from it.
    const state = await db.getLatestDetectorState("bayes");
    expect(state?.asOfDate).toBe(sample.firstDetection.today);
    expect(state?.state.lastRunDate).toBe(sample.firstDetection.today);

    // Every new alert: a "created" event, then an email and an "emailed" event.
    for (const a of run.alerts) {
      const events = await db.getAlertEvents(a.id);
      expect(events.map((e) => e.event)).toEqual(["created", "emailed"]);
      expect(events[0].actor).toBe("Daily detector run");
    }
    expect(ses.sentEmails.length).toBe(run.alertsPersisted);
  });

  it("the 5-minute run recomputes today from yesterday's state: same alerts updated, no duplicate email", async () => {
    await seedHandoffScenario(db);
    const today = sample.firstDetection.today;
    const first = await executeDetector({ date: today, db, sesService: ses });
    const emails = ses.sentEmails.length;
    const before = await db.getAlerts();

    const again = await executeDetector({ date: today, db, sesService: ses });
    expect(again.daysRun).toEqual([today]);
    expect(again.alertsPersisted).toBe(0);
    expect(again.duplicatesSkipped).toBe(again.alertsGenerated);
    expect((await db.getAlerts()).length).toBe(first.alertsPersisted);
    expect((await db.getAlerts()).map((a) => a.id).sort()).toEqual(before.map((a) => a.id).sort());
    expect(ses.sentEmails.length).toBe(emails);
    // The state is today's again, and yesterday's is still there for the next recompute.
    expect((await db.getLatestDetectorState("bayes"))?.asOfDate).toBe(today);
    expect((await db.getLatestDetectorState("bayes", addDays(today, -1)))?.asOfDate).toBe(addDays(today, -1));
  });

  it("the 5-minute run uses rows that arrived after today's first run", async () => {
    await seedHandoffScenario(db);
    const today = sample.firstDetection.today;
    await executeDetector({ date: today, db, sesService: ses });
    // A ward with no alert today gets a big late rise in every signal, reported today.
    const quiet = getCity().wardIds().find((w) => !sample.firstDetection.alerts.some((a) => a.wardId === w) && w > 100)!;
    const days = dateRange(addDays(today, -3), today);
    await db.insertSignals(days.flatMap((date) => (["complaint", "pharmacy", "hospital"] as const).map((signalType) => ({ wardId: quiet, signalType, date, count: 60, sourceTag: "synthetic" as const, reportedOn: today }))));

    const again = await executeDetector({ date: today, db, sesService: ses });
    expect(again.daysRun).toEqual([today]);
    expect(again.alerts.map((a) => a.wardId)).toContain(quiet);
  });

  it("cause wording: 'rain data not available' with no rain rows; the heavy-rain sentence once real rain is there", async () => {
    await seedHandoffScenario(db);
    const today = sample.firstDetection.today;
    const noRain = await executeDetector({ date: today, db, sesService: ses });
    const line = (a: { causeEvidence: string[] }) => a.causeEvidence.find((l) => l.includes("rain"));
    expect(noRain.alerts.length).toBeGreaterThan(0);
    for (const a of noRain.alerts) expect(line(a)).toBe("rain data not available");

    // Light real rain on every day and ward (as P2's rain job writes it), then re-run.
    const days = dateRange(addDays(today, -20), today);
    await db.insertSignals(days.flatMap((date) => getCity().wardIds().map((wardId) => ({ wardId, signalType: "rain" as const, date, count: 1.2, sourceTag: "real" as const, reportedOn: date }))));
    await executeDetector({ date: today, rerunFrom: FIRST_RUN, db, sesService: ses });
    const stored = await db.getAlerts({ date: today });
    expect(stored.length).toBeGreaterThan(0);
    for (const a of stored) expect(line(a)).toBe("no heavy rain in the last 10 days (real rain data)");
  });

  it("re-runs from a past day without duplicating alerts or emails", async () => {
    await seedHandoffScenario(db);
    const first = await executeDetector({ date: sample.firstDetection.today, db, sesService: ses });
    const emails = ses.sentEmails.length;

    const rerun = await executeDetector({ date: sample.firstDetection.today, rerunFrom: START, db, sesService: ses });
    expect(rerun.daysRun).toEqual(dateRange(START, sample.firstDetection.today));
    expect(rerun.alertsPersisted).toBe(0);
    expect(rerun.alertsRemoved).toBe(0);
    expect((await db.getAlerts()).length).toBe(first.alertsPersisted);
    expect(ses.sentEmails.length).toBe(emails);
  });

  it("never marks alert as emailed if SES failed and records failure event", async () => {
    await seedHandoffScenario(db);
    ses.shouldFail = true;

    const run = await executeDetector({ date: sample.firstDetection.today, db, sesService: ses });
    expect(run.alertsPersisted).toBeGreaterThan(0);

    for (const alert of run.alerts) {
      const events = await db.getAlertEvents(alert.id);
      expect(events[0].event).toBe("created");
      expect(events.some((e) => e.event === "emailed")).toBe(false);
      const failEvent = events.find((e) => e.event === "email_failed");
      expect(failEvent?.note).toContain("SES Sandbox restriction");
    }
  });

  it("handles database failures and scrubs secrets from logs", async () => {
    const brokenDb = Object.create(db);
    brokenDb.getSignals = vi.fn().mockRejectedValue(
      new Error("Connection error: postgres://fake_admin:fake_password@rds.internal:5432/db")
    );
    await expect(executeDetector({ date: "2026-10-06", db: brokenDb, sesService: ses })).rejects.toThrow(
      /postgres:\/\/\*\*\*:\*\*\*@rds\.internal/
    );
  });
});
