/* Browser stub for node:url, used only by the mock engine. realRain.ts builds a default
 * file path at import time; the path is never read in the browser. */
export function fileURLToPath(url: string | URL): string {
  return String(url);
}
export default { fileURLToPath };
