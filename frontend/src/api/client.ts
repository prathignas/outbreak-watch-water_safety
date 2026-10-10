/*
 * The ONE place the app talks to a backend. VITE_API_MODE=mock|real chooses the source:
 * in mock mode MSW answers these same routes in the browser; in real mode they go to
 * VITE_API_BASE_URL. Every function is typed with the contract (v1 + v2 proposals).
 */
import type {
  AlertRecord,
  BacktestResult,
  DemoState,
  InjectableCause,
  InjectResponse,
  LiveSignalRow,
  RainRow,
  WardRisk,
} from "./types";
import { istDay } from "@/lib/clock";
import { getSession, setDemoKey } from "./session";

export type ApiMode = "mock" | "real";

export const config = {
  mode: (import.meta.env.VITE_API_MODE === "real" ? "real" : "mock") as ApiMode,
  baseUrl: (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, ""),
  timeoutMs: 15_000,
  /** Reset and Inject re-run the detector day by day (~20 s on AWS); API Gateway stops at 29 s. */
  demoTimeoutMs: 30_000,
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** In mock mode requests go to the same origin, where MSW answers them. */
export function urlFor(path: string): string {
  return config.mode === "real" ? `${config.baseUrl}${path}` : `${globalThis.location?.origin ?? ""}${path}`;
}

/** The one place the demo key and officer name are attached. The demo key goes only on demo
 * routes (Reset, Inject; mock-only advance): never on reads, reports or officer actions. */
export function authHeaders(demoAuth = false): Record<string, string> {
  const session = getSession();
  const headers: Record<string, string> = {};
  if (demoAuth && session.demoKey) headers["X-Demo-Auth"] = session.demoKey;
  if (session.officerName) headers["X-Officer-Name"] = session.officerName;
  return headers;
}

/** True only when the server says the demo key itself was refused (not some other 401). */
async function isKeyRefusal(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { message?: string; error?: string | { code?: string; message?: string } };
    const code = typeof body.error === "string" ? body.error : body.error?.code;
    const text = `${code ?? ""} ${typeof body.error === "object" ? body.error?.message : ""} ${body.message ?? ""}`;
    return /UNAUTHORIZED|demo key/i.test(text);
  } catch {
    return false;
  }
}

export async function request<T>(path: string, init: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown; demoAuth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...authHeaders(init.demoAuth) };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.demoAuth ? config.demoTimeoutMs : config.timeoutMs);
  let response: Response;
  try {
    response = await fetch(urlFor(path), {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch {
    const timedOut = controller.signal.aborted;
    throw new ApiError(0, timedOut ? "The server took too long to answer." : "Could not reach the server.", path);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401) {
    const refused = await isKeyRefusal(response);
    console.warn(`[api] 401 on ${init.method ?? "GET"} ${path}; X-Demo-Auth ${headers["X-Demo-Auth"] ? "sent" : "missing"}${refused ? "; the server refused the demo key" : ""}`);
    if (refused) {
      if (config.mode === "real") setDemoKey(null);
      throw new ApiError(401, headers["X-Demo-Auth"] ? "The server refused the demo key. Enter it again." : "Enter the demo key first.", path);
    }
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // body was not JSON; keep the default message
    }
    throw new ApiError(response.status, message, path);
  }
  return (await response.json()) as T;
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** What the citizen form sends to POST /complaints. complaintId de-duplicates retries. */
export interface ComplaintInput {
  complaintId: string;
  wardId: number;
  description: string;
}
/** POST /complaints answer: the ward's "user" complaint row for today after this report. */
export interface ComplaintResponse {
  success: boolean;
  duplicate: boolean;
  message: string;
  signal: LiveSignalRow;
}

export const api = {
  listAlerts: () => request<AlertRecord[]>("/alerts"),
  getAlert: (id: string) => request<AlertRecord>(`/alerts/${encodeURIComponent(id)}`),
  ackAlert: (id: string) => request<AlertRecord>(`/alerts/${encodeURIComponent(id)}/ack`, { method: "POST" }),
  resolveAlert: (id: string) => request<AlertRecord>(`/alerts/${encodeURIComponent(id)}/resolve`, { method: "POST" }),
  addNote: (id: string, text: string) => request<AlertRecord>(`/alerts/${encodeURIComponent(id)}/notes`, { method: "POST", body: { text } }),
  getWardSignals: (wardId: number, from: string, to: string) => request<LiveSignalRow[]>(`/wards/${wardId}/signals?${q({ from, to })}`),
  getRisk: (date: string) => request<WardRisk[]>(`/risk?${q({ date })}`),
  getRain: (from: string, to: string) => request<RainRow[]>(`/rain?${q({ from, to })}`),
  getBacktest: () => request<BacktestResult>("/backtest"),
  submitComplaint: (input: ComplaintInput) => request<ComplaintResponse>("/complaints", { method: "POST", body: input }),
  injectOutbreak: (cause: InjectableCause, wardId: number, daysAgo?: number) =>
    request<InjectResponse>("/demo/inject", { method: "POST", demoAuth: true, body: daysAgo === undefined ? { cause, wardId } : { cause, wardId, daysAgo } }),
  resetDemo: () => request<DemoState>("/demo/reset", { method: "POST", demoAuth: true }),
  /** Mock mode only. */
  advanceDay: () => request<DemoState>("/demo/advance", { method: "POST", demoAuth: true }),
  /** Mock mode: the demo clock. Real mode: today in Asia/Kolkata (no server route needed). */
  getDemoState: async (): Promise<DemoState> =>
    config.mode === "mock" ? request<DemoState>("/demo/state") : { today: istDay(), seed: 0, injection: null },
};

