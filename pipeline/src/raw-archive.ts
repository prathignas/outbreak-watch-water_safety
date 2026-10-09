import { randomUUID } from "node:crypto";

/** The sources whose raw input is kept. */
export type RawSource = "rain" | "feed" | "webhook-pharmacy" | "webhook-hospital";

/**
 * Keeps an untouched copy of what a source sent (the Open-Meteo answer, each feed or webhook
 * batch), filed by India day, so any stored number can be traced back to its input.
 * In AWS this is an S3 bucket (backend/src/rawArchive.ts).
 */
export interface RawArchive {
  /** Saves the body; returns where it went. */
  save(source: RawSource, day: string, body: unknown): Promise<string>;
}

/** raw/<source>/<YYYY-MM-DD>/<ISO time>-<random>.json */
export function rawArchiveKey(source: RawSource, day: string, now: Date = new Date()): string {
  return `raw/${source}/${day}/${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;
}

/** In-memory archive, for tests and local runs. */
export class InMemoryRawArchive implements RawArchive {
  readonly saved = new Map<string, unknown>();

  async save(source: RawSource, day: string, body: unknown): Promise<string> {
    const key = rawArchiveKey(source, day);
    this.saved.set(key, structuredClone(body));
    return key;
  }
}

/** Saves a raw copy, but never lets a failed copy stop the data itself. Returns the key or null. */
export async function saveRawCopy(
  archive: RawArchive | undefined,
  source: RawSource,
  day: string,
  body: unknown,
  log: Pick<Console, "log" | "error"> = console
): Promise<string | null> {
  if (!archive) return null;
  try {
    const key = await archive.save(source, day, body);
    log.log(`[raw] saved ${source} copy for ${day} to ${key}`);
    return key;
  } catch (err) {
    log.error(`[raw] could not save the ${source} copy for ${day}: ${(err as Error)?.message ?? String(err)}`);
    return null;
  }
}
