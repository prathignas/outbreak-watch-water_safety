import { type IDatabase, getDatabase, type SignalFilter, type SignalWrite, type StoredSignal } from "../repository.js";

export class SignalRepository {
  constructor(private db: IDatabase = getDatabase()) {}

  async insert(signal: SignalWrite): Promise<void> {
    return this.db.insertSignal(signal);
  }

  async insertMany(signals: SignalWrite[]): Promise<number> {
    return this.db.insertSignals(signals);
  }

  async getSignals(filter?: SignalFilter): Promise<StoredSignal[]> {
    return this.db.getSignals(filter);
  }

  async getHistoryForWard(
    wardId: number,
    startDate?: string,
    endDate?: string
  ): Promise<StoredSignal[]> {
    return this.db.getSignals({ wardId, startDate, endDate });
  }
}
