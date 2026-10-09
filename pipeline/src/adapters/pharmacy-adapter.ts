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
 * Options for Pharmacy adapter ingestion.
 */
export interface PharmacyAdapterOptions extends DailyWardCountAdapterOptions {}

const PHARMACY_SIGNAL_TYPE = SIGNAL_TYPES.find((t) => t === "pharmacy") ?? "pharmacy";
const SYNTHETIC_SOURCE_TAG = SOURCE_TAGS.find((t) => t === "synthetic") ?? "synthetic";

/**
 * Adapter that ingests pre-aggregated daily pharmacy records, validates and normalizes them into
 * canonical SignalRows (signalType: "pharmacy", sourceTag: "synthetic"), and passes them to the SignalIngestionEngine.
 */
export class PharmacyAdapter extends DailyWardCountAdapter {
  constructor(engine: SignalIngestionEngine) {
    super(engine, {
      signalType: PHARMACY_SIGNAL_TYPE,
      defaultSourceTag: SYNTHETIC_SOURCE_TAG,
      sourceName: "Pharmacy",
    });
  }

  /**
   * Ingests one or more daily pharmacy records into the downstream storage sink.
   */
  async ingestPharmacyData(
    rawPayload: unknown,
    options: PharmacyAdapterOptions = {}
  ): Promise<IngestResult> {
    return this.ingestData(rawPayload, options);
  }
}
