export {
  IST_OFFSET_MS,
  YYYY_MM_DD_REGEX,
  isValidDateString,
  toIstDateString,
} from "./date.js";
export type { LiveSignalRow, ReportedSignalRow, SignalRow } from "@outbreak/contract";

export { LiveDayGeneratorError, PipelineValidationError, RainFetchError } from "./errors.js";

export {
  LiveDayAdapter,
  type LiveDayGeneratorOptions,
  type LiveDayIngestOptions,
  type RowsArrivingOn,
} from "./adapters/live-day-adapter.js";


export {
  DailyWardCountAdapter,
  type DailyWardCountAdapterOptions,
} from "./adapters/daily-ward-count-adapter.js";

export {
  parseDailyWardCountPayload,
  parseDailyWardCountRecord,
  type DailyWardCountParseOptions,
  type DailyWardCountParserConfig,
  type RawDailyWardCountRecord,
} from "./adapters/daily-ward-count-parser.js";

export {
  RainAdapter,
  type RainAdapterOptions,
  type RainFetcher,
  type RainIngestResult,
} from "./adapters/rain-adapter.js";

export { runRainJob, type RainJobOptions, type RainJobResult } from "./jobs/rain-job.js";
export { runFeedJob, type FeedJobOptions, type FeedJobResult } from "./jobs/feed-job.js";

export {
  InMemoryRawArchive,
  rawArchiveKey,
  saveRawCopy,
  type RawArchive,
  type RawSource,
} from "./raw-archive.js";

export {
  BENGALURU_LATITUDE,
  BENGALURU_LONGITUDE,
  BENGALURU_TIMEZONE,
  OPEN_METEO_BASE_URL,
  buildOpenMeteoUrl,
  fetchOpenMeteoRain,
  validatePastDays,
  type FetchRainOptions,
} from "./adapters/rain-fetcher.js";

export {
  HospitalAdapter,
  type HospitalAdapterOptions,
} from "./adapters/hospital-adapter.js";

export {
  parseHospitalDailyRecord,
  parseHospitalPayload,
  type RawHospitalDailyRecord,
} from "./adapters/hospital-parser.js";

export {
  PharmacyAdapter,
  type PharmacyAdapterOptions,
} from "./adapters/pharmacy-adapter.js";

export {
  parsePharmacyDailyRecord,
  parsePharmacyPayload,
  type RawPharmacyDailyRecord,
} from "./adapters/pharmacy-parser.js";

export {
  ComplaintAdapter,
  type ComplaintAdapterOptions,
  type ProcessComplaintsResult,
} from "./adapters/complaint-adapter.js";

export {
  resolveAndValidateComplaintEvent,
  type RawComplaintEvent,
  type ValidatedComplaintEvent,
} from "./adapters/complaint-parser.js";

export {
  DatabaseComplaintEventStore,
  InMemoryComplaintEventStore,
  type ComplaintEventStore,
  type ComplaintEventTable,
} from "./adapters/complaint-store.js";

export {
  InMemoryWardResolver,
  type GeoLocation,
  type WardResolver,
} from "./adapters/ward-resolver.js";

export {
  createRainSignalRows,
  parseOpenMeteoRainResponse,
  type DailyRainReading,
  type ParseRainResult,
} from "./adapters/rain-parser.js";

export {
  createSignalRow,
  normalizeSignalRow,
  type CreateSignalRowInput,
  type RawSignalInput,
} from "./normalize.js";

export {
  SignalIngestionEngine,
  processRawSignals,
  type IngestItemError,
  type IngestOptions,
  type IngestResult,
} from "./engine.js";

export { PostgresSignalSink, type SignalWriter } from "./postgres-sink.js";

export {
  InMemorySignalStore,
  getSignalRowKey,
  type SignalSink,
  type SignalStore,
} from "./sink.js";

export {
  validateCount,
  validateDateString,
  validateReportedOn,
  validateSignalRow,
  validateSignalType,
  validateSourceTag,
  validateWardId,
} from "./validation.js";
