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
import { clearSession, getSession } from "./session";

export type ApiMode = "mock" | "real";

export const config = {
  mode: (import.meta.env.VITE_API_MODE === "real" ? "real" : "mock") as ApiMode,
  baseUrl: (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, ""),
  timeoutMs: 15_000,
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

export async function request<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (session.demoKey) headers["X-Demo-Auth"] = session.demoKey;
  if (session.officerName) headers["X-Officer-Name"] = session.officerName;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (import.meta.env.DEV) console.info(`[api] ${init.method ?? "GET"} ${urlFor(path)} X-Demo-Auth=${headers["X-Demo-Auth"] ?? "(none)"}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
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
  // The demo key was refused: forget it so the gate asks again.
  if (response.status === 401 && session.demoKey) clearSession();
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
  injectOutbreak: (cause: InjectableCause, wardId: number) => request<InjectResponse>("/demo/inject", { method: "POST", body: { cause, wardId } }),
  resetDemo: () => request<DemoState>("/demo/reset", { method: "POST" }),
  /** Mock mode only. */
  advanceDay: () => request<DemoState>("/demo/advance", { method: "POST" }),
  /** Mock mode: the demo clock. Real mode: today in Asia/Kolkata (no server route needed). */
  getDemoState: async (): Promise<DemoState> =>
    config.mode === "mock" ? request<DemoState>("/demo/state") : { today: todayInKolkata(), seed: 0, injection: null },
};

export function todayInKolkata(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
