import { addDays, yearOf } from "../src/dates.js";
import { RAIN_SURGE, type DifficultyLevel } from "../src/params.js";
import { simulate, type Simulation } from "../src/simulator.js";
import { SYNTHETIC_SIGNAL_TYPES } from "../src/types.js";

/** Prints a plain-text summary of the simulator, so a person can sanity-check it. */

const pad = (value: string | number, width: number) => String(value).padStart(width);
const round = (value: number, digits = 1) => value.toFixed(digits);

function printRain(sim: Simulation): void {
  console.log("REAL RAIN (Open-Meteo, central Bengaluru)");
  console.log("  year   total mm   days >= 15.6 mm   wettest day");
  const years = [...new Set(sim.rain.map((day) => yearOf(day.date)))];
  for (const year of years) {
    const days = sim.rain.filter((day) => yearOf(day.date) === year);
    const total = days.reduce((sum, day) => sum + day.mm, 0);
    const rainy = days.filter((day) => day.mm >= RAIN_SURGE.triggerMm).length;
    const wettest = days.reduce((best, day) => (day.mm > best.mm ? day : best));
    console.log(`  ${year}  ${pad(round(total), 9)}   ${pad(rainy, 15)}   ${wettest.date} (${wettest.mm} mm)`);
  }
  console.log();
}

function printDifficulty(sim: Simulation): void {
  const { outbreaks, harmlessSurges } = sim.answerKey;
  console.log(`=== ${sim.difficulty.toUpperCase()} (seed ${sim.seed}) ===`);
  const s = sim.settings;
  const lags = SYNTHETIC_SIGNAL_TYPES.map((signal) => `${signal} ${s.reportingLagDays[signal].min}-${s.reportingLagDays[signal].max}d`);
  console.log(`  outbreak strength x${s.outbreakStrength}, noise ${s.noiseLevel}, harmless surges x${s.harmlessSurgeScale}`);
  console.log(`  reporting lag: ${lags.join(", ")}`);

  console.log("  outbreaks        tuning (2022-23)   test (2024-25)");
  for (const cause of ["water", "food", "p2p", "seasonal"] as const) {
    const tuning = outbreaks.filter((o) => o.cause === cause && o.split === "tuning").length;
    const test = outbreaks.filter((o) => o.cause === cause && o.split === "test").length;
    console.log(`    ${cause.padEnd(12)} ${pad(tuning, 10)} ${pad(test, 16)}`);
  }
  const rainSurges = harmlessSurges.filter((h) => h.kind === "rain").length;
  const festivalSurges = harmlessSurges.filter((h) => h.kind === "festival").length;
  console.log(`  harmless surges: ${rainSurges} after real rain, ${festivalSurges} after festivals`);

  const ratios = (cause: string) =>
    outbreaks.filter((o) => o.cause === cause).map((o) => {
      const date = addDays(o.peakDate, o.signalDelayDays.pharmacy);
      return sim.count("pharmacy", o.originWardId as number, date) / sim.normalLevel("pharmacy", date);
    });
  const avg = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  console.log(`  pharmacy at peak vs normal (origin ward): water ${round(avg(ratios("water")))}x, ` +
    `food ${round(avg(ratios("food")))}x, p2p ${round(avg(ratios("p2p")))}x`);
  console.log(`  rows: ${sim.wardIds.length} wards x ${sim.dates.length} days x 4 signals = ` +
    `${sim.wardIds.length * sim.dates.length * 4} (3 synthetic + 1 real rain per ward-day)`);
  console.log();
}

function printWaterExample(sim: Simulation): void {
  const outbreak = sim.answerKey.outbreaks.find((o) => o.cause === "water");
  if (!outbreak) return;
  const ward = outbreak.originWardId as number;
  const zoneWard = outbreak.affectedWards.find((w) => w.wardId !== ward)?.wardId as number;
  console.log(`=== ONE WATER OUTBREAK, DAY BY DAY (${sim.difficulty}) ===`);
  console.log(`  ${outbreak.id}: ward ${ward}, pipeline zone ${outbreak.zoneId} (${outbreak.affectedWards.length} wards)`);
  console.log(`  real rain trigger ${outbreak.triggerRainDate} (${sim.rainOn(outbreak.triggerRainDate as string)} mm), ` +
    `illness ${outbreak.startDate} to ${outbreak.endDate}, peak ${outbreak.peakDate}`);
  console.log(`  signal delays: complaint +${outbreak.signalDelayDays.complaint}d, ` +
    `pharmacy +${outbreak.signalDelayDays.pharmacy}d, hospital +${outbreak.signalDelayDays.hospital}d`);
  console.log(`  "normal" = what an ordinary day averages (weekday + season only)`);
  console.log("  date        day  rain mm | complaint (normal) | pharmacy (normal) | hospital (normal) | zone ward " +
    `${zoneWard} pharmacy`);

  const from = addDays(outbreak.triggerRainDate ?? outbreak.startDate, -1);
  const to = addDays(outbreak.endDate, outbreak.signalDelayDays.hospital + 2);
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = (Date.parse(date) - Date.parse(outbreak.startDate)) / 86_400_000;
    const cell = (signal: "complaint" | "pharmacy" | "hospital") =>
      `${pad(sim.count(signal, ward, date), 4)} (${pad(round(sim.normalLevel(signal, date)), 4)})`;
    const marker = date === outbreak.startDate ? " <- illness starts" : date === outbreak.peakDate ? " <- illness peak" : "";
    console.log(`  ${date} ${pad(day, 4)} ${pad(round(sim.rainOn(date)), 8)} | ${cell("complaint").padStart(18)} | ` +
      `${cell("pharmacy").padStart(17)} | ${cell("hospital").padStart(17)} | ${pad(sim.count("pharmacy", zoneWard, date), 13)}${marker}`);
  }
  console.log();
}

try {
  const levels: DifficultyLevel[] = ["easy", "realistic", "hard"];
  const sims = levels.map((difficulty) => simulate({ difficulty }));
  printRain(sims[0]);
  for (const sim of sims) printDifficulty(sim);
  printWaterExample(sims[1]);
} catch (error) {
  console.error(`sim-summary failed: ${String(error)}`);
  process.exit(1);
}
