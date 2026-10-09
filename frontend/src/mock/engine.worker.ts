/// <reference lib="webworker" />
/* Runs the mock backend (detection-module code) off the main thread, so the UI never freezes. */
import type { CityFile } from "@engine/city.js";
import city from "./data/city.json";
import rain from "./data/rain.json";
import { MockBackend, MockError } from "./backend";

let backend: MockBackend | null = null;
const get = () => (backend ??= new MockBackend({ city: city as unknown as CityFile, rain }));

self.onmessage = (event: MessageEvent<{ id: number; method: string; args: unknown[] }>) => {
  const { id, method, args } = event.data;
  try {
    const target = get() as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (typeof target[method] !== "function") throw new MockError(500, `Unknown mock method ${method}`);
    self.postMessage({ id, ok: true, value: target[method](...args) });
  } catch (error) {
    const status = error instanceof MockError ? error.status : 500;
    self.postMessage({ id, ok: false, status, message: error instanceof Error ? error.message : String(error) });
  }
};
