import type { CityModel } from "../city.js";
import { addDays, daysBetween } from "../dates.js";
import { ALERT_MATCH_GRACE_DAYS } from "../params.js";
import type { OutbreakAnswer } from "../simulator.js";

/*
 * Chance check: how often would the matching rule "detect" an outbreak that is
 * NOT there? Each test-year LOCAL outbreak gets a PHANTOM: the same wards, cause
 * and length, moved in time (in steps of CHANCE_SHIFT_STEP_DAYS, nearest first)
 * to a window where no real outbreak, including the seasonal wave, touches any of
 * its match wards (affected wards and their neighbours). Scoring the locked
 * alerts against phantoms with the unchanged matching rule gives the chance level.
 * The seasonal wave gets no phantom: it touches every ward, so it cannot be moved
 * to a place where nothing happens ("not computed").
 */

/** Team design choice: try moving each phantom by multiples of 2 weeks. */
export const CHANCE_SHIFT_STEP_DAYS = 14;
/** Give up on a phantom after this many tries (both directions). */
const MAX_TRIES = 60;

function matchWards(o: OutbreakAnswer, city: CityModel): Set<number> {
  const wards = new Set<number>();
  for (const { wardId } of o.affectedWards) {
    wards.add(wardId);
    for (const n of city.getNeighbours(wardId)) wards.add(n);
  }
  return wards;
}

/** Phantoms for the local outbreaks in `outbreaks`, placed inside first..last (inclusive). */
export function phantoms(outbreaks: readonly OutbreakAnswer[], city: CityModel, first: string, last: string): OutbreakAnswer[] {
  const real = outbreaks.map((o) => ({ o, wards: matchWards(o, city), from: o.startDate, to: addDays(o.endDate, ALERT_MATCH_GRACE_DAYS) }));
  const out: OutbreakAnswer[] = [];
  for (const o of outbreaks.filter((x) => x.cause !== "seasonal")) {
    const wards = matchWards(o, city);
    const length = daysBetween(o.startDate, o.endDate);
    for (let step = 1; step < MAX_TRIES; step++) {
      const shift = (step % 2 === 1 ? 1 : -1) * Math.ceil(step / 2) * CHANCE_SHIFT_STEP_DAYS;
      const start = addDays(o.startDate, shift);
      const end = addDays(start, length);
      const to = addDays(end, ALERT_MATCH_GRACE_DAYS);
      if (start < first || to > last) continue;
      const clashes = real.some((r) => r.from <= to && r.to >= start && (r.o.cause === "seasonal" || [...wards].some((w) => r.wards.has(w))));
      if (clashes) continue;
      out.push({ ...o, id: `${o.id}-phantom`, startDate: start, peakDate: start, endDate: end });
      break;
    }
  }
  return out;
}
