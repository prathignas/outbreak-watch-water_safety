import { type IDatabase, getDatabase } from "../repository.js";
import type { PipelineZone } from "../types.js";

export class ZoneRepository {
  constructor(private db: IDatabase = getDatabase()) {}

  async insertZones(zones: PipelineZone[]): Promise<void> {
    return this.db.insertPipelineZones(zones);
  }

  async getAll(): Promise<PipelineZone[]> {
    return this.db.getPipelineZones();
  }

  /**
   * Spatial Query: Finds the pipeline supply zone serving or intersecting the given ward.
   */
  async findZoneForWard(wardId: number): Promise<PipelineZone | null> {
    return this.db.findZoneForWard(wardId);
  }
}
