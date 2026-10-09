// Copies seed files into the app. Map shapes become static files in public/; results are
// slimmed (per-seed "runs" removed) for the mock backend. Nothing is changed otherwise.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const seed = (p) => new URL(`../seed/${p}`, import.meta.url);
const out = (p) => new URL(`../${p}`, import.meta.url);
mkdirSync(out("src/mock/data"), { recursive: true });
for (const f of ["wards.geojson", "zones.geojson", "city.json"]) copyFileSync(seed(f), out(`public/${f}`));
const slim = (file, name) => {
  const { runs: _runs, ...rest } = JSON.parse(readFileSync(seed(file), "utf8"));
  writeFileSync(out(`src/mock/data/${name}`), JSON.stringify(rest));
};
slim("backtest.json", "backtest.json");
slim("classifier.json", "classifier.json");
copyFileSync(seed("city.json"), out("src/mock/data/city.json"));
const rain = (f) => { const j = JSON.parse(readFileSync(seed(f), "utf8")); return j.daily.time.map((date, i) => ({ date, mm: j.daily.precipitation_sum[i] })); };
writeFileSync(out("src/mock/data/rain.json"), JSON.stringify([...rain("rain-2022-2025.json"), ...rain("rain-2026.json")]));
console.log("seed prepared");
