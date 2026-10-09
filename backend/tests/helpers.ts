import { vi } from "vitest";
import { handleRequest, type HttpRequest } from "../src/api/router.js";
import type { IDatabase } from "../src/db/repository.js";

export const DEMO_KEY = "test-demo-auth-token";
export const officer = (name = "Asha Rao") => ({ "X-Demo-Auth": DEMO_KEY, "X-Officer-Name": name });
export const WEBHOOK_SECRET = "test-webhook-secret";
/** The webhook secret header (default name X-Webhook-Secret). */
export const webhook = () => ({ "X-Webhook-Secret": WEBHOOK_SECRET });

/**
 * Freeze "today in India" at 2026-07-09. A demo inject then starts on 2026-07-05
 * (4 days back; P1's handoff outbreak scenario starts a day later, on 2026-07-06).
 */
export const FROZEN_TODAY = "2026-07-09";
export function freezeClock() {
  process.env.DEMO_AUTH_TOKEN = DEMO_KEY;
  process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.WEBHOOK_SECRET_HEADER;
  process.env.NODE_ENV = "test";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${FROZEN_TODAY}T06:00:00+05:30`));
}

export async function call(db: IDatabase, req: HttpRequest) {
  const res = await handleRequest(req, db);
  return { status: res.statusCode, headers: res.headers ?? {}, body: res.body ? JSON.parse(res.body) : null };
}
