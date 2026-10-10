/* MSW handlers: every backend route, answered from the in-memory mock engine. */
import { http, HttpResponse, delay, type HttpHandler } from "msw";
import backtest from "./data/backtest.json";
import { MockError } from "./backend";
import type { Engine } from "./engineClient";

/** The demo key the mock accepts. Real mode checks it on the server. */
export const MOCK_DEMO_KEY = import.meta.env.VITE_DEMO_KEY ?? "watch-demo";

const fail = (error: unknown) => {
  const status = error instanceof MockError ? error.status : 500;
  return HttpResponse.json({ message: error instanceof Error ? error.message : "Mock error" }, { status });
};

function guarded(request: Request): Response | null {
  if (request.headers.get("X-Demo-Auth") !== MOCK_DEMO_KEY) {
    return HttpResponse.json({ message: "The demo key is missing or wrong." }, { status: 401 });
  }
  return null;
}
const officer = (request: Request) => request.headers.get("X-Officer-Name") ?? "";
const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function makeHandlers(engine: Engine, latencyMs = 120): HttpHandler[] {
  const run = async <T>(fn: () => Promise<T>) => {
    await delay(latencyMs);
    try {
      return HttpResponse.json(await fn() as object);
    } catch (error) {
      return fail(error);
    }
  };
  return [
    http.get("/alerts", () => run(() => engine.call("listAlerts"))),
    http.get("/alerts/:id", ({ params }) => run(() => engine.call("getAlert", String(params.id)))),
    http.post("/alerts/:id/ack", ({ request, params }) => run(() => engine.call("ack", String(params.id), officer(request)))),
    http.post("/alerts/:id/resolve", ({ request, params }) => run(() => engine.call("resolve", String(params.id), officer(request)))),
    http.post("/alerts/:id/notes", async ({ request, params }) => {
      const body = (await request.json().catch(() => ({}))) as { text?: unknown };
      return run(() => engine.call("addNote", String(params.id), officer(request), typeof body.text === "string" ? body.text : ""));
    }),
    http.get("/wards/:id/signals", ({ request, params }) => {
      const url = new URL(request.url);
      const from = isoDate(url.searchParams.get("from")), to = isoDate(url.searchParams.get("to"));
      if (!from || !to) return HttpResponse.json({ message: "from and to must be YYYY-MM-DD" }, { status: 400 });
      return run(() => engine.call("wardSignals", Number(params.id), from, to));
    }),
    http.get("/risk", ({ request }) => {
      const date = isoDate(new URL(request.url).searchParams.get("date"));
      if (!date) return HttpResponse.json({ message: "date must be YYYY-MM-DD" }, { status: 400 });
      return run(() => engine.call("risk", date));
    }),
    http.get("/rain", ({ request }) => {
      const url = new URL(request.url);
      const from = isoDate(url.searchParams.get("from")), to = isoDate(url.searchParams.get("to"));
      if (!from || !to) return HttpResponse.json({ message: "from and to must be YYYY-MM-DD" }, { status: 400 });
      return run(() => engine.call("rain", from, to));
    }),
    http.get("/backtest", async () => {
      await delay(latencyMs);
      return HttpResponse.json(backtest);
    }),
    http.get("/demo/state", () => run(() => engine.call("state"))),
    // Mock mode only: the real form posts to the backend. Nothing is saved or counted here.
    http.post("/complaints", async ({ request }) => {
      const body = (await request.json()) as { wardId?: number };
      return HttpResponse.json(
        { success: true, duplicate: false, message: "Mock mode: not saved", signal: { wardId: body.wardId ?? 0, signalType: "complaint", date: "", count: 0, sourceTag: "user", reportedOn: "" } },
        { status: 201 },
      );
    }),
    http.post("/demo/inject", async ({ request }) => {
      const denied = guarded(request);
      if (denied) return denied;
      const body = (await request.json().catch(() => ({}))) as { cause?: unknown; wardId?: unknown; daysAgo?: unknown };
      const daysAgo = typeof body.daysAgo === "number" ? body.daysAgo : undefined;
      return run(() => engine.call("inject", body.cause as "water", Number(body.wardId), daysAgo));
    }),
    http.post("/demo/reset", ({ request }) => guarded(request) ?? run(() => engine.call("reset"))),
    http.post("/demo/advance", ({ request }) => guarded(request) ?? run(() => engine.call("advance"))),
  ];
}
