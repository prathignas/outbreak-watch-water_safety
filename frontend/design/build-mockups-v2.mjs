// Builds design/mockups-v2.html (soft UI) from mockup-data.json and seed results. Every number is real output.
import { readFileSync, writeFileSync } from "node:fs";
const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const data = JSON.parse(rd("./mockup-data.json"));
const backtest = JSON.parse(rd("../../results/backtest.json"));
const icon = (name) => rd(`./node_modules/lucide-static/icons/${name}.svg`).replace(/<!--.*?-->/gs, "").replace(/\n/g, "")
  .replace(/width="24"/, 'width="20"').replace(/height="24"/, 'height="20"').replace(/stroke-width="2"/, 'stroke-width="1.75"')
  .replace("<svg", '<svg aria-hidden="true" class="icon"');
const names = ["house", "map", "bell", "badge-check", "database", "sliders-horizontal", "waves", "eye", "siren", "check", "circle-check",
  "message-square-plus", "cloud-rain", "sun", "moon", "user", "clock", "chevron-right", "info"];
const row = backtest.summary.find((r) => r.method === "bayes" && r.difficulty === "realistic" && r.budget === 0.25 && r.cause === "water" && r.subset === "all");
const ch = backtest.chanceCheck?.rows.find((r) => r.method === "bayes" && r.difficulty === "realistic" && r.budget === 0.25 && r.cause === "water");
if (!ch) throw new Error("results/backtest.json has no chanceCheck yet (run npm run add-chance)");
const D = { ...data, alertLine: 0.7152527510491986, icons: Object.fromEntries(names.map((n) => [n, icon(n)])),
  proof: { found: row.detectionRate.median, chance: ch.phantomDetectionRate ? ch.phantomDetectionRate.median : null, seeds: backtest.seeds.length } };
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Outbreak Watch mockups v2</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Manrope:wght@500;600;700&display=swap" rel="stylesheet">' +
  "<style>" + rd("./mockup-v2.css") + "</style></head><body><script>window.D=" + JSON.stringify(D) + ";</script><script>" + rd("./mockup-v2-app.js") + "</script></body></html>";
writeFileSync(new URL("./mockups-v2.html", import.meta.url), html);
console.log("wrote mockups-v2.html", (html.length / 1024).toFixed(0), "KB; proof water", D.proof);
