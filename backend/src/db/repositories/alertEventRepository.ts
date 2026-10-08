import { type IDatabase, getDatabase } from "../repository.js";
import type { AlertEventRow } from "../types.js";

export class AlertEventRepository {
  constructor(private db: IDatabase = getDatabase()) {}

  async recordEvent(event: Omit<AlertEventRow, "id">): Promise<AlertEventRow> {
    return this.db.insertAlertEvent(event);
  }

  async getEventsForAlert(alertId: string): Promise<AlertEventRow[]> {
    return this.db.getAlertEvents(alertId);
  }
}
