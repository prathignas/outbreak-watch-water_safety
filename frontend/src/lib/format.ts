import type { CauseType, SignalType, SourceTag } from "@/contract/types";
import type { AlertRecord, WardRisk } from "@/api/types";

/** Live Bayes alert line. Same value as RUN_DETECTOR.bayesAlertProbability in the detection
 * module (src/params.live.ts); a test keeps them equal. */
export const ALERT_LINE = 10 ** 0.4 / (1 + 10 ** 0.4);
/** Display only: below this relative risk a ward is "calm". ASSUMPTION - needs source (docs/FRONTEND.md 3.3). */
export const WATCH_LINE = 0.1;

export type WardStatus = "calm" | "watch" | "alert";
export const STATUS_LABEL: Record<WardStatus, string> = { calm: "Calm", watch: "Watch", alert: "Alert" };

export const CAUSES: CauseType[] = ["water", "food", "p2p", "seasonal", "unknown"];
export const CAUSE_LABEL: Record<CauseType, string> = { water: "Water", food: "Food", p2p: "Person to person", seasonal: "Seasonal", unknown: "Unknown" };
export const SIGNAL_LABEL: Record<SignalType, string> = { complaint: "Complaints", pharmacy: "Pharmacy sales", hospital: "Hospital visits", rain: "Rain" };
export const SOURCE_LABEL: Record<SourceTag, string> = { real: "Real", scraped: "Real", user: "User", synthetic: "Simulated" };

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function topCause(p: Record<CauseType, number>): CauseType {
  return CAUSES.reduce((best, c) => (p[c] > p[best] ? c : best));
}

const at = (date: string) => new Date(`${date}T00:00:00Z`);
export const fmtDay = (date: string) => at(date).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
export const fmtLong = (date: string) => at(date).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
export const fmtFull = (date: string) => at(date).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
export const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function addDays(date: string, days: number): string {
  return new Date(at(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Ward status: alert if it has an unresolved alert or is at/above the alert line; watch from 10%. */
export function wardStatuses(risk: WardRisk[] | undefined, alerts: AlertRecord[] | undefined): Map<number, WardStatus> {
  const active = new Set((alerts ?? []).filter((a) => a.status !== "resolved").map((a) => a.alert.wardId));
  const out = new Map<number, WardStatus>();
  for (const r of risk ?? []) {
    out.set(r.wardId, active.has(r.wardId) || r.probability >= ALERT_LINE ? "alert" : r.probability >= WATCH_LINE ? "watch" : "calm");
  }
  for (const id of active) out.set(id, "alert");
  return out;
}
