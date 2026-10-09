import {
  SIGNAL_TYPES,
  SOURCE_TAGS,
} from "@outbreak/contract";
import { type IngestResult, type SignalIngestionEngine } from "../engine.js";
import {
  DailyWardCountAdapter,
  type DailyWardCountAdapterOptions,
} from "./daily-ward-count-adapter.js";

/**
 * Options for Hospital adapter ingestion.
 */
export interface HospitalAdapterOptions extends DailyWardCountAdapterOptions {}

const HOSPITAL_SIGNAL_TYPE = SIGNAL_TYPES.find((t) => t === "hospital") ?? "hospital";
const SYNTHETIC_SOURCE_TAG = SOURCE_TAGS.find((t) => t === "synthetic") ?? "synthetic";

/**
 * Adapter that ingests pre-aggregated daily hospital records, validates and normalizes them into
 * canonical SignalRows (signalType: "hospital", sourceTag: "synthetic"), and passes them to the SignalIngestionEngine.
 */
export class HospitalAdapter extends DailyWardCountAdapter {
  constructor(engine: SignalIngestionEngine) {
    super(engine, {
      signalType: HOSPITAL_SIGNAL_TYPE,
      defaultSourceTag: SYNTHETIC_SOURCE_TAG,
      sourceName: "Hospital",
    });
  }

  /**
   * Ingests one or more daily hospital records into the downstream storage sink.
   */
  async ingestHospitalData(
    rawPayload: unknown,
    options: HospitalAdapterOptions = {}
  ): Promise<IngestResult> {
    return this.ingestData(rawPayload, options);
  }
}
