/* Browser stub for node:fs, used only by the mock engine. The detection module reads
 * files only in RealCity.fromFile and loadRealRain; the mock passes that data in instead. */
export function readFileSync(): never {
  throw new Error("File reading is not available in the browser (mock engine stub)");
}
export default { readFileSync };
