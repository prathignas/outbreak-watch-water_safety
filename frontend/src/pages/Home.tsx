import { BadgeCheck, Bell, ChevronRight, CloudRain, Eye } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { buttonVariants } from "@/components/ui/button";
import { StatusChip, SourceBadge } from "@/components/Chips";
import { CountUp } from "@/components/CountUp";
import { Ring } from "@/components/Ring";
import { HonestyPill, PageHeader } from "@/components/Shell";
import { SoftCard } from "@/components/SoftCard";
import { ErrorState, LoadingBlock, Skeleton } from "@/components/States";
import { useAlerts, useBacktest, useCity, useRain, useRisk, useToday } from "@/hooks/queries";
import { cityLookup } from "@/lib/city";
import { addDays, fmtDay, pct, wardStatuses, WATCH_LINE } from "@/lib/format";
import { headlineWater } from "@/lib/headline";
import { cn } from "@/lib/utils";

/** A Home tile. With `to`, the whole card opens that page (same target as its button) and lifts on hover. */
function Tile({ icon: Icon, title, badge, to, children }: { icon: typeof Bell; title: string; badge?: React.ReactNode; to?: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const openTile = (e: React.MouseEvent) => {
    // The tile's own links and buttons handle their clicks; anywhere else on the card opens `to`.
    if (!to || (e.target as HTMLElement).closest("a, button")) return;
    void navigate(to);
  };
  return (
    <SoftCard touch={!to} onClick={openTile} className={cn("flex h-full min-h-0 flex-col gap-2 overflow-hidden p-6 md:p-[min(2rem,2.6vh)]", to && "card-link")} aria-label={title}>
      <div className="flex items-center gap-3">
        <Icon className="size-5 text-teal" aria-hidden="true" />
        <h2 className="text-lg font-bold">{title}</h2>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      {children}
    </SoftCard>
  );
}

const big = "font-display text-4xl font-bold md:text-[3rem] md:leading-[3.5rem]";

export function HomePage() {
  const today = useToday();
  const risk = useRisk();
  const alerts = useAlerts();
  const city = useCity();
  const rain = useRain(14);
  const backtest = useBacktest();
  const lookup = cityLookup(city.data);
  const statuses = wardStatuses(risk.data, alerts.data);
  const counts = { calm: 0, watch: 0, alert: 0 };
  for (const s of statuses.values()) counts[s]++;
  const total = statuses.size;
  const open = alerts.data?.filter((a) => a.status === "open") ?? [];
  const raisedToday = alerts.data?.filter((a) => a.alert.date === today) ?? [];
  const topWatch = [...(risk.data ?? [])].filter((r) => statuses.get(r.wardId) === "watch").sort((a, b) => b.probability - a.probability)[0];
  // Today's value, or else the latest day that has one. Never a made-up number.
  const rainLatest = rain.data?.at(-1);
  const rainDayLabel = !rainLatest || !today ? "" : rainLatest.date === today ? "Today" : rainLatest.date === addDays(today, -1) ? "Yesterday" : fmtDay(rainLatest.date);
  const rainMax = Math.max(1, ...(rain.data ?? []).map((r) => r.mm));
  const water = backtest.data?.summary.find((r) => r.method === "bayes" && r.difficulty === "realistic" && r.budget === 0.25 && r.cause === "water" && r.subset === "all");
  const alertsHref = open[0] ? `/alerts/${open[0].id}` : "/alerts";
  const waterChance = backtest.data?.chanceCheck?.rows.find((r) => r.method === "bayes" && r.difficulty === "realistic" && r.budget === 0.25 && r.cause === "water");

  return (
    <>
      <PageHeader brand><HonestyPill /></PageHeader>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:min-h-0 xl:flex-1 xl:grid-cols-12 xl:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-[min(2rem,2.8vh)]">
        <SoftCard size="lg" touch={false} className="flex flex-col items-center gap-3 p-6 text-center md:col-span-2 xl:col-span-6 xl:row-span-2 xl:min-h-0 xl:justify-center xl:overflow-hidden xl:p-[min(2rem,2.6vh)]" aria-labelledby="health-h">
          <h2 id="health-h" className="text-2xl font-bold">City water health today</h2>
          <p className="text-muted">Share of wards calm. Relative risk from simulated health data.</p>
          {risk.isError ? (
            <ErrorState title="Could not load ward risk" error={risk.error} onRetry={() => risk.refetch()} />
          ) : !risk.data ? (
            <Skeleton className="my-6 size-[16.25rem] rounded-full xl:size-[21.25rem]" />
          ) : (
            <>
              <div className="my-3 hidden xl:block">
                <Ring value={counts.calm / total} size={340} stroke={30} label={`${pct(counts.calm / total)} of wards calm`}>
                  <span className="font-display text-5xl font-bold"><CountUp value={Math.round((counts.calm / total) * 100)} suffix="%" /></span>
                  <span className="text-muted">of wards calm</span>
                </Ring>
              </div>
              <div className="my-3 xl:hidden">
                <Ring value={counts.calm / total} size={220} stroke={20} label={`${pct(counts.calm / total)} of wards calm`}>
                  <span className="font-display text-4xl font-bold"><CountUp value={Math.round((counts.calm / total) * 100)} suffix="%" /></span>
                  <span className="text-sm text-muted">of wards calm</span>
                </Ring>
              </div>
              <ul className="flex flex-wrap justify-center gap-3" aria-label="Wards by status">
                <li><StatusChip status="calm">Calm {counts.calm}</StatusChip></li>
                <li><StatusChip status="watch">Watch {counts.watch}</StatusChip></li>
                <li><StatusChip status="alert">Alert {counts.alert}</StatusChip></li>
              </ul>
            </>
          )}
        </SoftCard>

        <div className="h-full xl:col-span-3 xl:min-h-0">
          <Tile icon={Bell} title="Open alerts" to={alertsHref}>
            {alerts.isError ? <ErrorState title="Could not load alerts" error={alerts.error} onRetry={() => alerts.refetch()} /> : !alerts.data ? <LoadingBlock label="Loading alerts" /> : (
              <>
                <div className={big}><CountUp value={open.length} /></div>
                <p className="text-muted">{raisedToday.length === 0 ? "None raised today." : `${raisedToday.length} raised today.`}</p>
                {open[0] ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm"><StatusChip status="alert">Newest</StatusChip><span><b>{lookup.wardName(open[0].alert.wardId)}</b>, {pct(open[0].alert.score)} chance</span></p>
                ) : <p className="text-sm text-muted">No open alerts. The map shows every ward's relative risk.</p>}
                <Link to={alertsHref} className={buttonVariants({ size: "sm", className: "mt-auto self-start" })}><ChevronRight aria-hidden="true" />View alerts</Link>
              </>
            )}
          </Tile>
        </div>
        <div className="h-full xl:col-span-3 xl:min-h-0">
          <Tile icon={Eye} title="Wards on watch" to="/map">
            {!risk.data ? <LoadingBlock label="Loading ward risk" /> : (
              <>
                <div className={big}><CountUp value={counts.watch} /></div>
                <p className="text-muted">Relative risk between {pct(WATCH_LINE)} and the alert line.</p>
                {topWatch && <p className="flex flex-wrap items-center gap-2 text-sm"><StatusChip status="watch">Highest</StatusChip><span><b>{lookup.wardName(topWatch.wardId)}</b>, relative risk {pct(topWatch.probability)}</span></p>}
                <Link to="/map" className={buttonVariants({ size: "sm", className: "mt-auto self-start" })}><ChevronRight aria-hidden="true" />Open map</Link>
              </>
            )}
          </Tile>
        </div>
        <div className="h-full xl:col-span-3 xl:min-h-0">
          <Tile icon={CloudRain} title="Rain" badge={<SourceBadge tag="real" />}>
            {rain.isError ? <ErrorState title="Rain data not available" error={rain.error} onRetry={() => rain.refetch()} /> : !rain.data ? <LoadingBlock label="Loading rain" /> : !rainLatest ? (
              <p className="text-muted">Rain data not available</p>
            ) : (
              <>
                <div className={big}><span className="mr-2 text-xl font-semibold text-muted">{rainDayLabel}:</span><CountUp value={rainLatest.mm} decimals={1} /><span className="ml-1 text-xl font-semibold text-muted">mm</span></div>
                <svg viewBox="0 0 280 56" className="h-14 w-full min-h-0 shrink" role="img" aria-label={`Rain, last ${rain.data.length} days, highest ${rainMax} mm`}>
                  {rain.data.map((r, i) => {
                    const h = Math.max(6, (r.mm / rainMax) * 48);
                    return <rect key={r.date} x={i * 20 + 2} y={52 - h} width="12" height={h} rx="6" fill="var(--rain)" />;
                  })}
                </svg>
                <p className="mt-auto text-sm text-muted">Last 14 days. <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a></p>
              </>
            )}
          </Tile>
        </div>
        <div className="h-full xl:col-span-3 xl:min-h-0">
          <Tile icon={BadgeCheck} title="How well it works" to="/proof">
            {!backtest.data || !water?.detectionRate ? <LoadingBlock label="Loading results" /> : (
              <>
                <div className="flex items-center gap-4">
                  <div className="hidden sm:block">
                    <Ring value={water.detectionRate.median} size={88} stroke={10} label={`${pct(water.detectionRate.median)} of water outbreaks found`}>
                      <span className="font-display text-lg font-bold">{pct(water.detectionRate.median)}</span>
                    </Ring>
                  </div>
                  <div>
                    <p><b>{pct(water.detectionRate.median)}</b> of water outbreaks found</p>
                    <p className="text-muted">By chance: {waterChance?.phantomDetectionRate ? pct(waterChance.phantomDetectionRate.median) : "not computed"}</p>
                  </div>
                </div>
                <table className="w-full text-[0.8125rem] leading-5">
                  <caption className="sr-only">Water outbreaks found, and days to first alert</caption>
                  <thead className="text-muted"><tr><th scope="col" className="text-left font-normal">Method</th><th scope="col" className="text-right font-normal">Found</th><th scope="col" className="text-right font-normal">Days to alert</th></tr></thead>
                  <tbody className="tabular">
                    {headlineWater(backtest.data).map((h) => <tr key={h.id}><th scope="row" className="text-left">{h.name}</th><td className="text-right">{h.found}</td><td className="text-right">{h.days}</td></tr>)}
                  </tbody>
                </table>
                <p className="text-[0.8125rem] leading-5 text-muted">Simulated outbreaks; realistic, 0.25 false alarms per ward-year; {backtest.data.seeds.length} seeds.</p>
                <Link to="/proof" className={buttonVariants({ size: "sm", className: "mt-auto self-start" })}><ChevronRight aria-hidden="true" />See the proof</Link>
              </>
            )}
          </Tile>
        </div>
      </div>
    </>
  );
}
