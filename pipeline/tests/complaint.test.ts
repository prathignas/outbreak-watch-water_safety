import type { SignalSink } from "../src/index.js";
import { describe, expect, it } from "vitest";
import { ComplaintAdapter } from "../src/adapters/complaint-adapter.js";
import {
  type RawComplaintEvent,
  resolveAndValidateComplaintEvent,
} from "../src/adapters/complaint-parser.js";
import { InMemoryComplaintEventStore } from "../src/adapters/complaint-store.js";
import {
  type GeoLocation,
  InMemoryWardResolver,
  type WardResolver,
} from "../src/adapters/ward-resolver.js";
import { SignalIngestionEngine } from "../src/engine.js";
import { PipelineValidationError } from "../src/errors.js";
import { InMemorySignalStore } from "../src/sink.js";

describe("Complaint Ingestion Adapter", () => {
  function setupTestEnvironment() {
    const signalStore = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(signalStore);
    const wardResolver = new InMemoryWardResolver();
    const eventStore = new InMemoryComplaintEventStore();
    const adapter = new ComplaintAdapter(engine, wardResolver, eventStore);

    // Setup mock ward resolver mappings
    wardResolver.setPoint(12.9716, 77.5946, 40);
    wardResolver.setPoint(12.9800, 77.6000, 41);
    wardResolver.addBoundingBox(42, 12.90, 12.95, 77.50, 77.55);

    return { signalStore, engine, wardResolver, eventStore, adapter };
  }

  it("1. One valid complaint -> one SignalRow with count = 1", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    const result = await adapter.ingestComplaints([
      {
        id: "c-1",
        content: "Water smells bad and fever reported",
        timestamp: "2026-10-06T10:00:00.000Z",
        latitude: 12.9716,
        longitude: 77.5946,
      },
    ]);

    expect(result.processedCount).toBe(1);
    expect(result.duplicateCount).toBe(0);
    expect(result.errorCount).toBe(0);

    expect(signalStore.size).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")).toEqual({
      wardId: 40,
      signalType: "complaint",
      date: "2026-10-06",
      count: 1,
      sourceTag: "user",
      reportedOn: "2026-10-06",
    });
  });

  it("2. Two different complaints on same ward + same IST date -> one SignalRow with count = 2", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    const result = await adapter.ingestComplaints([
      {
        id: "c-1",
        content: "Stomach pain in family",
        timestamp: "2026-10-06T08:00:00Z",
        wardId: 40,
      },
      {
        id: "c-2",
        content: "Tap water muddy",
        timestamp: "2026-10-06T12:00:00Z",
        wardId: 40,
      },
    ]);

    expect(result.processedCount).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(signalStore.size).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(2);
  });

  it("3. Same complaint delivered twice in same batch -> count remains 1", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    const rawEvent = {
      id: "c-dup-1",
      content: "Severe vomiting",
      timestamp: "2026-10-06T09:00:00Z",
      wardId: 40,
    };

    const result = await adapter.ingestComplaints([rawEvent, rawEvent]);

    expect(result.totalReceived).toBe(2);
    expect(result.processedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);
  });

  it("4. Same complaint replayed in a later batch -> count remains unchanged", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    const rawEvent = {
      id: "c-replay-1",
      content: "Contaminated borewell",
      timestamp: "2026-10-06T10:00:00Z",
      wardId: 40,
    };

    // First batch
    await adapter.ingestComplaints([rawEvent]);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);

    // Later batch with same event
    const secondResult = await adapter.ingestComplaints([rawEvent]);
    expect(secondResult.processedCount).toBe(0);
    expect(secondResult.duplicateCount).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);
  });

  it("5. Three distinct complaints + one retry -> count = 3", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    const batch = [
      { id: "c-101", content: "Issue 1", timestamp: "2026-10-06T08:00:00Z", wardId: 40 },
      { id: "c-102", content: "Issue 2", timestamp: "2026-10-06T09:00:00Z", wardId: 40 },
      { id: "c-101", content: "Issue 1 (retry)", timestamp: "2026-10-06T08:00:00Z", wardId: 40 },
      { id: "c-103", content: "Issue 3", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
    ];

    const result = await adapter.ingestComplaints(batch);
    expect(result.totalReceived).toBe(4);
    expect(result.processedCount).toBe(3);
    expect(result.duplicateCount).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(3);
  });

  it("6. Complaints from different wards -> separate SignalRows", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    await adapter.ingestComplaints([
      { id: "w-40", content: "Fever in Ward 40", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
      { id: "w-41", content: "Fever in Ward 41", timestamp: "2026-10-06T11:00:00Z", wardId: 41 },
    ]);

    expect(signalStore.size).toBe(2);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);
    expect(signalStore.get(41, "complaint", "2026-10-06", "user")?.count).toBe(1);
  });

  it("7. Complaints on different IST dates -> separate SignalRows", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    await adapter.ingestComplaints([
      { id: "d-1", content: "Day 1", timestamp: "2026-10-05T10:00:00Z", wardId: 40 },
      { id: "d-2", content: "Day 2", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
    ]);

    expect(signalStore.size).toBe(2);
    expect(signalStore.get(40, "complaint", "2026-10-05", "user")?.count).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);
  });

  it("8. Timestamp just before IST midnight (18:29:59.999Z) -> mapped to previous IST date", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    await adapter.ingestComplaints([
      {
        id: "midnight-before",
        content: "Just before midnight",
        timestamp: "2026-10-06T18:29:59.999Z", // 23:59:59.999 IST on Oct 6
        wardId: 40,
      },
    ]);

    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-07", "user")).toBeUndefined();
  });

  it("9. Timestamp exactly at IST midnight (18:30:00.000Z) -> mapped to next IST date", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    await adapter.ingestComplaints([
      {
        id: "midnight-exact",
        content: "Exact midnight",
        timestamp: "2026-10-06T18:30:00.000Z", // 00:00:00.000 IST on Oct 7
        wardId: 40,
      },
    ]);

    expect(signalStore.get(40, "complaint", "2026-10-07", "user")?.count).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")).toBeUndefined();
  });

  it("10. Invalid complaint content -> rejected", async () => {
    const { adapter } = setupTestEnvironment();

    const emptyContent = { id: "bad-1", content: "   ", timestamp: "2026-10-06", wardId: 40 };
    const missingContent = { id: "bad-2", timestamp: "2026-10-06", wardId: 40 };

    const result = await adapter.ingestComplaints([emptyContent, missingContent]);
    expect(result.errorCount).toBe(2);
    expect(result.errors[0].error).toBeInstanceOf(PipelineValidationError);
  });

  it("11. Invalid/missing complaint event ID -> rejected", async () => {
    const { adapter } = setupTestEnvironment();

    const missingId = { content: "Valid content", timestamp: "2026-10-06", wardId: 40 };
    const emptyId = { id: "", content: "Valid content", timestamp: "2026-10-06", wardId: 40 };

    const result = await adapter.ingestComplaints([missingId, emptyId]);
    expect(result.errorCount).toBe(2);
    expect(result.errors[0].error).toBeInstanceOf(PipelineValidationError);
  });

  it("12. Invalid timestamp -> rejected", async () => {
    const { adapter } = setupTestEnvironment();

    const invalidTimestamp = {
      id: "bad-time",
      content: "Valid content",
      timestamp: "not-a-valid-time",
      wardId: 40,
    };

    const result = await adapter.ingestComplaints([invalidTimestamp]);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0].error).toBeInstanceOf(PipelineValidationError);
  });

  it("13. Invalid/missing location -> rejected", async () => {
    const { adapter } = setupTestEnvironment();

    const missingLocation = {
      id: "no-loc",
      content: "Valid content",
      timestamp: "2026-10-06T10:00:00Z",
    };
    const invalidCoords = {
      id: "bad-coords",
      content: "Valid content",
      timestamp: "2026-10-06T10:00:00Z",
      latitude: 105, // Invalid latitude (> 90)
      longitude: 77.5,
    };

    const result = await adapter.ingestComplaints([missingLocation, invalidCoords]);
    expect(result.errorCount).toBe(2);
    expect(result.errors[0].error).toBeInstanceOf(PipelineValidationError);
  });

  it("14. WardResolver returns no ward -> complaint rejected/quarantined", async () => {
    const { adapter } = setupTestEnvironment();

    const outOfBoundsComplaint = {
      id: "out-of-bounds",
      content: "Outside covered area",
      timestamp: "2026-10-06T10:00:00Z",
      latitude: 0.0,
      longitude: 0.0, // Not mapped in WardResolver
    };

    const result = await adapter.ingestComplaints([outOfBoundsComplaint]);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0].error).toBeInstanceOf(PipelineValidationError);
  });

  it("15. Rerunning the same batch -> no double counting", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    const batch = [
      { id: "b-1", content: "Complaint 1", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
      { id: "b-2", content: "Complaint 2", timestamp: "2026-10-06T11:00:00Z", wardId: 40 },
    ];

    await adapter.ingestComplaints(batch);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(2);

    // Rerun exact batch
    const rerunResult = await adapter.ingestComplaints(batch);
    expect(rerunResult.processedCount).toBe(0);
    expect(rerunResult.duplicateCount).toBe(2);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(2);
  });

  it("16. Canonical rows pass through existing SignalIngestionEngine and match contract", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    await adapter.ingestComplaints([
      { id: "canon-1", content: "Contract check", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
    ]);

    const storedRow = signalStore.get(40, "complaint", "2026-10-06", "user");
    expect(storedRow).toEqual({
      wardId: 40,
      signalType: "complaint",
      date: "2026-10-06",
      count: 1,
      sourceTag: "user",
      reportedOn: "2026-10-06",
    });
  });

  it("17. Demonstrates WardResolver abstraction can plug into future PostGIS implementation without changing adapter", async () => {
    const signalStore = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(signalStore);

    // Mock representation of a future PostGIS spatial resolver
    const mockPostGisResolver: WardResolver = {
      resolveWard: async (loc: GeoLocation): Promise<number | null> => {
        // Simulates async ST_Contains query: SELECT id FROM wards WHERE ST_Contains(geom, ST_SetSRID(ST_Point(lng, lat), 4326))
        if (loc.latitude === 12.9716 && loc.longitude === 77.5946) {
          return 40;
        }
        return null;
      },
    };

    const adapter = new ComplaintAdapter(engine, mockPostGisResolver);

    await adapter.ingestComplaints([
      {
        id: "postgis-test-1",
        content: "Spatial lookup complaint",
        timestamp: "2026-10-06T14:00:00Z",
        latitude: 12.9716,
        longitude: 77.5946,
      },
    ]);

    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);
  });

  it("18. Two ComplaintAdapter instances share one event store: 5 complaints -> 6th new one emits count 6, and replays do not change it", async () => {
    const signalStore = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(signalStore);
    const wardResolver = new InMemoryWardResolver();
    const sharedEventStore = new InMemoryComplaintEventStore();

    // Two adapter instances sharing the same underlying persistent event store
    const adapter1 = new ComplaintAdapter(engine, wardResolver, sharedEventStore);
    const adapter2 = new ComplaintAdapter(engine, wardResolver, sharedEventStore);

    // Ingest 5 complaints via adapter 1
    const batch1 = [
      { id: "c-1", content: "Water bad", timestamp: "2026-10-06T08:00:00Z", wardId: 40 },
      { id: "c-2", content: "Vomiting", timestamp: "2026-10-06T09:00:00Z", wardId: 40 },
      { id: "c-3", content: "Fever reported", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
      { id: "c-4", content: "Smell issue", timestamp: "2026-10-06T11:00:00Z", wardId: 40 },
      { id: "c-5", content: "Diarrhea", timestamp: "2026-10-06T12:00:00Z", wardId: 40 },
    ];

    const res1 = await adapter1.ingestComplaints(batch1);
    expect(res1.processedCount).toBe(5);
    expect(res1.duplicateCount).toBe(0);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(5);

    // Ingest 6th new complaint via adapter 2
    const batch2 = [
      { id: "c-6", content: "Contaminated well", timestamp: "2026-10-06T13:00:00Z", wardId: 40 },
    ];

    const res2 = await adapter2.ingestComplaints(batch2);
    expect(res2.processedCount).toBe(1);
    expect(res2.duplicateCount).toBe(0);
    // Must emit count 6
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(6);

    // Replay any of the earlier complaints via adapter 2
    const replayBatch = [
      { id: "c-2", content: "Vomiting", timestamp: "2026-10-06T09:00:00Z", wardId: 40 },
      { id: "c-6", content: "Contaminated well", timestamp: "2026-10-06T13:00:00Z", wardId: 40 },
    ];

    const replayRes = await adapter2.ingestComplaints(replayBatch);
    expect(replayRes.processedCount).toBe(0);
    expect(replayRes.duplicateCount).toBe(2);
    // Count remains 6
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(6);
  });

  it("19. Case a: Failure after record - Retry after engine/sink failure produces correct daily row in sink", async () => {
    const signalStore = new InMemorySignalStore();
    let shouldFail = true;
    const failingSink: SignalSink = {
      write: (rows) => {
        if (shouldFail) {
          throw new Error("Sink write failure");
        }
        signalStore.write(rows);
      },
    };
    const engine = new SignalIngestionEngine(failingSink);
    const wardResolver = new InMemoryWardResolver();
    const eventStore = new InMemoryComplaintEventStore();
    const adapter = new ComplaintAdapter(engine, wardResolver, eventStore);

    const rawEvent = {
      id: "c-fail-1",
      content: "Water contaminated",
      timestamp: "2026-10-06T10:00:00Z",
      wardId: 40,
    };

    // First attempt: eventStore records event, but sink throws
    await expect(adapter.ingestComplaints([rawEvent])).rejects.toThrow("Sink write failure");
    expect(eventStore.has("c-fail-1")).toBe(true);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")).toBeUndefined();

    // Retry same event after sink recovers
    shouldFail = false;
    const retryResult = await adapter.ingestComplaints([rawEvent]);
    expect(retryResult.duplicateCount).toBe(1);
    // Must produce the correct daily row in the sink
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")).toEqual({
      wardId: 40,
      signalType: "complaint",
      date: "2026-10-06",
      count: 1,
      sourceTag: "user",
      reportedOn: "2026-10-06",
    });
  });

  it("20. Case b: Replay of an already-recorded event re-emits idempotent daily row with correct count", async () => {
    const { signalStore, adapter } = setupTestEnvironment();
    const rawEvent = {
      id: "c-replay-test",
      content: "Replay test",
      timestamp: "2026-10-06T10:00:00Z",
      wardId: 40,
    };

    // Initial ingestion
    await adapter.ingestComplaints([rawEvent]);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);

    // Replay in a separate batch
    const replayResult = await adapter.ingestComplaints([rawEvent]);
    expect(replayResult.processedCount).toBe(0);
    expect(replayResult.duplicateCount).toBe(1);
    // Emitted count in sink stays correct (1) and row is re-emitted idempotently
    expect(replayResult.ingestResult.writtenCount).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);
  });

  it("21. Case c: Same event id twice inside ONE batch (identical content and different content) -> count is 1, second is reported as duplicate", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    // 1. Identical content
    const batchIdentical = [
      { id: "c-dup-same", content: "Same content", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
      { id: "c-dup-same", content: "Same content", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
    ];
    const res1 = await adapter.ingestComplaints(batchIdentical);
    expect(res1.totalReceived).toBe(2);
    expect(res1.processedCount).toBe(1);
    expect(res1.duplicateCount).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);

    // 2. Different content, same ID
    const batchDifferent = [
      { id: "c-dup-diff", content: "Original content", timestamp: "2026-10-06T11:00:00Z", wardId: 41 },
      { id: "c-dup-diff", content: "Modified content", timestamp: "2026-10-06T11:00:00Z", wardId: 41 },
    ];
    const res2 = await adapter.ingestComplaints(batchDifferent);
    expect(res2.totalReceived).toBe(2);
    expect(res2.processedCount).toBe(1);
    expect(res2.duplicateCount).toBe(1);
    expect(signalStore.get(41, "complaint", "2026-10-06", "user")?.count).toBe(1);
  });

  it("22. Case d: Coordinates in no ward, on boundary, NaN, Infinity, lat 91, lng 181, swapped lat/lng", async () => {
    const { wardResolver } = setupTestEnvironment();

    // 1. Coordinates in no ward
    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-d1", content: "No ward", timestamp: "2026-10-06T10:00:00Z", latitude: 0, longitude: 0 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    // 2. Coordinates on boundary (minLat: 12.90, minLng: 77.50 mapped to Ward 42)
    const onBoundary = await resolveAndValidateComplaintEvent(
      { id: "c-d2", content: "Boundary", timestamp: "2026-10-06T10:00:00Z", latitude: 12.90, longitude: 77.50 },
      wardResolver
    );
    expect(onBoundary.wardId).toBe(42);

    // 3. NaN / Infinity
    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-d3", content: "NaN coords", timestamp: "2026-10-06T10:00:00Z", latitude: Number.NaN, longitude: 77.59 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-d4", content: "Inf coords", timestamp: "2026-10-06T10:00:00Z", latitude: 12.97, longitude: Number.POSITIVE_INFINITY },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    // 4. Lat 91 (> 90) / Lng 181 (> 180)
    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-d5", content: "Lat 91", timestamp: "2026-10-06T10:00:00Z", latitude: 91, longitude: 77.59 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-d6", content: "Lng 181", timestamp: "2026-10-06T10:00:00Z", latitude: 12.97, longitude: 181 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    // 5. Swapped lat/lng (e.g. lat: 77.5946, lng: 12.9716 is out of covered boundary in Bengaluru)
    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-d7", content: "Swapped", timestamp: "2026-10-06T10:00:00Z", latitude: 77.5946, longitude: 12.9716 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);
  });

  it("23. Case e: Both wardId and coordinates given and they disagree -> conflict rejected, not silent", async () => {
    const { wardResolver } = setupTestEnvironment();

    // Coordinates (12.9800, 77.6000) resolve to Ward 41, but payload specifies wardId 40 -> must reject conflict
    await expect(
      resolveAndValidateComplaintEvent(
        {
          id: "c-e1",
          content: "Conflicting ward and coords",
          timestamp: "2026-10-06T10:00:00Z",
          wardId: 40,
          latitude: 12.9800,
          longitude: 77.6000, // Ward 41
        },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    // Agreeing wardId and coordinates -> accepted
    const agreeing = await resolveAndValidateComplaintEvent(
      {
        id: "c-e2",
        content: "Matching ward and coords",
        timestamp: "2026-10-06T10:00:00Z",
        wardId: 40,
        latitude: 12.9716,
        longitude: 77.5946, // Ward 40
      },
      wardResolver
    );
    expect(agreeing.wardId).toBe(40);
  });

  it("24. Case f: Invalid wardId (-1, 1.5, '40', null) and unknown ward in knownWardIds; ward 0 is allowed", async () => {
    const { adapter, wardResolver } = setupTestEnvironment();

    // Ward id 0 is allowed (contract: ward ids are >= 0)
    const wardZero = await resolveAndValidateComplaintEvent(
      { id: "c-f1", content: "Ward 0", timestamp: "2026-10-06T10:00:00Z", wardId: 0 },
      wardResolver
    );
    expect(wardZero.wardId).toBe(0);

    // Invalid wardIds

    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-f2", content: "Ward -1", timestamp: "2026-10-06T10:00:00Z", wardId: -1 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-f3", content: "Ward 1.5", timestamp: "2026-10-06T10:00:00Z", wardId: 1.5 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-f4", content: "Ward string", timestamp: "2026-10-06T10:00:00Z", wardId: "40" as unknown as number },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-f5", content: "Ward null", timestamp: "2026-10-06T10:00:00Z", wardId: null as unknown as number },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    // knownWardIds filtering
    const batch = [
      { id: "c-known", content: "Known ward", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
      { id: "c-unknown", content: "Unknown ward", timestamp: "2026-10-06T10:00:00Z", wardId: 999 },
    ];

    // Non-strict: unlisted ward routed to errors array
    const res = await adapter.ingestComplaints(batch, { knownWardIds: [40, 41] });
    expect(res.processedCount).toBe(1);
    expect(res.errorCount).toBe(1);
    expect(res.errors[0].index).toBe(1);

    // Strict: throws immediately
    await expect(
      adapter.ingestComplaints(batch, { knownWardIds: [40, 41], strict: true })
    ).rejects.toThrow(PipelineValidationError);
  });

  it("25. Case g: Empty or whitespace id and description, huge description, non-string id", async () => {
    const { wardResolver } = setupTestEnvironment();

    // Empty / whitespace ID
    await expect(
      resolveAndValidateComplaintEvent(
        { id: "", content: "Valid", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    await expect(
      resolveAndValidateComplaintEvent(
        { id: "   ", content: "Valid", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    // Non-string ID
    await expect(
      resolveAndValidateComplaintEvent(
        { id: 12345 as unknown as string, content: "Valid", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    // Empty / whitespace content
    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-g1", content: "", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-g2", content: "   ", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    // Huge description accepted
    const hugeContent = "A".repeat(20_000);
    const validHuge = await resolveAndValidateComplaintEvent(
      { id: "c-huge", content: hugeContent, timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
      wardResolver
    );
    expect(validHuge.content.length).toBe(20_000);
  });

  it("26. Case h: Timestamps: 18:29:59Z vs 18:30:00Z, +05:30 offset, no-timezone string, epoch ms, future timestamp, invalid string, Dec 31 18:30Z to Jan 1", async () => {
    const { wardResolver } = setupTestEnvironment();

    // 18:29:59Z -> 2026-10-06
    const t1 = await resolveAndValidateComplaintEvent(
      { id: "c-h1", content: "T1", timestamp: "2026-10-06T18:29:59.999Z", wardId: 40 },
      wardResolver
    );
    expect(t1.date).toBe("2026-10-06");

    // 18:30:00Z -> 2026-10-07
    const t2 = await resolveAndValidateComplaintEvent(
      { id: "c-h2", content: "T2", timestamp: "2026-10-06T18:30:00.000Z", wardId: 40 },
      wardResolver
    );
    expect(t2.date).toBe("2026-10-07");

    // +05:30 offset
    const t3 = await resolveAndValidateComplaintEvent(
      { id: "c-h3", content: "T3", timestamp: "2026-10-06T20:30:00+05:30", wardId: 40 },
      wardResolver
    );
    expect(t3.date).toBe("2026-10-06");

    // no-timezone string (must be rejected)
    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-h4", content: "T4", timestamp: "2026-10-06T14:30:00", wardId: 40 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    // epoch ms
    const t5 = await resolveAndValidateComplaintEvent(
      { id: "c-h5", content: "T5", timestamp: Date.parse("2026-10-06T18:30:00Z"), wardId: 40 },
      wardResolver
    );
    expect(t5.date).toBe("2026-10-07");

    // future timestamp
    const t6 = await resolveAndValidateComplaintEvent(
      { id: "c-h6", content: "T6", timestamp: "2028-10-06T10:00:00Z", wardId: 40 },
      wardResolver
    );
    expect(t6.date).toBe("2028-10-06");

    // invalid string
    await expect(
      resolveAndValidateComplaintEvent(
        { id: "c-h7", content: "T7", timestamp: "not-a-valid-date", wardId: 40 },
        wardResolver
      )
    ).rejects.toThrow(PipelineValidationError);

    // Dec 31 18:30Z -> Jan 1
    const t8 = await resolveAndValidateComplaintEvent(
      { id: "c-h8", content: "T8", timestamp: "2026-12-31T18:30:00Z", wardId: 40 },
      wardResolver
    );
    expect(t8.date).toBe("2027-01-01");
  });

  it("27. Case i: A late event re-emits earlier date's FULL count and leaves other dates unchanged", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    // Initial batch covering Oct 5 (2 complaints) and Oct 6 (3 complaints)
    await adapter.ingestComplaints([
      { id: "c-oct5-1", content: "Oct 5 Issue 1", timestamp: "2026-10-05T10:00:00Z", wardId: 40 },
      { id: "c-oct5-2", content: "Oct 5 Issue 2", timestamp: "2026-10-05T11:00:00Z", wardId: 40 },
      { id: "c-oct6-1", content: "Oct 6 Issue 1", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
      { id: "c-oct6-2", content: "Oct 6 Issue 2", timestamp: "2026-10-06T11:00:00Z", wardId: 40 },
      { id: "c-oct6-3", content: "Oct 6 Issue 3", timestamp: "2026-10-06T12:00:00Z", wardId: 40 },
    ]);

    expect(signalStore.get(40, "complaint", "2026-10-05", "user")?.count).toBe(2);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(3);

    // Late arriving event for Oct 5
    await adapter.ingestComplaints([
      { id: "c-oct5-late", content: "Oct 5 Late Issue", timestamp: "2026-10-05T14:00:00Z", wardId: 40 },
    ]);

    // Oct 5 count is updated to 3 (full cumulative count)
    expect(signalStore.get(40, "complaint", "2026-10-05", "user")?.count).toBe(3);
    // Oct 6 count remains unchanged at 3
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(3);
  });

  it("28. Case j: Mixed valid and invalid batch: valid counted, invalid in errors and not in store, strict throws", async () => {
    const { signalStore, eventStore, adapter } = setupTestEnvironment();

    const mixedBatch = [
      { id: "c-valid-1", content: "Valid issue", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
      { id: "c-invalid-1", content: "Invalid ward", timestamp: "2026-10-06T10:00:00Z", wardId: -5 },
    ];

    // Non-strict mode
    const res = await adapter.ingestComplaints(mixedBatch);
    expect(res.processedCount).toBe(1);
    expect(res.errorCount).toBe(1);
    expect(res.errors[0].index).toBe(1);

    // Valid recorded in eventStore, invalid NOT recorded
    expect(eventStore.has("c-valid-1")).toBe(true);
    expect(eventStore.has("c-invalid-1")).toBe(false);
    expect(eventStore.size).toBe(1);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);

    // Strict mode
    await expect(adapter.ingestComplaints(mixedBatch, { strict: true })).rejects.toThrow(
      PipelineValidationError
    );
  });

  it("29. Case k: Several wards and dates in one batch give exactly one row per (ward, date) with right counts", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    const multiBatch = [
      { id: "c-40-d5-1", content: "W40 D5-1", timestamp: "2026-10-05T10:00:00Z", wardId: 40 },
      { id: "c-40-d5-2", content: "W40 D5-2", timestamp: "2026-10-05T11:00:00Z", wardId: 40 },
      { id: "c-40-d6-1", content: "W40 D6-1", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
      { id: "c-41-d5-1", content: "W41 D5-1", timestamp: "2026-10-05T10:00:00Z", wardId: 41 },
      { id: "c-41-d5-2", content: "W41 D5-2", timestamp: "2026-10-05T11:00:00Z", wardId: 41 },
      { id: "c-41-d5-3", content: "W41 D5-3", timestamp: "2026-10-05T12:00:00Z", wardId: 41 },
      { id: "c-41-d6-1", content: "W41 D6-1", timestamp: "2026-10-06T10:00:00Z", wardId: 41 },
      { id: "c-41-d6-2", content: "W41 D6-2", timestamp: "2026-10-06T11:00:00Z", wardId: 41 },
    ];

    const result = await adapter.ingestComplaints(multiBatch);
    expect(result.processedCount).toBe(8);
    expect(result.ingestResult.writtenCount).toBe(4);
    expect(signalStore.size).toBe(4);

    expect(signalStore.get(40, "complaint", "2026-10-05", "user")?.count).toBe(2);
    expect(signalStore.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);
    expect(signalStore.get(41, "complaint", "2026-10-05", "user")?.count).toBe(3);
    expect(signalStore.get(41, "complaint", "2026-10-06", "user")?.count).toBe(2);
  });

  it("30. Case l: Every emitted row has signalType 'complaint', sourceTag 'user', positive integer count, and valid IST date", async () => {
    const { signalStore, adapter } = setupTestEnvironment();

    await adapter.ingestComplaints([
      { id: "c-canon-1", content: "Contract check 1", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
      { id: "c-canon-2", content: "Contract check 2", timestamp: "2026-10-06T11:00:00Z", wardId: 40 },
    ]);

    const rows = signalStore.getAll();
    expect(rows).toHaveLength(1);
    const [row] = rows;

    expect(row.signalType).toBe("complaint");
    expect(row.sourceTag).toBe("user");
    expect(row.count).toBe(2);
    expect(Number.isInteger(row.count)).toBe(true);
    expect(row.count).toBeGreaterThan(0);
    expect(row.date).toBe("2026-10-06");
  });
});


