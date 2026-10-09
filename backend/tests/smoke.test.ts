import { SIGNAL_TYPES } from "@outbreak/contract";
import { describe, expect, it } from "vitest";

describe("backend", () => {
  it("can import the shared contract", () => {
    expect(SIGNAL_TYPES).toContain("rain");
  });
});
