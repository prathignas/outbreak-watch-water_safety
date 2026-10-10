import { describe, it, expect } from "vitest";
import { loadRealRain, parseOpenMeteoRain } from "../src/realRain.js";

const response = (time: unknown[], rain: unknown[]) => ({ daily: { time, precipitation_sum: rain } });

describe("real rain", () => {
  it("loads every day of 2022-2025 from the downloaded Open-Meteo file", () => {
    const rain = loadRealRain();
    expect(rain).toHaveLength(1461);
    expect(rain[0].date).toBe("2022-01-01");
    expect(rain.at(-1)?.date).toBe("2025-12-31");
    expect(rain.every((day) => day.mm >= 0)).toBe(true);
    expect(rain.some((day) => day.mm > 15.6)).toBe(true); // Bengaluru does get real rain
  });

  it("refuses missing rain instead of inventing it", () => {
    expect(() => parseOpenMeteoRain(response(["2022-01-01", "2022-01-02"], [1, null]))).toThrow(/missing or invalid/);
  });

  it("refuses a gap in the dates", () => {
    expect(() => parseOpenMeteoRain(response(["2022-01-01", "2022-01-03"], [1, 2]))).toThrow(/a day is missing/);
  });

  it("refuses negative rain and a malformed file", () => {
    expect(() => parseOpenMeteoRain(response(["2022-01-01"], [-1]))).toThrow();
    expect(() => parseOpenMeteoRain({ hourly: {} })).toThrow(/not an Open-Meteo/);
    expect(() => loadRealRain("/no/such/file.json")).toThrow(/fetch-rain/);
  });
});
