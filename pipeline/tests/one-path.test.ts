import { describe, expect, it } from "vitest";
import { RealCity } from "@outbreak/detection";
import { ComplaintAdapter } from "../src/adapters/complaint-adapter.js";
import { DatabaseComplaintEventStore, type ComplaintEventTable } from "../src/adapters/complaint-store.js";
import { HospitalAdapter } from "../src/adapters/hospital-adapter.js";
import { PharmacyAdapter } from "../src/adapters/pharmacy-adapter.js";
import { InMemoryWardResolver } from "../src/adapters/ward-resolver.js";
import { SignalIngestionEngine } from "../src/engine.js";
import { PipelineValidationError } from "../src/errors.js";
import { InMemorySignalStore } from "../src/sink.js";

const wardIds = RealCity.fromFile().wardIds();

/** Stands in for the complaint_events table: it outlives each adapter (like the database outlives a Lambda). */
class FakeTable implements ComplaintEventTable {
  rows = new Map<string, { wardId: number; date: string }>();
  async recordComplaintEvent(e: { id: string; wardId: number; date: string }) {
    if (this.rows.has(e.id)) return false;
    this.rows.set(e.id, { wardId: e.wardId, date: e.date });
    return true;
  }
  async hasComplaintEvent(id: string) {
    return this.rows.has(id);
  }
  async countComplaintEvents(wardId: number, date: string) {
    return [...this.rows.values()].filter((r) => r.wardId === wardId && r.date === date).length;
  }
}

describe("Complaints: the frontend form's body, de-dupe across restarts", () => {
  // What the backend passes on: the form's { complaintId, wardId, description } plus the server's receipt time.
  const formBody = (complaintId: string) => ({
    complaintId,
    wardId: 18,
    description: "Dirty tap water since yesterday",
    timestamp: "2026-10-07T05:00:00.000Z",
  });

  it("the form's fields pass the parser and give a 'user' row reported on the day received", async () => {
    const store = new InMemorySignalStore();
    const adapter = new ComplaintAdapter(new SignalIngestionEngine(store), new InMemoryWardResolver(), new DatabaseComplaintEventStore(new FakeTable()));
    const result = await adapter.ingestComplaints([formBody("form-1")], { strict: true, knownWardIds: wardIds, receivedOn: "2026-10-07" });
    expect(result.processedCount).toBe(1);
    expect(store.get(18, "complaint", "2026-10-07", "user")).toEqual({
      wardId: 18, signalType: "complaint", date: "2026-10-07", count: 1, sourceTag: "user", reportedOn: "2026-10-07",
    });
  });

  it("a retry after a restart (a new adapter, same table) is not counted twice; a new complaint is", async () => {
    const table = new FakeTable();
    const store = new InMemorySignalStore();
    const freshAdapter = () => new ComplaintAdapter(new SignalIngestionEngine(store), new InMemoryWardResolver(), new DatabaseComplaintEventStore(table));

    await freshAdapter().ingestComplaints([formBody("form-1")], { strict: true });
    const retry = await freshAdapter().ingestComplaints([formBody("form-1")], { strict: true });
    expect(retry.duplicateCount).toBe(1);
    expect(store.get(18, "complaint", "2026-10-07", "user")?.count).toBe(1);

    await freshAdapter().ingestComplaints([formBody("form-2")], { strict: true });
    expect(store.get(18, "complaint", "2026-10-07", "user")?.count).toBe(2);
  });

  it("an unknown ward is refused", async () => {
    const adapter = new ComplaintAdapter(new SignalIngestionEngine(new InMemorySignalStore()), new InMemoryWardResolver(), new DatabaseComplaintEventStore(new FakeTable()));
    await expect(adapter.ingestComplaints([{ ...formBody("x"), wardId: 999 }], { strict: true, knownWardIds: wardIds })).rejects.toThrow(PipelineValidationError);
  });
});

describe("Webhooks: the backend's documented body [{ wardId, count, date?, reportedOn? }]", () => {
  const RECEIVED = "2026-10-07";

  it("date and reportedOn default to the day received; tagged synthetic", async () => {
    const store = new InMemorySignalStore();
    await new PharmacyAdapter(new SignalIngestionEngine(store)).ingestPharmacyData([{ wardId: 18, count: 31 }], { receivedOn: RECEIVED, strict: true });
    expect(store.getAll()).toEqual([{ wardId: 18, signalType: "pharmacy", date: RECEIVED, count: 31, sourceTag: "synthetic", reportedOn: RECEIVED }]);
  });

  it("a late row keeps its date and is reported on the day received", async () => {
    const store = new InMemorySignalStore();
    await new HospitalAdapter(new SignalIngestionEngine(store)).ingestHospitalData([{ wardId: 18, count: 2, date: "2026-10-05" }], { receivedOn: RECEIVED });
    expect(store.get(18, "hospital", "2026-10-05", "synthetic")?.reportedOn).toBe(RECEIVED);
  });

  it("refuses reportedOn before date, reportedOn after the day received, and the wrong signal type", async () => {
    const adapter = new HospitalAdapter(new SignalIngestionEngine(new InMemorySignalStore()));
    await expect(adapter.ingestHospitalData([{ wardId: 18, count: 1, date: "2026-10-06", reportedOn: "2026-10-05" }], { receivedOn: RECEIVED })).rejects.toThrow(PipelineValidationError);
    await expect(adapter.ingestHospitalData([{ wardId: 18, count: 1, reportedOn: "2026-10-09" }], { receivedOn: RECEIVED })).rejects.toThrow(PipelineValidationError);
    await expect(adapter.ingestHospitalData([{ wardId: 18, count: 1, signalType: "pharmacy" }], { receivedOn: RECEIVED })).rejects.toThrow(PipelineValidationError);
  });

  it("a non-synthetic tag is refused (webhook data is synthetic)", async () => {
    const adapter = new PharmacyAdapter(new SignalIngestionEngine(new InMemorySignalStore()));
    await expect(adapter.ingestPharmacyData([{ wardId: 18, count: 1, sourceTag: "real" }], { receivedOn: RECEIVED })).rejects.toThrow(PipelineValidationError);
  });
});
