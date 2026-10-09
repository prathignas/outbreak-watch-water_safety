import { Clock } from "lucide-react";
import { useId } from "react";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LiveSignalRow } from "@/api/types";
import { addDays, fmtDay, SIGNAL_LABEL } from "@/lib/format";
import { SourceBadge } from "./Chips";

type Signal = "complaint" | "pharmacy" | "hospital";
export interface ChartPoint {
  date: string;
  count: number | null;
  avg: number | null;
  normal: number | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * 8 weeks of one signal. "Normal for this weekday" uses the detection module's rule
 * (src/baseline.ts): the median of the same weekday in the 8 weeks before, with at least
 * 4 such days. The line is a 3-day trailing average; every daily count is a dot.
 */
export function buildSeries(rows: LiveSignalRow[], signal: Signal, today: string, days = 56): ChartPoint[] {
  // A day can have rows from several sources (simulated + citizen form): its total is their sum.
  const byDate = new Map<string, number>();
  for (const r of rows) if (r.signalType === signal) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.count);
  const out: ChartPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const history = Array.from({ length: 8 }, (_, w) => byDate.get(addDays(date, -7 * (w + 1)))).filter((v): v is number => v !== undefined);
    out.push({ date, count: byDate.get(date) ?? null, avg: null, normal: history.length >= 4 ? median(history) : null });
  }
  out.forEach((p, i) => {
    if (p.count === null) return;
    const w = out.slice(Math.max(0, i - 2), i + 1).map((q) => q.count).filter((v): v is number => v !== null);
    p.avg = w.reduce((a, b) => a + b, 0) / w.length;
  });
  return out;
}

export function lateNote(rows: LiveSignalRow[], series: ChartPoint[], signal: Signal): string | null {
  const missing = series.slice(-5).filter((p) => p.count === null).map((p) => fmtDay(p.date));
  const late = rows.filter((r) => r.signalType === signal && r.reportedOn > r.date).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const parts = [];
  if (missing.length) parts.push(`Not reported yet: ${missing.join(", ")}.`);
  if (late) parts.push(`The ${fmtDay(late.date)} count arrived on ${fmtDay(late.reportedOn)}.`);
  return parts.length ? parts.join(" ") : null;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="soft rounded-chip px-4 py-2 text-sm">
      <b>{fmtDay(p.date)}</b>
      <div>{p.count === null ? "Not reported yet" : `Count ${p.count}`}</div>
      {p.normal !== null && <div className="text-muted">Normal for this weekday {p.normal}</div>}
    </div>
  );
}

export function SignalChart({ rows, signal, today, alertDate }: { rows: LiveSignalRow[]; signal: Signal; today: string; alertDate: string }) {
  const id = useId().replace(/:/g, "");
  const series = buildSeries(rows, signal, today);
  const latest = [...series].reverse().find((p) => p.count !== null);
  const note = lateNote(rows, series, signal);
  const ticks = series.filter((_, i) => i % 14 === 0 || i === series.length - 1).map((p) => p.date);
  return (
    <figure className="grid gap-2">
      <figcaption className="flex flex-wrap items-center gap-3">
        <b>{SIGNAL_LABEL[signal]}</b>
        {[...new Set(rows.filter((r) => r.signalType === signal).map((r) => r.sourceTag))].sort().map((tag) => <SourceBadge key={tag} tag={tag} />)}
        {latest && <span className="ml-auto text-sm text-muted">Latest {latest.count} on {fmtDay(latest.date)}{latest.normal !== null ? `, normal ${latest.normal}` : ""}</span>}
      </figcaption>
      <div className="h-[9.375rem] w-full" role="img"
        aria-label={`${SIGNAL_LABEL[signal]}, last 8 weeks.${latest ? ` Latest ${latest.count} on ${fmtDay(latest.date)}, normal ${latest.normal ?? "not known"}.` : ""}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 8, right: 28, bottom: 0, left: 24 }}>
            <defs>
              <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--line)" stopOpacity={0.38} />
                <stop offset="1" stopColor="var(--line)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" ticks={ticks} tickFormatter={fmtDay} tick={{ fill: "var(--muted)", fontSize: 15 }} axisLine={{ stroke: "var(--map-line)" }} tickLine={false} interval={0} />
            <YAxis hide domain={[0, "dataMax + 2"]} />
            <ReferenceLine x={alertDate} stroke="var(--aqua)" strokeWidth={22} strokeOpacity={0.25} />
            <ReferenceLine x={alertDate} stroke="var(--aqua)" strokeWidth={2} />
            <Area type="monotone" dataKey="avg" stroke="var(--line)" strokeWidth={3} fill={`url(#fill-${id})`} connectNulls={false} isAnimationActive={false} dot={false} activeDot={false} />
            <Line type="monotone" dataKey="normal" stroke="var(--muted)" strokeWidth={2} strokeDasharray="6 6" dot={false} isAnimationActive={false} activeDot={false} />
            <Line dataKey="count" stroke="none" dot={{ r: 2.6, fill: "var(--line)", fillOpacity: 0.4, stroke: "none" }} isAnimationActive={false} activeDot={{ r: 5, fill: "var(--line)" }} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--map-line)" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {note && <p className="flex items-center gap-2 text-sm text-muted"><Clock className="size-4 shrink-0" aria-hidden="true" />{note}</p>}
    </figure>
  );
}
