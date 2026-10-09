/// <reference lib="webworker" />
/* Runs the mock backend (detection-module code) off the main thread, so the UI never freezes.
 * The page sends its clock with every call (lib/clock.ts: IST day + epoch ms), so the mock's
 * "today" is the real current day in India and moves forward past midnight while the tab is open. */
import type { CityFile } from "@engine/city.js";
import city from "./data/city.json";
import rain from "./data/rain.json";
import { MockBackend, MockError } from "./backend";

let backend: MockBackend | null = null;
let pageNow = 0;

self.onmessage = (event: MessageEvent<{ id: number; method: string; args: unknown[]; clock: { now: number; today: string } }>) => {
  const { id, method, args, clock } = event.data;
  try {
    pageNow = clock.now;
    backend ??= new MockBackend({ city: city as unknown as CityFile, rain, startDate: clock.today, now: () => pageNow, scenario: true });
    backend.syncTo(clock.today);
    const target = backend as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (typeof target[method] !== "function") throw new MockError(500, `Unknown mock method ${method}`);
    self.postMessage({ id, ok: true, value: target[method](...args) });
  } catch (error) {
    const status = error instanceof MockError ? error.status : 500;
    self.postMessage({ id, ok: false, status, message: error instanceof Error ? error.message : String(error) });
  }
};
