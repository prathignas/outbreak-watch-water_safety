import type { CityModel } from "../city.js";
import { daysBetween } from "../dates.js";

/** Day numbers are cached: merging compares thousands of dates and the string maths is slow. */
const dayNumberCache = new Map<string, number>();
function dayNumber(date: string): number {
  let value = dayNumberCache.get(date);
  if (value === undefined) {
    value = daysBetween("2000-01-01", date);
    dayNumberCache.set(date, value);
  }
  return value;
}

/*
 * Episodes: the backtest counts alarms the way an officer feels them. A run of
 * alerts in one ward, or spreading into the wards next door, a few days apart,
 * is ONE episode, not one per day. Rule: docs/STATUS.md, "Episodes".
 */

/** One alert reduced to what episode merging needs. */
export interface AlertDay {
  wardId: number;
  date: string;
}

export interface Episode {
  /** First alert day. */
  startDate: string;
  /** Last alert day. */
  endDate: string;
  /** Wards that alerted on the first day (used for matching). */
  startWards: number[];
  /** Every ward that alerted in the episode. */
  wards: number[];
  /** How many ward-day alerts were merged into it. */
  alertCount: number;
}

/**
 * Groups alert-days into episodes. An alert joins an episode if that episode has
 * an alert in the same ward or an adjacent ward at most `gapDays` days earlier.
 * If an alert links two episodes, they become one (merging is transitive).
 * Each group is in date order.
 */
export function groupEpisodes(alerts: readonly AlertDay[], city: CityModel, gapDays: number): AlertDay[][] {
  const sorted = [...alerts].sort((a, b) => a.date.localeCompare(b.date) || a.wardId - b.wardId);

  // Union-find over alert positions in `sorted`.
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  };

  /** The latest alert seen so far in each ward. */
  const lastInWard = new Map<number, { day: number; index: number }>();
  const neighbours = new Map<number, number[]>();
  sorted.forEach((alert, index) => {
    const day = dayNumber(alert.date);
    let near = neighbours.get(alert.wardId);
    if (!near) {
      near = [alert.wardId, ...city.getNeighbours(alert.wardId)];
      neighbours.set(alert.wardId, near);
    }
    for (const ward of near) {
      const last = lastInWard.get(ward);
      if (last && day - last.day <= gapDays) union(index, last.index);
    }
    lastInWard.set(alert.wardId, { day, index });
  });

  const groups = new Map<number, AlertDay[]>();
  sorted.forEach((alert, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(alert);
    else groups.set(root, [alert]);
  });
  return [...groups.values()];
}

/** Summarises one group of alert-days. */
export function toEpisode(group: readonly AlertDay[]): Episode {
  const startDate = group[0].date;
  return {
    startDate,
    endDate: group.at(-1)!.date,
    startWards: [...new Set(group.filter((a) => a.date === startDate).map((a) => a.wardId))].sort((a, b) => a - b),
    wards: [...new Set(group.map((a) => a.wardId))].sort((a, b) => a - b),
    alertCount: group.length,
  };
}

/** Merges alert-days into episodes (see groupEpisodes), sorted by start. */
export function mergeEpisodes(alerts: readonly AlertDay[], city: CityModel, gapDays: number): Episode[] {
  return groupEpisodes(alerts, city, gapDays)
    .map(toEpisode)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.startWards[0] - b.startWards[0]);
}
