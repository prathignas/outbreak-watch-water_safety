/*
 * Entry point for the @outbreak/detection package. Exports only: no logic lives here.
 * The backend (P3) and the pipeline (P2) import from this file.
 */
export * from "./types.js";

export { RealCity, GridCity, DEFAULT_CITY_PATH, type CityModel, type CityFile, type CityFileWard } from "./city.js";
export { addDays, daysBetween, dateRange } from "./dates.js";
export { SignalIndex, SignalView, viewAsOf, LeakageError, type IndexedRow, type SignalInput } from "./scoring.js";

export {
  runDetector,
  wardRisk,
  emptyDetectorState,
  RUN_DETECTOR_PARAMS,
  type RunDetectorParams,
  type RunDetectorResult,
  type DetectorState,
  type WardRisk,
} from "./runDetector.js";
export type { CusumState } from "./detectors/cusum.js";

export {
  generateLiveDay,
  generateHistory,
  rowsArrivingOn,
  describeInjection,
  type LiveSignalRow,
  type LiveOptions,
  type Injection,
} from "./live.js";
export type { OutbreakCause } from "./simulator.js";
export { LIVE, RUN_DETECTOR } from "./params.live.js";
/** Where P1's real rain came from (Open-Meteo archive API, point, timezone). P2's live rain job uses the same. */
export { RAIN_SOURCE } from "./params.js";

export type { BacktestResult, SummaryRow, FalseAlarmRow, FusionFlag, ChanceRow, Spread } from "./backtest/run.js";
