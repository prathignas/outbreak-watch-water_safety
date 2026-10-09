import { AlertTriangle, Info } from "lucide-react";
import { Fragment, useState } from "react";
import type { Difficulty, Spread } from "@/api/types";
import type { DetectionMethod } from "@/contract/types";
import { CauseDot } from "@/components/Chips";
import { Ring } from "@/components/Ring";
import { HonestyPill, PageHeader } from "@/components/Shell";
import { SoftCard } from "@/components/SoftCard";
import { ErrorState, LoadingBlock } from "@/components/States";
import { useBacktest } from "@/hooks/queries";
import { CAUSE_LABEL, pct } from "@/lib/format";
import { headlineWater } from "@/lib/headline";
import { cn } from "@/lib/utils";

const METHODS: Array<{ id: DetectionMethod; name: string; what: string }> = [
  { id: "bayes", name: "Bayes (fused signals)", what: "Combines complaints, pharmacy and hospital, plus neighbouring wards, into one chance. Needs 2 signals to agree." },
  { id: "cusum", name: "CUSUM", what: "Adds up small rises day after day; alerts when the running total passes a line." },
  { id: "threshold", name: "Threshold", what: "Alerts when any one signal is far above normal today." },
];
const LOCAL = ["water", "food", "p2p"] as const;
const range = (s: Spread | null) => (s ? `${pct(s.p10)} to ${pct(s.p90)}` : "");

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={pressed} onClick={onClick} className={cn("soft-btn h-11 rounded-full px-4 text-sm", pressed && "font-bold text-teal")}>{children}</button>;
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <span className="soft-in relative block h-3.5 overflow-hidden rounded-full" aria-hidden="true">
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, value * 100)}%`, background: color }} />
    </span>
  );
}

export function ProofPage() {
  const bt = useBacktest();
  const [budget, setBudget] = useState(0.25);
  const [difficulty, setDifficulty] = useState<Difficulty>("realistic");
  if (bt.isError) return <><PageHeader title="Proof" /><ErrorState title="Could not load the results" error={bt.error} onRetry={() => bt.refetch()} /></>;
  if (!bt.data) return <><PageHeader title="Proof" /><LoadingBlock label="Loading results" /></>;
  const d = bt.data;
  const row = (m: DetectionMethod, cause: string) => d.summary.find((r) => r.method === m && r.difficulty === difficulty && r.budget === budget && r.cause === cause && r.subset === "all");
  const chance = (m: DetectionMethod, cause: string) => d.chanceCheck?.rows.find((r) => r.method === m && r.difficulty === difficulty && r.budget === budget && r.cause === cause);
  const count = (m: DetectionMethod, cause: string) => d.counts?.find((r) => r.method === m && r.difficulty === difficulty && r.budget === budget && r.cause === cause);
  const headline = headlineWater(d);
  const fa = (m: DetectionMethod) => d.falseAlarms.find((r) => r.method === m && r.difficulty === difficulty && r.budget === budget);
  const flags = d.fusionDoesNotHelp.filter((f) => f.budget === budget && f.difficulty === difficulty);
  const chanceAt1 = d.chanceCheck?.rows.filter((r) => r.budget === 1 && r.difficulty === difficulty && r.phantomDetectionRate).map((r) => r.phantomDetectionRate!.median) ?? [];

  return (
    <>
      <PageHeader title="Proof"><HonestyPill /></PageHeader>
      <p className="text-muted">Found % is generous: an alert in the outbreak ward or a neighbour, up to {d.rules.matchGraceDays} days after it ends, counts. Compare each number with 'By chance' and look at Days.</p>
      {headline.length > 0 && (
        <p className="text-lg">
          At the same false-alarm cost, all three methods find most water outbreaks ({headline.map((h) => `${h.name} ${h.found}`).join(", ")}); the difference is speed: days to first alert ({headline.map((h) => `${h.name} ${h.days}`).join(", ")}). <span className="text-muted">Realistic, 0.25 false alarms per ward-year.</span>
        </p>
      )}
      <SoftCard className="grid gap-3 p-6 md:p-8" aria-labelledby="how-h">
        <h2 id="how-h" className="text-2xl font-bold">How well it works</h2>
        <p className="text-lg"><b>Results on simulated outbreaks</b> ({d.status}, {d.city} city of {d.wardCount} wards, {d.seeds.length} seeds, test years {d.rules.testYears.join(" and ")}).</p>
        <p>Each method's alert line was chosen on {d.rules.tuningYears.join(" and ")} only, to give at most the false-alarm budget below, then locked and run once on {d.rules.testYears.join(" and ")}. An outbreak counts as found at the first alert in an affected ward or a neighbour of one, from its start to {d.rules.matchGraceDays} days after its end.</p>
        <p className="text-muted">Chance level: how often the same locked alerts "find" a fake outbreak placed where nothing happened. A result only means something when it is well above chance.</p>
      </SoftCard>

      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Result settings">
        <span className="font-bold">False-alarm budget</span>
        <Chip pressed={budget === 0.25 && difficulty === "realistic"} onClick={() => { setBudget(0.25); setDifficulty("realistic"); }}>Headline</Chip>
        <Chip pressed={budget === 0.25} onClick={() => setBudget(0.25)}>0.25 per ward-year</Chip>
        <Chip pressed={budget === 1} onClick={() => setBudget(1)}>1 per ward-year</Chip>
        <span className="mx-1 hidden h-7 w-px bg-[var(--map-line)] md:block" aria-hidden="true" />
        <span className="font-bold">Difficulty</span>
        {(d.difficulties as Difficulty[]).map((x) => <Chip key={x} pressed={difficulty === x} onClick={() => setDifficulty(x)}>{x.charAt(0).toUpperCase() + x.slice(1)}</Chip>)}
      </div>
      {budget === 1 && (
        <p role="note" className="flex items-start gap-3 rounded-card bg-alert-bg px-6 py-4 text-alert-ink">
          <AlertTriangle className="mt-1 size-5 shrink-0" aria-hidden="true" />
          <span>At 1 false alarm per ward-year, chance alone "finds" {chanceAt1.length ? `${pct(Math.min(...chanceAt1))} to ${pct(Math.max(...chanceAt1))}` : "most"} of fake outbreaks. These numbers are not skill; use the 0.25 budget.</span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 xl:gap-8">
        {METHODS.map((m) => {
          const water = row(m.id, "water");
          const f = fa(m.id);
          return (
            <SoftCard key={m.id} className="grid content-start gap-5 p-6 md:p-8" aria-labelledby={`m-${m.id}`}>
              <div className="flex items-center gap-5">
                {water?.detectionRate && (
                  <Ring value={water.detectionRate.median} size={120} stroke={13} label={`${pct(water.detectionRate.median)} of water outbreaks found`}>
                    <span className="font-display text-xl font-bold">{pct(water.detectionRate.median)}</span>
                    <span className="text-xs text-muted">water</span>
                  </Ring>
                )}
                <div>
                  <h3 id={`m-${m.id}`} className="text-xl font-bold">{m.name}</h3>
                  <p className="text-sm text-muted">{m.what}</p>
                </div>
              </div>
              <table className="w-full border-separate border-spacing-y-3 text-left">
                <caption className="sr-only">{m.name}: outbreaks found, chance level and days to detect</caption>
                <thead className="text-sm text-muted"><tr><th scope="col" className="font-normal">Outbreak</th><th scope="col" className="font-normal">Found</th><th scope="col" className="font-normal">By chance</th><th scope="col" className="text-right font-normal">Days</th></tr></thead>
                <tbody>
                  {[...LOCAL, "seasonal" as const].map((c) => {
                    const r = row(m.id, c);
                    const ch = chance(m.id, c);
                    const flagged = flags.some((fl) => fl.simplerMethod === m.id && fl.cause === c && fl.subset === "all");
                    const noSkill = (ch?.phantomDetectionRate?.median ?? 0) > 0.5;
                    return (
                      <Fragment key={c}>
                      <tr className="align-top">
                        <th scope="row" className="pr-2 font-normal"><span className="inline-flex items-center gap-2"><CauseDot cause={c} />{c === "seasonal" ? "Seasonal wave" : CAUSE_LABEL[c]}</span>
                          {flagged && <span className="mt-1 block text-sm font-bold text-watch-ink">Fusion does not help here</span>}</th>
                        <td className="w-[38%] pr-3">
                          {r?.detectionRate ? <><span className="font-bold tabular">{pct(r.detectionRate.median)}</span>{count(m.id, c) && <span className="ml-2 text-sm text-muted tabular">found {count(m.id, c)!.found} of {count(m.id, c)!.total}</span>}<Bar value={r.detectionRate.median} color="var(--gauge)" /><span className="text-sm text-muted">{range(r.detectionRate)}</span></> : "n/a"}
                        </td>
                        <td className="pr-2">
                          {ch?.phantomDetectionRate ? <><span className="font-bold tabular">{pct(ch.phantomDetectionRate.median)}</span><Bar value={ch.phantomDetectionRate.median} color="var(--c-unknown)" /></> : <span className="text-sm text-muted">not computed</span>}
                        </td>
                        <td className="text-right tabular">{r?.medianDelayDays ? r.medianDelayDays.median.toFixed(1) : "n/a"}</td>
                      </tr>
                      {noSkill && (
                        <tr><td colSpan={4} className="text-sm text-watch-ink">At this setting even random alerts find most outbreaks, so this row can't tell the methods apart.</td></tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {f && (
                <p className="text-sm">
                  <b>False alarms:</b> {f.waveCounted ? f.waveCounted.median.toFixed(2) : "n/a"} per ward-year (wave counted as an outbreak), {f.waveExcluded ? f.waveExcluded.median.toFixed(2) : "n/a"} with the wave excluded.
                </p>
              )}
              <p className="text-sm text-muted">Found: median across seeds, with 10th to 90th percentile; "found X of Y" counts every outbreak over all seeds. Days: median days from outbreak start to the first alert.</p>
            </SoftCard>
          );
        })}
      </div>

      <SoftCard className="grid gap-3 p-6 md:p-8" aria-labelledby="flags-h">
        <h2 id="flags-h" className="text-2xl font-bold">Where fusion does not help ({flags.length} at these settings)</h2>
        <p className="text-muted">A simpler method found at least as many outbreaks as Bayes, at least as fast.</p>
        {flags.length === 0 ? <p>No case at these settings.</p> : (
          <ul className="grid gap-2">{flags.map((f) => <li key={f.text} className="flex gap-3"><Info className="mt-1 size-4 shrink-0 text-teal" aria-hidden="true" />{f.text.replace(/^fusion does not help here: /, "")}</li>)}</ul>
        )}
      </SoftCard>

      <SoftCard className="grid gap-3 p-6 md:p-8" aria-labelledby="notes-h">
        <h2 id="notes-h" className="text-2xl font-bold">What we must say honestly</h2>
        <ul className="grid list-disc gap-2 pl-6">
          <li>All health data is simulated, and the outbreaks were planted by our own simulator, so these numbers are optimistic for real life.</li>
          <li>Only the 0.25 budget is above chance. At 1 false alarm per ward-year, chance alone finds most fake outbreaks.</li>
          <li>Bayes is not best everywhere: a simpler method matches or beats it in the cases listed above.</li>
          <li>The seasonal wave touches every ward, so any alert counts as finding it; its chance level is not computed.</li>
          <li>The likely cause is a triage hint, not a diagnosis. It names food well, water better after 3 days, and person-to-person rarely.</li>
          <li>The matching rule was changed once, after a preliminary look, to fix a measurement bug. The change is recorded with its reason.</li>
        </ul>
        <p className="text-sm text-muted">The maths, with worked examples, is in docs/MATH.md and the rules in docs/STATUS.md of the detection repository.</p>
      </SoftCard>
    </>
  );
}
