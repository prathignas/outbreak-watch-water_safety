import { type IDatabase, getDatabase } from "../repository.js";
import type { Ward } from "../types.js";

export class WardRepository {
  constructor(private db: IDatabase = getDatabase()) {}

  async insertWards(wards: Ward[]): Promise<void> {
    return this.db.insertWards(wards);
  }

  async getAll(): Promise<Ward[]> {
    return this.db.getWards();
  }

  async getById(id: number): Promise<Ward | null> {
    return this.db.getWard(id);
  }

  /**
   * Spatial Query: Finds the ward containing the given geographic point (lng, lat)
   */
  async findByCoordinates(lng: number, lat: number): Promise<Ward | null> {
    return this.db.getWardContainingPoint(lng, lat);
  }
}
