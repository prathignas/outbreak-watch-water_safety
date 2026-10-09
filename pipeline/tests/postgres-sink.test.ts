import { describe, expect, it } from "vitest";
import type { ReportedSignalRow } from "@outbreak/contract";
import { PostgresSignalSink, type SignalWriter } from "../src/postgres-sink.js";
import { SignalIngestionEngine } from "../src/engine.js";

/** Records what the sink hands to the backend's insertSignals. The real database test is in backend/tests/postgres.test.ts. */
class RecordingWriter implements SignalWriter {
  calls: ReportedSignalRow[][] = [];
  async insertSignals(rows: ReportedSignalRow[]): Promise<number> {
    this.calls.push(rows);
    return rows.length;
  }
}

describe("PostgresSignalSink", () => {
  it("passes rows, with reportedOn, to insertSignals in one call", async () => {
    const writer = new RecordingWriter();
    const engine = new SignalIngestionEngine(new PostgresSignalSink(writer));
    await engine.ingest([
      { wardId: 0, signalType: "hospital", date: "2026-10-05", count: 3, sourceTag: "synthetic", reportedOn: "2026-10-07" },
      { wardId: 7, signalType: "rain", date: "2026-10-07", count: 1.5, sourceTag: "real" },
    ]);
    expect(writer.calls).toEqual([
      [
        { wardId: 0, signalType: "hospital", date: "2026-10-05", count: 3, sourceTag: "synthetic", reportedOn: "2026-10-07" },
        { wardId: 7, signalType: "rain", date: "2026-10-07", count: 1.5, sourceTag: "real", reportedOn: "2026-10-07" },
      ],
    ]);
  });

  it("does not call the database for an empty batch", async () => {
    const writer = new RecordingWriter();
    await new PostgresSignalSink(writer).write([]);
    expect(writer.calls).toHaveLength(0);
  });

  it("lets a database error through, so the caller knows nothing was saved", async () => {
    const failing: SignalWriter = { insertSignals: async () => Promise.reject(new Error("connection refused")) };
    const engine = new SignalIngestionEngine(new PostgresSignalSink(failing));
    await expect(
      engine.ingest([{ wardId: 1, signalType: "rain", date: "2026-10-07", count: 0, sourceTag: "real" }])
    ).rejects.toThrow("connection refused");
  });
});
