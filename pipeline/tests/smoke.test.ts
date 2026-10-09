import { SIGNAL_TYPES } from "@outbreak/contract";
import { describe, expect, it } from "vitest";
import { toIstDateString, validateSignalType } from "../src/index.js";

describe("pipeline", () => {
  it("can import the shared contract", () => {
    expect(SIGNAL_TYPES).toContain("rain");
  });

  it("can export and execute pipeline foundation utilities", () => {
    expect(validateSignalType("rain")).toBe("rain");
    expect(toIstDateString("2026-10-06")).toBe("2026-10-06");
  });
});

