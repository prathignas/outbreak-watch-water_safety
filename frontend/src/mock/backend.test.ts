import { describe, it, expect, beforeAll } from "vitest";
import city from "./data/city.json";
import rain from "./data/rain.json";
import { MockBackend, MOCK } from "./backend";
import type { CityFile } from "@engine/city.js";
import { addDays } from "@/lib/format";

let clock = 1_000_000;
const make = () => new MockBackend({ city: city as unknown as CityFile, rain, now: () => clock });

describe("mock backend (runs the detection module's own code)", () => {
  let backend: MockBackend;
  beforeAll(() => { backend = make(); }, 120_000);

  it("starts at the handoff demo date with detector-raised alerts", () => {
    expect(backend.state()).toMatchObject({ today: MOCK.startDate, seed: 2026, injection: null });
    const alerts = backend.listAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) {
      expect(a.status).toBe("open");
      expect(a.id).toBe(`${a.alert.method}-${a.alert.wardId}-${a.alert.date}`);
      expect(a.events).toEqual([{ at: a.createdAt, by: "Daily detector run", kind: "raised" }]);
      expect(a.alert.evidence.some((e) => e.includes("triage hint"))).toBe(false); // detector reasons only
      expect(a.causeEvidence.at(-1)).toContain("triage hint, not a diagnosis");
    }
  });

  it("an injected water outbreak produces an alert in its zone after the delay, with the zone suspected", () => {
    const { injection, appearsAfterMs } = backend.inject("water", 18);
    expect(injection).toMatchObject({ cause: "water", originWardId: 18, zoneId: 14 });
    const affected = new Set(injection.affectedWards.map((w) => w.wardId));
    const inZone = () => backend.listAlerts().filter((a) => affected.has(a.alert.wardId) && a.alert.date >= injection.startDate);
    expect(inZone()).toHaveLength(0); // not visible yet
    clock += appearsAfterMs;
    expect(inZone().length).toBeGreaterThan(0);
    expect(inZone().some((a) => a.alert.suspectedZoneId === 14)).toBe(true);
  }, 120_000);

  it("acknowledge, resolve and notes follow the allowed status changes and record who", () => {
    const id = backend.listAlerts()[0].id;
    expect(backend.ack(id, "Asha").status).toBe("acknowledged");
    expect(() => backend.ack(id, "Asha")).toThrow(/cannot become acknowledged/);
    const noted = backend.addNote(id, "Asha", "Checked the pipeline valve");
    expect(noted.events.at(-1)).toMatchObject({ by: "Asha", kind: "note", text: "Checked the pipeline valve" });
    expect(() => backend.addNote(id, "Asha", "   ")).toThrow(/empty/);
    const resolved = backend.resolve(id, "");
    expect(resolved.status).toBe("resolved");
    expect(resolved.events.at(-1)).toMatchObject({ by: "Unnamed officer", kind: "resolved" });
    expect(() => backend.resolve(id, "Asha")).toThrow(/cannot become resolved/);
    expect(() => backend.getAlert("nope")).toThrow(/No alert/);
  });

  it("serves only rows known by today (late rows stay out) and refuses future risk", () => {
    const today = backend.state().today;
    const rows = backend.wardSignals(39, "2026-06-01", "2026-12-31");
    expect(rows.every((r) => r.date <= today && r.reportedOn <= today)).toBe(true);
    expect(rows.some((r) => r.signalType === "rain" && r.sourceTag === "real")).toBe(true);
    expect(backend.risk(today)).toHaveLength(243);
    expect(() => backend.risk("2026-12-01")).toThrow(/demo clock/);
    expect(backend.rain("2026-07-01", "2026-12-31").at(-1)!.date).toBe(today);
  });

  it("fast-forward moves the clock one day; reset restores the start exactly", () => {
    const before = make().listAlerts();
    backend.advance();
    expect(backend.state().today).toBe("2026-07-09");
    backend.reset();
    expect(backend.state()).toMatchObject({ today: MOCK.startDate, injection: null });
    expect(backend.listAlerts()).toEqual(before);
  }, 120_000);
  it("syncTo moves the demo day forward to the real day and keeps what happened", () => {
    const backend = make();
    const id = backend.listAlerts()[0].id;
    backend.ack(id, "Asha Rao");
    const next = addDays(MOCK.startDate, 2);
    expect(backend.syncTo(next).today).toBe(next);
    expect(backend.getAlert(id).status).toBe("acknowledged");
    expect(backend.syncTo(MOCK.startDate).today).toBe(next); // never goes back
  });
});
