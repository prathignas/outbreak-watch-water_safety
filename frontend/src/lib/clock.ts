/* The ONE clock for the app. Every "now" and every "today" comes from here, always in India time
 * (Asia/Kolkata), never the machine's own timezone. Pages must not call new Date() or Date.now(). */

export const IST = "Asia/Kolkata";

/** Milliseconds since the epoch (the browser clock; Playwright's clock in tests). */
export const nowMs = (): number => Date.now();

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" });

/** The IST calendar day (YYYY-MM-DD) at the given instant. */
export const istDay = (ms: number = nowMs()): string => dayFormat.format(ms);

/** Whole seconds since `ms`, never negative. */
export const secondsSince = (ms: number): number => Math.max(0, Math.round((nowMs() - ms) / 1000));

/** An ISO timestamp for the given instant (UTC "Z" form, shown in IST by fmtTime). */
export const isoAt = (ms: number = nowMs()): string => new Date(ms).toISOString();
