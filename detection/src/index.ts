/*
 * Entry point for the @outbreak/detection package. Exports only: no logic lives here.
 * The backend (P3) and the pipeline (P2) import from this file.
 */
export * from "./types.js";

export { RealCity, GridCity, DEFAULT_CITY_PATH, type CityModel, type CityFile, type CityFileWard } from "./city.js";
/** Where P1's real rain came from (Open-Meteo archive API, point, timezone). P2's live rain job uses the same. */
export { RAIN_SOURCE } from "./params.js";
