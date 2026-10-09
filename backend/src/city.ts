/*
 * P1's real Bengaluru city model (243 wards, BWSSB water zones). city.json is imported,
 * so esbuild puts it inside the Lambda bundle and no file path is needed at run time.
 */
import cityFile from "@outbreak/detection/data/city.json" with { type: "json" };
import { RealCity, type CityFile } from "@outbreak/detection";

let city: RealCity | null = null;

export function getCity(): RealCity {
  city ??= new RealCity(cityFile as unknown as CityFile);
  return city;
}

export function getCityFile(): CityFile {
  return cityFile as unknown as CityFile;
}
