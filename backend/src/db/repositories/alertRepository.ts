import { type IDatabase, getDatabase, type AlertFilter } from "../repository.js";
import type { Alert } from "@outbreak/contract";
import type { AlertStatus, DbAlert } from "../types.js";

export class AlertRepository {
  constructor(private db: IDatabase = getDatabase()) {}

  /**
   * Inserts an alert, enforcing UNIQUE (ward_id, date, method) constraint.
   * Returns whether this was a newly created alert or an existing duplicate.
   */
  async insert(alert: Alert, causeEvidence: string[] = []): Promise<{ alert: DbAlert; isNew: boolean }> {
    return this.db.insertAlert(alert, causeEvidence);
  }

  async getAll(filter?: AlertFilter): Promise<DbAlert[]> {
    return this.db.getAlerts(filter);
  }

  async getById(id: string): Promise<DbAlert | null> {
    return this.db.getAlertById(id);
  }

  async updateStatus(id: string, status: AlertStatus): Promise<DbAlert | null> {
    return this.db.updateAlertStatus(id, status);
  }
}
