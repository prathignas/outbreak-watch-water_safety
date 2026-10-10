/* All data fetching (TanStack Query). Live data polls every 10 seconds; no websockets. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, config } from "@/api/client";
import type { InjectableCause } from "@/api/types";
import type { CityFile } from "@/lib/city";
import { addDays } from "@/lib/format";

export const POLL_MS = 10_000;

export const keys = {
  demo: ["demo"] as const,
  alerts: ["alerts"] as const,
  alert: (id: string) => ["alerts", id] as const,
  risk: (date: string) => ["risk", date] as const,
  rain: (from: string, to: string) => ["rain", from, to] as const,
  signals: (wardId: number, from: string, to: string) => ["signals", wardId, from, to] as const,
  backtest: ["backtest"] as const,
  city: ["city"] as const,
};

export const useDemoState = () => useQuery({ queryKey: keys.demo, queryFn: api.getDemoState, refetchInterval: POLL_MS });
export const useToday = () => useDemoState().data?.today;

export const useAlerts = () => useQuery({ queryKey: keys.alerts, queryFn: api.listAlerts, refetchInterval: POLL_MS });
export const useAlert = (id: string | undefined) =>
  useQuery({ queryKey: keys.alert(id ?? ""), queryFn: () => api.getAlert(id!), enabled: !!id, refetchInterval: POLL_MS });

export function useRisk() {
  const today = useToday();
  return useQuery({ queryKey: keys.risk(today ?? ""), queryFn: () => api.getRisk(today!), enabled: !!today, refetchInterval: POLL_MS });
}

export function useRain(days = 14) {
  const today = useToday();
  const from = today ? addDays(today, -(days - 1)) : "";
  return useQuery({ queryKey: keys.rain(from, today ?? ""), queryFn: () => api.getRain(from, today!), enabled: !!today });
}

/** Rows for the 8-week charts plus 8 more weeks so "normal for this weekday" can be computed. */
export function useWardSignals(wardId: number | undefined, to: string | undefined) {
  const from = to ? addDays(to, -(56 + 55)) : "";
  return useQuery({
    queryKey: keys.signals(wardId ?? 0, from, to ?? ""),
    queryFn: () => api.getWardSignals(wardId!, from, to!),
    enabled: wardId !== undefined && !!to,
    refetchInterval: POLL_MS,
  });
}

export const useBacktest = () => useQuery({ queryKey: keys.backtest, queryFn: api.getBacktest, staleTime: Infinity });

/** The city model is a static file next to the app (handoff/city.json). */
export const useCity = () =>
  useQuery({
    queryKey: keys.city,
    staleTime: Infinity,
    queryFn: async (): Promise<CityFile> => {
      const res = await fetch(`${import.meta.env.BASE_URL}city.json`);
      if (!res.ok) throw new Error("Could not load the city map data.");
      return (await res.json()) as CityFile;
    },
  });

function useInvalidateLive() {
  const qc = useQueryClient();
  return () => Promise.all(["alerts", "risk", "demo", "signals", "rain"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useAlertAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: "ack" | "resolve" } | { id: string; action: "note"; text: string }) => {
      if (v.action === "note") return api.addNote(v.id, v.text);
      return v.action === "ack" ? api.ackAlert(v.id) : api.resolveAlert(v.id);
    },
    onSuccess: (record) => {
      qc.setQueryData(keys.alert(record.id), record);
      void qc.invalidateQueries({ queryKey: keys.alerts });
    },
  });
}

export function useDemoActions() {
  const invalidate = useInvalidateLive();
  const inject = useMutation({
    mutationFn: (v: { cause: InjectableCause; wardId: number; daysAgo?: number }) => api.injectOutbreak(v.cause, v.wardId, v.daysAgo),
    onSuccess: async (res) => {
      await invalidate();
      // Alerts appear after the mock's short delay; fetch again then (polling would also catch it).
      setTimeout(() => void invalidate(), res.appearsAfterMs + 200);
    },
  });
  const reset = useMutation({ mutationFn: api.resetDemo, onSuccess: () => invalidate() });
  const advance = useMutation({ mutationFn: api.advanceDay, onSuccess: () => invalidate() });
  return { inject, reset, advance, canAdvance: config.mode === "mock" };
}
