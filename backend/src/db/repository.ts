import type pg from "pg";
import type { Alert, RainRow, SignalRow } from "@outbreak/contract";
import type { DetectorState, OutbreakCause } from "@outbreak/detection";
import { query, getPool } from "./client.js";
import { randomUUID } from "node:crypto";
import { isPointInMultiPolygon } from "./spatial.js";
import type {
  AlertEventRow,
  AlertStatus,
  DbAlert,
  DetectorAlert,
  PipelineZone,
  SavedDetectorState,
  Ward,
} from "./types.js";

export interface AlertFilter {
  status?: AlertStatus;
  wardId?: number;
  date?: string;
  /** Alerts on or after this day. */
  fromDate?: string;
  limit?: number;
  offset?: number;
}

export interface SignalFilter {
  startDate?: string;
  endDate?: string;
  wardId?: number;
  /** Only rows that had reached us by the end of this day (contract-v2: reported_on <= today). */
  reportedBy?: string;
}

/** A signals row as written: reportedOn defaults to the row's own date (a real-time feed). */
export type SignalWrite = SignalRow & { reportedOn?: string };
/** A signals row as read: always has reportedOn (contract-v2 LiveSignalRow shape, any signal type). */
export type StoredSignal = SignalRow & { reportedOn: string };

export interface SaveDetectorDayInput {
  method: DetectorState["method"];
  /** The day that was run (= state.lastRunDate). */
  asOfDate: string;
  state: DetectorState;
  alerts: DetectorAlert[];
  /** Actor of the "created" events. */
  actor: string;
  /** Delete saved states older than this many days before asOfDate. */
  keepStateDays: number;
}

/** An outbreak planted with POST /demo/inject (table demo_outbreaks). */
export interface DemoOutbreak {
  id: number;
  wardId: number;
  cause: OutbreakCause;
  startDate: string;
  seed: number;
  active: boolean;
}

export interface IDatabase {
  initSchema(): Promise<void>;
  insertWards(wards: Ward[]): Promise<void>;
  insertPipelineZones(zones: PipelineZone[]): Promise<void>;
  getWards(): Promise<Ward[]>;
  getWard(id: number): Promise<Ward | null>;
  getPipelineZones(): Promise<PipelineZone[]>;
  insertSignal(signal: SignalWrite): Promise<void>;
  /** Upserts many rows (same key -> the row is updated: new count and reported_on). Returns how many. */
  insertSignals(signals: SignalWrite[]): Promise<number>;
  getSignals(filter?: SignalFilter): Promise<StoredSignal[]>;
  /** One city-wide real rain value per day (rain rows tagged "real"). */
  getRain(from: string, to: string): Promise<RainRow[]>;
  insertAlert(alert: Alert, causeEvidence?: string[]): Promise<{ alert: DbAlert; isNew: boolean }>;
  getAlerts(filter?: AlertFilter): Promise<DbAlert[]>;
  getAlertById(id: string): Promise<DbAlert | null>;
  updateAlertStatus(id: string, status: AlertStatus): Promise<DbAlert | null>;
  insertAlertEvent(event: Omit<AlertEventRow, "id">): Promise<AlertEventRow>;
  getAlertEvents(alertId: string): Promise<AlertEventRow[]>;
  /** Events for many alerts at once, oldest first, keyed by alert id. */
  getAlertEventsFor(alertIds: string[]): Promise<Map<string, AlertEventRow[]>>;
  getWardContainingPoint(lng: number, lat: number): Promise<Ward | null>;
  findZoneForWard(wardId: number): Promise<PipelineZone | null>;
  /** Records one citizen complaint id (table complaint_events). false = already recorded (a retry). */
  recordComplaintEvent(event: ComplaintEventRow): Promise<boolean>;
  hasComplaintEvent(id: string): Promise<boolean>;
  /** How many distinct complaints a ward has for an India day. */
  countComplaintEvents(wardId: number, date: string): Promise<number>;
  /** Clears alerts, alert events, signals, complaint ids and detector state. Wards and zones stay. */
  resetDemoData(): Promise<void>;
  /** Saves an injected outbreak so the daily feed keeps generating it. */
  insertDemoOutbreak(outbreak: Omit<DemoOutbreak, "id" | "active">): Promise<DemoOutbreak>;
  getActiveDemoOutbreaks(): Promise<DemoOutbreak[]>;
  clearDemoOutbreaks(): Promise<void>;

  /** The newest saved state for this method with as_of_date <= onOrBefore (or the newest at all). */
  getLatestDetectorState(method: DetectorState["method"], onOrBefore?: string): Promise<SavedDetectorState | null>;
  /**
   * ONE transaction: upsert the day's alerts (a re-run updates the detector fields and keeps
   * status and events), add a "created" event for each new alert, save the state, prune old states.
   */
  saveDetectorDay(input: SaveDetectorDayInput): Promise<Array<{ alert: DbAlert; isNew: boolean }>>;
  /** Forget saved states from this day on, so the next run re-runs those days. */
  deleteDetectorStatesFrom(method: DetectorState["method"], fromDate: string): Promise<void>;
  /**
   * Delete alerts dated in [fromDate, toDate] that no officer has touched (still open, no
   * ack, resolve or note) and that are not in `keep` ("wardId|date|method"). Used after a re-run.
   */
  deleteUntouchedAlerts(fromDate: string, toDate: string, keep: Set<string>): Promise<number>;
  /** Runs fn while holding the detector lock, so two runs never overlap. */
  withDetectorLock<T>(fn: () => Promise<T>): Promise<T>;
}

/** One accepted citizen complaint (migration 003). */
export interface ComplaintEventRow {
  id: string;
  wardId: number;
  /** India day it counts for. */
  date: string;
}

export const alertKey = (a: Pick<Alert, "wardId" | "date" | "method">) => `${a.wardId}|${a.date}|${a.method}`;
const OFFICER_EVENTS = ["acknowledged", "resolved", "note_added"];
/** Any fixed number; both Lambdas use it for pg_advisory_lock. */
const DETECTOR_LOCK_ID = 727_2026;
const SIGNAL_BATCH = 2000;

const ALERT_COLUMNS = `id, ward_id, to_char(date, 'YYYY-MM-DD') as date, score, method, contributing_signals,
  cause_probs, suspected_zone_id, evidence, cause_evidence, status, created_at`;

function rowToAlert(r: any): DbAlert {
  return {
    id: r.id,
    wardId: r.ward_id,
    date: r.date,
    score: Number(r.score),
    method: r.method,
    contributingSignals: r.contributing_signals,
    causeProbs: typeof r.cause_probs === "string" ? JSON.parse(r.cause_probs) : r.cause_probs,
    suspectedZoneId: r.suspected_zone_id,
    evidence: r.evidence,
    causeEvidence: r.cause_evidence ?? [],
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

function toDemoOutbreak(r: any): DemoOutbreak {
  return { id: r.id, wardId: r.ward_id, cause: r.cause, startDate: r.start_date, seed: r.seed, active: r.active };
}

function rowToEvent(r: any): AlertEventRow {
  return { id: r.id, alertId: r.alert_id, event: r.event, actor: r.actor, note: r.note, at: r.at.toISOString() };
}

/** Last write wins inside one batch (Postgres refuses to update the same row twice in one statement). */
function dedupeSignals(signals: SignalWrite[]): SignalWrite[] {
  const byKey = new Map<string, SignalWrite>();
  for (const s of signals) byKey.set(`${s.wardId}|${s.signalType}|${s.date}|${s.sourceTag}`, s);
  return [...byKey.values()];
}

/** The CUSUM part of a state, as one row per ward and signal (contract-v2 section 3). */
function cusumRows(state: DetectorState) {
  return Object.entries(state.cusum?.cells ?? {}).map(([key, cell]) => {
    const [wardId, signalType] = key.split(":");
    return { wardId: Number(wardId), signalType, sum: cell.sum, nextDate: cell.nextDate };
  });
}

/**
 * PostgreSQL Implementation of the database repository.
 */
export class PostgresDatabase implements IDatabase {
  async initSchema(): Promise<void> {
    // Schema created via SQL migrations
  }

  async insertWards(wards: Ward[]): Promise<void> {
    for (const w of wards) {
      await query(
        `INSERT INTO wards (id, name, zone_id, geom)
         VALUES ($1, $2, $3, CASE WHEN $4::text IS NULL THEN NULL ELSE ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)) END)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, zone_id = EXCLUDED.zone_id, geom = COALESCE(EXCLUDED.geom, wards.geom)`,
        [w.id, w.name, w.zoneId ?? null, w.geometry ? JSON.stringify(w.geometry) : null]
      );
    }
  }

  async insertPipelineZones(zones: PipelineZone[]): Promise<void> {
    for (const z of zones) {
      await query(
        `INSERT INTO pipeline_zones (id, name, geom)
         VALUES ($1, $2, CASE WHEN $3::text IS NULL THEN NULL ELSE ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)) END)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, geom = COALESCE(EXCLUDED.geom, pipeline_zones.geom)`,
        [z.id, z.name, z.geometry ? JSON.stringify(z.geometry) : null]
      );
    }
  }

  async getWards(): Promise<Ward[]> {
    const res = await query(`SELECT id, name, zone_id FROM wards ORDER BY id ASC`);
    return res.rows.map((r) => ({ id: r.id, name: r.name, zoneId: r.zone_id }));
  }

  async getWard(id: number): Promise<Ward | null> {
    const res = await query(`SELECT id, name, zone_id FROM wards WHERE id = $1`, [id]);
    if (res.rows.length === 0) return null;
    return { id: res.rows[0].id, name: res.rows[0].name, zoneId: res.rows[0].zone_id };
  }

  async getPipelineZones(): Promise<PipelineZone[]> {
    const res = await query(`SELECT id, name FROM pipeline_zones ORDER BY id ASC`);
    return res.rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async insertSignal(signal: SignalWrite): Promise<void> {
    await this.insertSignals([signal]);
  }

  async insertSignals(signals: SignalWrite[]): Promise<number> {
    const rows = dedupeSignals(signals);
    for (let i = 0; i < rows.length; i += SIGNAL_BATCH) {
      const batch = rows.slice(i, i + SIGNAL_BATCH);
      await query(
        `INSERT INTO signals (ward_id, signal_type, date, count, source_tag, reported_on)
         SELECT * FROM unnest($1::int[], $2::text[], $3::date[], $4::numeric[], $5::text[], $6::date[])
         ON CONFLICT (ward_id, signal_type, date, source_tag)
         DO UPDATE SET count = EXCLUDED.count, reported_on = EXCLUDED.reported_on`,
        [
          batch.map((s) => s.wardId),
          batch.map((s) => s.signalType),
          batch.map((s) => s.date),
          batch.map((s) => s.count),
          batch.map((s) => s.sourceTag),
          batch.map((s) => s.reportedOn ?? s.date),
        ]
      );
    }
    return rows.length;
  }

  async getSignals(filter?: SignalFilter): Promise<StoredSignal[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.startDate) {
      params.push(filter.startDate);
      conditions.push(`date >= $${params.length}`);
    }
    if (filter?.endDate) {
      params.push(filter.endDate);
      conditions.push(`date <= $${params.length}`);
    }
    if (filter?.wardId !== undefined) {
      params.push(filter.wardId);
      conditions.push(`ward_id = $${params.length}`);
    }
    if (filter?.reportedBy) {
      params.push(filter.reportedBy);
      conditions.push(`reported_on <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT ward_id, signal_type, to_char(date, 'YYYY-MM-DD') as date, count, source_tag,
                        to_char(reported_on, 'YYYY-MM-DD') as reported_on
                 FROM signals ${whereClause} ORDER BY date ASC, ward_id ASC, signal_type ASC`;

    const res = await query(sql, params);
    return res.rows.map((r) => ({
      wardId: r.ward_id,
      signalType: r.signal_type,
      date: r.date,
      count: parseFloat(r.count),
      sourceTag: r.source_tag,
      reportedOn: r.reported_on,
    }));
  }

  async getRain(from: string, to: string): Promise<RainRow[]> {
    // Rain is one city-wide value written into every ward's row; read it once per day.
    const res = await query(
      `SELECT DISTINCT ON (date) to_char(date, 'YYYY-MM-DD') as date, count
       FROM signals
       WHERE signal_type = 'rain' AND source_tag = 'real' AND date >= $1 AND date <= $2
       ORDER BY date ASC, ward_id ASC`,
      [from, to]
    );
    return res.rows.map((r) => ({ date: r.date, mm: parseFloat(r.count), sourceTag: "real" as const }));
  }

  async insertAlert(alert: Alert, causeEvidence: string[] = []): Promise<{ alert: DbAlert; isNew: boolean }> {
    const res = await query(
      `INSERT INTO alerts (ward_id, date, score, method, contributing_signals, cause_probs, suspected_zone_id, evidence, cause_evidence, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open')
       ON CONFLICT (ward_id, date, method) DO NOTHING
       RETURNING ${ALERT_COLUMNS}`,
      [
        alert.wardId,
        alert.date,
        alert.score,
        alert.method,
        alert.contributingSignals,
        JSON.stringify(alert.causeProbs),
        alert.suspectedZoneId,
        alert.evidence,
        causeEvidence,
      ]
    );
    if (res.rows.length > 0) return { alert: rowToAlert(res.rows[0]), isNew: true };

    const existing = await query(`SELECT ${ALERT_COLUMNS} FROM alerts WHERE ward_id = $1 AND date = $2 AND method = $3`, [
      alert.wardId,
      alert.date,
      alert.method,
    ]);
    return { alert: rowToAlert(existing.rows[0]), isNew: false };
  }

  async getAlerts(filter?: AlertFilter): Promise<DbAlert[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter?.date) {
      params.push(filter.date);
      conditions.push(`date = $${params.length}`);
    }
    if (filter?.fromDate) {
      params.push(filter.fromDate);
      conditions.push(`date >= $${params.length}`);
    }
    if (filter?.wardId !== undefined) {
      params.push(filter.wardId);
      conditions.push(`ward_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    let paginationClause = "";
    if (filter?.limit) {
      params.push(filter.limit);
      paginationClause += ` LIMIT $${params.length}`;
    }
    if (filter?.offset) {
      params.push(filter.offset);
      paginationClause += ` OFFSET $${params.length}`;
    }

    const sql = `SELECT ${ALERT_COLUMNS} FROM alerts ${whereClause}
                 ORDER BY created_at DESC, date DESC, score DESC ${paginationClause}`;
    const res = await query(sql, params);
    return res.rows.map(rowToAlert);
  }

  async getAlertById(id: string): Promise<DbAlert | null> {
    // Ids are UUIDs; anything else cannot exist (and would make Postgres throw).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    const res = await query(`SELECT ${ALERT_COLUMNS} FROM alerts WHERE id = $1`, [id]);
    return res.rows.length === 0 ? null : rowToAlert(res.rows[0]);
  }

  async updateAlertStatus(id: string, status: AlertStatus): Promise<DbAlert | null> {
    const res = await query(`UPDATE alerts SET status = $1 WHERE id = $2 RETURNING ${ALERT_COLUMNS}`, [status, id]);
    return res.rows.length === 0 ? null : rowToAlert(res.rows[0]);
  }

  async insertAlertEvent(event: Omit<AlertEventRow, "id">): Promise<AlertEventRow> {
    const res = await query(
      `INSERT INTO alert_events (alert_id, event, actor, note, at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, alert_id, event, actor, note, at`,
      [event.alertId, event.event, event.actor, event.note ?? null, event.at]
    );
    return rowToEvent(res.rows[0]);
  }

  async getAlertEvents(alertId: string): Promise<AlertEventRow[]> {
    return (await this.getAlertEventsFor([alertId])).get(alertId) ?? [];
  }

  async getAlertEventsFor(alertIds: string[]): Promise<Map<string, AlertEventRow[]>> {
    const out = new Map<string, AlertEventRow[]>();
    if (alertIds.length === 0) return out;
    const res = await query(
      `SELECT id, alert_id, event, actor, note, at FROM alert_events
       WHERE alert_id = ANY($1::uuid[]) ORDER BY at ASC, id ASC`,
      [alertIds]
    );
    for (const r of res.rows) {
      const list = out.get(r.alert_id) ?? [];
      list.push(rowToEvent(r));
      out.set(r.alert_id, list);
    }
    return out;
  }

  async getWardContainingPoint(lng: number, lat: number): Promise<Ward | null> {
    const res = await query(
      `SELECT id, name, zone_id FROM wards
       WHERE ST_Contains(geom, ST_SetSRID(ST_Point($1, $2), 4326))
       LIMIT 1`,
      [lng, lat]
    );
    if (res.rows.length === 0) return null;
    return { id: res.rows[0].id, name: res.rows[0].name, zoneId: res.rows[0].zone_id };
  }

  async findZoneForWard(wardId: number): Promise<PipelineZone | null> {
    const res = await query(
      `SELECT z.id, z.name
       FROM pipeline_zones z
       JOIN wards w ON ST_Intersects(w.geom, z.geom)
       WHERE w.id = $1
       ORDER BY ST_Area(ST_Intersection(w.geom, z.geom)) DESC
       LIMIT 1`,
      [wardId]
    );
    if (res.rows.length === 0) return null;
    return { id: res.rows[0].id, name: res.rows[0].name };
  }

  async recordComplaintEvent(event: ComplaintEventRow): Promise<boolean> {
    const res = await query(
      `INSERT INTO complaint_events (id, ward_id, date) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [event.id, event.wardId, event.date]
    );
    return res.rows.length === 1;
  }

  async hasComplaintEvent(id: string): Promise<boolean> {
    const res = await query(`SELECT 1 FROM complaint_events WHERE id = $1`, [id]);
    return res.rows.length === 1;
  }

  async countComplaintEvents(wardId: number, date: string): Promise<number> {
    const res = await query(`SELECT count(*)::int AS n FROM complaint_events WHERE ward_id = $1 AND date = $2`, [wardId, date]);
    return res.rows[0].n;
  }

  async resetDemoData(): Promise<void> {
    // Delete events, alerts, signals, complaint ids and detector state, preserving wards and pipeline zones
    await this.inTransaction(async (client) => {
      await client.query(`DELETE FROM alert_events`);
      await client.query(`DELETE FROM alerts`);
      await client.query(`DELETE FROM signals`);
      await client.query(`DELETE FROM complaint_events`);
      await client.query(`DELETE FROM detector_state`);
    });
  }

  async insertDemoOutbreak(outbreak: Omit<DemoOutbreak, "id" | "active">): Promise<DemoOutbreak> {
    const res = await query(
      `INSERT INTO demo_outbreaks (ward_id, cause, start_date, seed) VALUES ($1, $2, $3, $4)
       RETURNING id, ward_id, cause, to_char(start_date, 'YYYY-MM-DD') AS start_date, seed, active`,
      [outbreak.wardId, outbreak.cause, outbreak.startDate, outbreak.seed]
    );
    return toDemoOutbreak(res.rows[0]);
  }

  async getActiveDemoOutbreaks(): Promise<DemoOutbreak[]> {
    const res = await query(
      `SELECT id, ward_id, cause, to_char(start_date, 'YYYY-MM-DD') AS start_date, seed, active
       FROM demo_outbreaks WHERE active ORDER BY id`
    );
    return res.rows.map(toDemoOutbreak);
  }

  async clearDemoOutbreaks(): Promise<void> {
    await query(`DELETE FROM demo_outbreaks`);
  }

  async getLatestDetectorState(method: DetectorState["method"], onOrBefore?: string): Promise<SavedDetectorState | null> {
    const res = await query(
      `SELECT method, to_char(as_of_date, 'YYYY-MM-DD') as as_of_date, state FROM detector_state
       WHERE method = $1 AND ($2::date IS NULL OR as_of_date <= $2::date)
       ORDER BY as_of_date DESC LIMIT 1`,
      [method, onOrBefore ?? null]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    const state = row.state as DetectorState;
    if (method === "cusum") {
      const cells = await query(
        `SELECT ward_id, signal_type, sum, to_char(next_date, 'YYYY-MM-DD') as next_date
         FROM detector_state_cusum WHERE method = $1 AND as_of_date = $2`,
        [method, row.as_of_date]
      );
      state.cusum = { cells: Object.fromEntries(cells.rows.map((c) => [`${c.ward_id}:${c.signal_type}`, { sum: Number(c.sum), nextDate: c.next_date }])) };
    }
    return { method: row.method, asOfDate: row.as_of_date, state };
  }

  async saveDetectorDay(input: SaveDetectorDayInput): Promise<Array<{ alert: DbAlert; isNew: boolean }>> {
    return this.inTransaction(async (client) => {
      const saved: Array<{ alert: DbAlert; isNew: boolean }> = [];
      for (const { alert, causeEvidence } of input.alerts) {
        // A re-run of the same day refreshes the detector's numbers; status and events stay.
        const res = await client.query(
          `INSERT INTO alerts (ward_id, date, score, method, contributing_signals, cause_probs, suspected_zone_id, evidence, cause_evidence, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open')
           ON CONFLICT (ward_id, date, method) DO UPDATE SET
             score = EXCLUDED.score, contributing_signals = EXCLUDED.contributing_signals,
             cause_probs = EXCLUDED.cause_probs, suspected_zone_id = EXCLUDED.suspected_zone_id,
             evidence = EXCLUDED.evidence, cause_evidence = EXCLUDED.cause_evidence
           RETURNING ${ALERT_COLUMNS}, (xmax = 0) AS inserted`,
          [
            alert.wardId,
            alert.date,
            alert.score,
            alert.method,
            alert.contributingSignals,
            JSON.stringify(alert.causeProbs),
            alert.suspectedZoneId,
            alert.evidence,
            causeEvidence,
          ]
        );
        const row = res.rows[0];
        const isNew = row.inserted === true;
        if (isNew) {
          await client.query(`INSERT INTO alert_events (alert_id, event, actor, note, at) VALUES ($1, 'created', $2, $3, now())`, [
            row.id,
            input.actor,
            `Raised by the ${alert.method} detector for ${alert.date}`,
          ]);
        }
        saved.push({ alert: rowToAlert(row), isNew });
      }

      const stateJson = { ...input.state, cusum: input.state.cusum ? { cells: {} } : null };
      await client.query(
        `INSERT INTO detector_state (method, as_of_date, state, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (method, as_of_date) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [input.method, input.asOfDate, JSON.stringify(stateJson)]
      );
      const cells = cusumRows(input.state);
      await client.query(`DELETE FROM detector_state_cusum WHERE method = $1 AND as_of_date = $2`, [input.method, input.asOfDate]);
      if (cells.length > 0) {
        await client.query(
          `INSERT INTO detector_state_cusum (method, as_of_date, ward_id, signal_type, sum, next_date)
           SELECT $1, $2, * FROM unnest($3::int[], $4::text[], $5::float8[], $6::date[])`,
          [input.method, input.asOfDate, cells.map((c) => c.wardId), cells.map((c) => c.signalType), cells.map((c) => c.sum), cells.map((c) => c.nextDate)]
        );
      }
      await client.query(`DELETE FROM detector_state WHERE method = $1 AND as_of_date < $2::date - $3::int`, [
        input.method,
        input.asOfDate,
        input.keepStateDays,
      ]);
      return saved;
    });
  }

  async deleteDetectorStatesFrom(method: DetectorState["method"], fromDate: string): Promise<void> {
    await query(`DELETE FROM detector_state WHERE method = $1 AND as_of_date >= $2`, [method, fromDate]);
  }

  async deleteUntouchedAlerts(fromDate: string, toDate: string, keep: Set<string>): Promise<number> {
    const res = await query(
      `SELECT a.id, a.ward_id, to_char(a.date, 'YYYY-MM-DD') as date, a.method FROM alerts a
       WHERE a.date >= $1 AND a.date <= $2 AND a.status = 'open'
         AND NOT EXISTS (SELECT 1 FROM alert_events e WHERE e.alert_id = a.id AND e.event = ANY($3::text[]))`,
      [fromDate, toDate, OFFICER_EVENTS]
    );
    const ids = res.rows.filter((r) => !keep.has(alertKey({ wardId: r.ward_id, date: r.date, method: r.method }))).map((r) => r.id);
    if (ids.length > 0) await query(`DELETE FROM alerts WHERE id = ANY($1::uuid[])`, [ids]);
    return ids.length;
  }

  async withDetectorLock<T>(fn: () => Promise<T>): Promise<T> {
    const client = await (await getPool()).connect();
    try {
      await client.query(`SELECT pg_advisory_lock($1)`, [DETECTOR_LOCK_ID]);
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [DETECTOR_LOCK_ID]).catch(() => undefined);
      client.release();
    }
  }

  private async inTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await (await getPool()).connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * In-memory Database Implementation for local development and deterministic tests.
 * Replicates the constraints: UNIQUE(ward_id, date, method) and UNIQUE(ward_id, signal_type, date, source_tag).
 */
export class MemoryDatabase implements IDatabase {
  private wards = new Map<number, Ward>();
  private pipelineZones = new Map<number, PipelineZone>();
  private signals = new Map<string, StoredSignal>();
  private alerts = new Map<string, DbAlert>();
  private alertEvents: AlertEventRow[] = [];
  private states: SavedDetectorState[] = [];
  private complaintEvents = new Map<string, ComplaintEventRow>();
  private demoOutbreaks: DemoOutbreak[] = [];
  private lock: Promise<unknown> = Promise.resolve();

  async initSchema(): Promise<void> {}

  async insertWards(wards: Ward[]): Promise<void> {
    for (const w of wards) {
      this.wards.set(w.id, { id: w.id, name: w.name, zoneId: w.zoneId ?? null, geometry: w.geometry });
    }
  }

  async insertPipelineZones(zones: PipelineZone[]): Promise<void> {
    for (const z of zones) {
      this.pipelineZones.set(z.id, { id: z.id, name: z.name, geometry: z.geometry });
    }
  }

  async getWards(): Promise<Ward[]> {
    return Array.from(this.wards.values())
      .sort((a, b) => a.id - b.id)
      .map((w) => ({ id: w.id, name: w.name, zoneId: w.zoneId }));
  }

  async getWard(id: number): Promise<Ward | null> {
    const w = this.wards.get(id);
    return w ? { id: w.id, name: w.name, zoneId: w.zoneId } : null;
  }

  async getPipelineZones(): Promise<PipelineZone[]> {
    return Array.from(this.pipelineZones.values()).sort((a, b) => a.id - b.id);
  }

  async insertSignal(signal: SignalWrite): Promise<void> {
    await this.insertSignals([signal]);
  }

  async insertSignals(signals: SignalWrite[]): Promise<number> {
    const rows = dedupeSignals(signals);
    for (const s of rows) {
      this.signals.set(`${s.wardId}|${s.signalType}|${s.date}|${s.sourceTag}`, {
        wardId: s.wardId,
        signalType: s.signalType,
        date: s.date,
        count: s.count,
        sourceTag: s.sourceTag,
        reportedOn: s.reportedOn ?? s.date,
      });
    }
    return rows.length;
  }

  async getSignals(filter?: SignalFilter): Promise<StoredSignal[]> {
    return Array.from(this.signals.values())
      .filter((s) => {
        if (filter?.startDate && s.date < filter.startDate) return false;
        if (filter?.endDate && s.date > filter.endDate) return false;
        if (filter?.wardId !== undefined && s.wardId !== filter.wardId) return false;
        if (filter?.reportedBy && s.reportedOn > filter.reportedBy) return false;
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.wardId - b.wardId || a.signalType.localeCompare(b.signalType))
      .map((s) => ({ ...s }));
  }

  async getRain(from: string, to: string): Promise<RainRow[]> {
    const byDate = new Map<string, number>();
    for (const s of await this.getSignals({ startDate: from, endDate: to })) {
      if (s.signalType === "rain" && s.sourceTag === "real" && !byDate.has(s.date)) byDate.set(s.date, s.count);
    }
    return [...byDate].map(([date, mm]) => ({ date, mm, sourceTag: "real" as const }));
  }

  async insertAlert(alert: Alert, causeEvidence: string[] = []): Promise<{ alert: DbAlert; isNew: boolean }> {
    for (const existing of this.alerts.values()) {
      if (alertKey(existing) === alertKey(alert)) return { alert: { ...existing }, isNew: false };
    }
    const dbAlert: DbAlert = { ...structuredClone(alert), causeEvidence: [...causeEvidence], id: randomUUID(), status: "open", createdAt: new Date().toISOString() };
    this.alerts.set(dbAlert.id, dbAlert);
    return { alert: { ...dbAlert }, isNew: true };
  }

  async getAlerts(filter?: AlertFilter): Promise<DbAlert[]> {
    let list = Array.from(this.alerts.values());
    if (filter?.status) list = list.filter((a) => a.status === filter.status);
    if (filter?.date) list = list.filter((a) => a.date === filter.date);
    if (filter?.fromDate) list = list.filter((a) => a.date >= filter.fromDate!);
    if (filter?.wardId !== undefined) list = list.filter((a) => a.wardId === filter.wardId);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date) || b.score - a.score);
    if (filter?.offset) list = list.slice(filter.offset);
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list.map((a) => ({ ...a }));
  }

  async getAlertById(id: string): Promise<DbAlert | null> {
    const a = this.alerts.get(id);
    return a ? { ...a } : null;
  }

  async updateAlertStatus(id: string, status: AlertStatus): Promise<DbAlert | null> {
    const alert = this.alerts.get(id);
    if (!alert) return null;
    alert.status = status;
    return { ...alert };
  }

  async insertAlertEvent(event: Omit<AlertEventRow, "id">): Promise<AlertEventRow> {
    const fullEvent: AlertEventRow = { ...event, id: randomUUID() };
    this.alertEvents.push(fullEvent);
    return { ...fullEvent };
  }

  async getAlertEvents(alertId: string): Promise<AlertEventRow[]> {
    return (await this.getAlertEventsFor([alertId])).get(alertId) ?? [];
  }

  async getAlertEventsFor(alertIds: string[]): Promise<Map<string, AlertEventRow[]>> {
    const wanted = new Set(alertIds);
    const out = new Map<string, AlertEventRow[]>();
    // Stable sort: events with the same time keep the order they were written in.
    for (const e of [...this.alertEvents].sort((a, b) => a.at.localeCompare(b.at))) {
      if (!wanted.has(e.alertId)) continue;
      const list = out.get(e.alertId) ?? [];
      list.push({ ...e });
      out.set(e.alertId, list);
    }
    return out;
  }

  async getWardContainingPoint(lng: number, lat: number): Promise<Ward | null> {
    for (const ward of this.wards.values()) {
      if (ward.geometry && isPointInMultiPolygon({ lng, lat }, ward.geometry)) {
        return { id: ward.id, name: ward.name, zoneId: ward.zoneId };
      }
    }
    return null;
  }

  async findZoneForWard(wardId: number): Promise<PipelineZone | null> {
    const ward = this.wards.get(wardId);
    if (!ward || ward.zoneId === null || ward.zoneId === undefined) return null;
    return this.pipelineZones.get(ward.zoneId) ?? null;
  }

  async recordComplaintEvent(event: ComplaintEventRow): Promise<boolean> {
    if (this.complaintEvents.has(event.id)) return false;
    this.complaintEvents.set(event.id, { ...event });
    return true;
  }

  async hasComplaintEvent(id: string): Promise<boolean> {
    return this.complaintEvents.has(id);
  }

  async countComplaintEvents(wardId: number, date: string): Promise<number> {
    let n = 0;
    for (const e of this.complaintEvents.values()) if (e.wardId === wardId && e.date === date) n++;
    return n;
  }

  async resetDemoData(): Promise<void> {
    this.alertEvents = [];
    this.alerts.clear();
    this.signals.clear();
    this.complaintEvents.clear();
    this.states = [];
  }

  async insertDemoOutbreak(outbreak: Omit<DemoOutbreak, "id" | "active">): Promise<DemoOutbreak> {
    const saved: DemoOutbreak = { ...outbreak, id: this.demoOutbreaks.length + 1, active: true };
    this.demoOutbreaks.push(saved);
    return { ...saved };
  }

  async getActiveDemoOutbreaks(): Promise<DemoOutbreak[]> {
    return this.demoOutbreaks.filter((o) => o.active).map((o) => ({ ...o }));
  }

  async clearDemoOutbreaks(): Promise<void> {
    this.demoOutbreaks = [];
  }

  async getLatestDetectorState(method: DetectorState["method"], onOrBefore?: string): Promise<SavedDetectorState | null> {
    const found = this.states
      .filter((s) => s.method === method && (!onOrBefore || s.asOfDate <= onOrBefore))
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))[0];
    return found ? structuredClone(found) : null;
  }

  async saveDetectorDay(input: SaveDetectorDayInput): Promise<Array<{ alert: DbAlert; isNew: boolean }>> {
    const saved: Array<{ alert: DbAlert; isNew: boolean }> = [];
    for (const { alert, causeEvidence } of input.alerts) {
      const existing = [...this.alerts.values()].find((a) => alertKey(a) === alertKey(alert));
      if (existing) {
        Object.assign(existing, structuredClone(alert), { causeEvidence: [...causeEvidence] });
        saved.push({ alert: { ...existing }, isNew: false });
        continue;
      }
      const { alert: created } = await this.insertAlert(alert, causeEvidence);
      await this.insertAlertEvent({
        alertId: created.id,
        event: "created",
        actor: input.actor,
        note: `Raised by the ${alert.method} detector for ${alert.date}`,
        at: new Date().toISOString(),
      });
      saved.push({ alert: created, isNew: true });
    }
    const keepFrom = new Date(Date.parse(`${input.asOfDate}T00:00:00Z`) - input.keepStateDays * 86_400_000).toISOString().slice(0, 10);
    this.states = this.states.filter((s) => !(s.method === input.method && (s.asOfDate === input.asOfDate || s.asOfDate < keepFrom)));
    this.states.push(structuredClone({ method: input.method, asOfDate: input.asOfDate, state: input.state }));
    return saved;
  }

  async deleteDetectorStatesFrom(method: DetectorState["method"], fromDate: string): Promise<void> {
    this.states = this.states.filter((s) => !(s.method === method && s.asOfDate >= fromDate));
  }

  async deleteUntouchedAlerts(fromDate: string, toDate: string, keep: Set<string>): Promise<number> {
    let deleted = 0;
    for (const a of [...this.alerts.values()]) {
      if (a.date < fromDate || a.date > toDate || a.status !== "open" || keep.has(alertKey(a))) continue;
      if (this.alertEvents.some((e) => e.alertId === a.id && OFFICER_EVENTS.includes(e.event))) continue;
      this.alerts.delete(a.id);
      this.alertEvents = this.alertEvents.filter((e) => e.alertId !== a.id);
      deleted++;
    }
    return deleted;
  }

  async withDetectorLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }
}

let activeDatabase: IDatabase | null = null;

export function getDatabase(): IDatabase {
  if (activeDatabase) return activeDatabase;

  const useMock =
    process.env.USE_MOCK_DB === "true" ||
    process.env.NODE_ENV === "test" ||
    (!process.env.DATABASE_URL && !process.env.DB_SECRET_NAME && !process.env.DB_SECRET_ARN);

  activeDatabase = useMock ? new MemoryDatabase() : new PostgresDatabase();
  return activeDatabase;
}

export function setDatabase(db: IDatabase | null): void {
  activeDatabase = db;
}
