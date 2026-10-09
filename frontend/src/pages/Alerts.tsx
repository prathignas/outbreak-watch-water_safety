import { motion } from "framer-motion";
import { ArrowLeft, Check, CircleCheck, Lock, MessageSquarePlus, Siren } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "@/api/client";
import type { AlertRecord, AlertStatus } from "@/api/types";
import type { CauseType } from "@/contract/types";
import { CauseDot, CauseLabel, SourceBadge, StatusChip, TriageHintLabel } from "@/components/Chips";
import { CountUp } from "@/components/CountUp";
import { Ring } from "@/components/Ring";
import { HonestyPill, PageHeader } from "@/components/Shell";
import { SignalChart } from "@/components/SignalChart";
import { SoftCard } from "@/components/SoftCard";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/States";
import { useTouchFeedback } from "@/components/touch";
import { ZoneMiniMap } from "@/components/ZoneMiniMap";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAlert, useAlertAction, useAlerts, useCity, useRain, useRisk, useToday, useWardSignals } from "@/hooks/queries";
import { useNewAlerts } from "@/hooks/useNewAlerts";
import { cityLookup } from "@/lib/city";
import { CAUSE_LABEL, CAUSES, cap, fmtDay, fmtLong, fmtTime, pct, topCause, wardStatuses } from "@/lib/format";
import { useWardsGeo, useZonesGeo } from "@/lib/geo";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<{ value: AlertStatus | "all"; label: string; icon: typeof Siren }> = [
  { value: "open", label: "Open", icon: Siren },
  { value: "acknowledged", label: "Acknowledged", icon: Check },
  { value: "resolved", label: "Resolved", icon: CircleCheck },
];
const STATUS_TEXT: Record<AlertStatus, string> = { open: "Open alert", acknowledged: "Acknowledged", resolved: "Resolved" };

function AlertCard({ record, selected, fresh, wardName, zoneLabel }: { record: AlertRecord; selected: boolean; fresh: boolean; wardName: string; zoneLabel: string }) {
  const fb = useTouchFeedback();
  const c = topCause(record.alert.causeProbs);
  return (
    <motion.div animate={fb.animate} className="rounded-card">
      <Link to={`/alerts/${record.id}`} {...fb.handlers} aria-current={selected ? "true" : undefined}
        className={cn("soft-btn edge card-link relative grid grid-cols-[4.75rem_1fr] items-center gap-4 rounded-card px-5 py-4 text-ink no-underline", fb.shineClass, fresh && "new-glow")}>
        <Ring value={record.alert.score} size={76} stroke={9} color="var(--alert-ring)" label={`${pct(record.alert.score)} chance of an outbreak`}>
          <span className="font-display text-[1.0625rem] leading-5 font-bold">{pct(record.alert.score)}</span>
        </Ring>
        <span className="min-w-0">
          <span className="block truncate text-lg font-bold">{wardName}</span>
          <span className="block text-sm text-muted">Ward {record.alert.wardId}, {zoneLabel}, {fmtDay(record.alert.date)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <CauseDot cause={c} />Triage hint: {CAUSE_LABEL[c]} {pct(record.alert.causeProbs[c])}
            {record.status !== "open" && <span className="font-bold text-ink">, {STATUS_TEXT[record.status].toLowerCase()}</span>}
          </span>
        </span>
      </Link>
    </motion.div>
  );
}

function NoteDialog({ open, onOpenChange, onSave, saving }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (t: string) => void; saving: boolean }) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onSave(text.trim());
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setText(""); }}>
      <DialogContent aria-describedby="note-desc">
        <DialogTitle>Add a note</DialogTitle>
        <DialogDescription id="note-desc">Record what you checked or did. It appears in the activity log with your name.</DialogDescription>
        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-2">
            <span className="font-bold">Note</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} className="soft-in rounded-btn p-4 text-ink outline-none" />
          </label>
          <Button type="submit" variant="primary" className="justify-self-start" disabled={!text.trim() || saving}><MessageSquarePlus aria-hidden="true" />Save note</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AlertDetail({ id }: { id: string }) {
  const record = useAlert(id);
  const today = useToday();
  const city = useCity();
  const alerts = useAlerts();
  const risk = useRisk();
  const rain = useRain(14);
  const wardsGeo = useWardsGeo();
  const zonesGeo = useZonesGeo();
  const action = useAlertAction();
  const [noteOpen, setNoteOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const signals = useWardSignals(record.data?.alert.wardId, today);
  const lookup = cityLookup(city.data);
  const statuses = useMemo(() => wardStatuses(risk.data, alerts.data), [risk.data, alerts.data]);

  if (record.isError) {
    return record.error instanceof ApiError && record.error.status === 404
      ? <EmptyState title="This alert does not exist" body="It may have been removed by a demo reset." action={<Link to="/alerts" className={buttonVariants({ size: "sm" })}><ArrowLeft aria-hidden="true" />Back to alerts</Link>} />
      : <ErrorState title="Could not load the alert" error={record.error} onRetry={() => record.refetch()} />;
  }
  if (!record.data) return <LoadingBlock label="Loading the alert" />;
  const r = record.data;
  const a = r.alert;
  const ward = lookup.ward(a.wardId);
  const zone = lookup.zone(a.suspectedZoneId);
  const tc = topCause(a.causeProbs);
  const reasons = r.causeEvidence.filter((e) => !e.startsWith("triage hint"));
  const rainMax = Math.max(1, ...(rain.data ?? []).map((x) => x.mm));
  const zoneAlerting = zone ? zone.wardIds.filter((w) => statuses.get(w) === "alert").length : 0;
  // Wards in this ward's own water zone with an alert not yet resolved (the newest alert per ward).
  const homeZone = lookup.zone(ward?.zoneId);
  const zoneAlerts = homeZone
    ? [...new Map((alerts.data ?? [])
        .filter((x) => x.status !== "resolved" && homeZone.wardIds.includes(x.alert.wardId))
        .sort((x, y) => x.alert.date.localeCompare(y.alert.date))
        .map((x) => [x.alert.wardId, x])).values()]
    : [];

  const act = (v: Parameters<typeof action.mutate>[0], done: string, after?: () => void) =>
    action.mutate(v, {
      onSuccess: () => { setMessage(done); after?.(); },
      onError: (e) => setMessage(e instanceof Error ? e.message : "That did not work."),
    });

  return (
    <SoftCard size="lg" touch={false} className="grid gap-8 p-6 md:p-8" aria-labelledby="detail-h">
      <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto]">
        <div className="grid justify-items-start gap-3">
          <Link to="/alerts" className="inline-flex items-center gap-2 text-sm xl:hidden"><ArrowLeft className="size-4" aria-hidden="true" />All alerts</Link>
          <StatusChip status={r.status === "resolved" ? "calm" : "alert"}>{STATUS_TEXT[r.status]}</StatusChip>
          <h2 id="detail-h" className="text-3xl font-bold md:text-4xl">{lookup.wardName(a.wardId)}</h2>
          <p className="text-muted">
            Ward {a.wardId}, {lookup.zoneLabel(ward?.zoneId)}{zone ? `; suspected zone ${zone.name} (zone ${zone.id})` : ""}. Raised {fmtLong(a.date)} by the daily {a.method === "bayes" ? "Bayes" : a.method} detector run.
          </p>
          {homeZone && zoneAlerts.length > 0 && (
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <b>{zoneAlerts.length} {zoneAlerts.length === 1 ? "ward" : "wards"} in zone {homeZone.name} {zoneAlerts.length === 1 ? "is" : "are"} alerting:</b>
              {zoneAlerts.map((x) => x.id === id
                ? <span key={x.id} className="text-muted">{lookup.wardName(x.alert.wardId)} (this alert)</span>
                : <Link key={x.id} to={`/alerts/${x.id}`}>{lookup.wardName(x.alert.wardId)}</Link>)}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-4">
            <Button variant="primary" disabled={r.status !== "open" || action.isPending} onClick={() => act({ id, action: "ack" }, "Acknowledged. Your name is in the activity log.")}><Check aria-hidden="true" />Acknowledge</Button>
            <Button disabled={r.status === "resolved" || action.isPending} onClick={() => act({ id, action: "resolve" }, "Resolved. Your name is in the activity log.")}><CircleCheck aria-hidden="true" />Resolve</Button>
            <Button disabled={action.isPending} onClick={() => setNoteOpen(true)}><MessageSquarePlus aria-hidden="true" />Add note</Button>
          </div>
          <p role="status" aria-live="polite" className="min-h-6 text-sm text-muted">{message}</p>
        </div>
        <Ring value={a.score} size={232} stroke={22} color="var(--alert-ring)" label={`${pct(a.score)} chance of an outbreak`}>
          <span className="font-display text-5xl font-bold"><CountUp value={Math.round(a.score * 100)} suffix="%" /></span>
          <span className="max-w-[8.75rem] text-muted">chance of an outbreak</span>
        </Ring>
      </div>

      <section aria-labelledby="sig-h" className="grid gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h3 id="sig-h" className="text-xl font-bold">Signals, last 8 weeks</h3>
          <ul className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted" aria-label="Chart key">
            <li className="flex items-center gap-2"><span className="size-2 rounded-full bg-[var(--line)] opacity-50" aria-hidden="true" />Daily count</li>
            <li className="flex items-center gap-2"><span className="w-6 border-t-[3px] border-[var(--line)]" aria-hidden="true" />3-day average</li>
            <li className="flex items-center gap-2"><span className="w-6 border-t-2 border-dashed border-[var(--muted)]" aria-hidden="true" />Normal for that weekday</li>
            <li className="flex items-center gap-2"><span className="size-4 rounded-full bg-[var(--aqua)] opacity-50" aria-hidden="true" />Alert day</li>
          </ul>
        </div>
        {signals.isError ? <ErrorState title="Could not load the signals" error={signals.error} onRetry={() => signals.refetch()} />
          : !signals.data || !today ? <LoadingBlock label="Loading signals" />
          : (["complaint", "pharmacy", "hospital"] as const).map((s) => <SignalChart key={s} rows={signals.data} signal={s} today={today} alertDate={a.date} />)}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <SoftCard size="sm" className="grid content-start gap-4 p-6" aria-labelledby="cause-h">
          <div className="flex flex-wrap items-center gap-3"><h3 id="cause-h" className="text-xl font-bold">Likely cause</h3><TriageHintLabel /></div>
          <ul className="grid gap-3">
            {[...CAUSES].sort((x, y) => a.causeProbs[y] - a.causeProbs[x]).map((c: CauseType) => (
              <li key={c} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_44px] items-center gap-3 sm:grid-cols-[150px_1fr_52px]">
                <CauseLabel cause={c} />
                <span className="soft-in relative block h-3.5 overflow-hidden rounded-full" aria-hidden="true">
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(3, a.causeProbs[c] * 100)}%`, background: `var(--c-${c})` }} />
                </span>
                <span className="text-right font-bold tabular">{pct(a.causeProbs[c])}</span>
              </li>
            ))}
          </ul>
          {reasons.length > 0 && (
            <ul className="grid gap-2 text-sm" aria-label="Why this hint">
              {reasons.map((e) => <li key={e} className="relative pl-4 before:absolute before:top-2 before:left-0 before:size-1.5 before:rounded-full before:bg-[var(--teal)]">{cap(e)}</li>)}
            </ul>
          )}
          <p className="text-sm text-muted">Most likely {CAUSE_LABEL[tc].toLowerCase()} ({pct(a.causeProbs[tc])}). An officer must confirm the cause.</p>
        </SoftCard>
        <div className="grid content-start gap-6">
          <SoftCard size="sm" className="grid gap-3 p-6" aria-labelledby="ev-h">
            <h3 id="ev-h" className="text-xl font-bold">Why the detector alerted</h3>
            <ul className="grid gap-2">
              {a.evidence.map((e) => <li key={e} className="relative pl-4 before:absolute before:top-2.5 before:left-0 before:size-1.5 before:rounded-full before:bg-[var(--teal)]">{cap(e)}</li>)}
            </ul>
          </SoftCard>
          <SoftCard size="sm" className="grid gap-4 p-6" aria-labelledby="act-h">
            <h3 id="act-h" className="text-xl font-bold">Activity</h3>
            <ol className="grid gap-4">
              {r.events.map((ev, i) => (
                <li key={i} className="grid grid-cols-[2.75rem_1fr] items-start gap-3">
                  <span className="soft-sm grid size-11 place-items-center rounded-full text-teal" aria-hidden="true">
                    {ev.kind === "raised" ? <Siren className="size-5" /> : ev.kind === "note" ? <MessageSquarePlus className="size-5" /> : ev.kind === "resolved" ? <CircleCheck className="size-5" /> : <Check className="size-5" />}
                  </span>
                  <div>
                    <p><b>{ev.kind === "raised" ? "Raised" : ev.kind === "note" ? "Note" : cap(ev.kind)}</b> by {ev.by}</p>
                    {ev.text && <p className="whitespace-pre-wrap">{ev.text}</p>}
                    <p className="text-sm text-muted">{ev.kind === "raised" ? `${fmtLong(a.date)}, daily run` : fmtTime(ev.at)}</p>
                  </div>
                </li>
              ))}
              {r.events.length === 1 && <li className="text-sm text-muted"><Lock className="mr-2 inline size-4" aria-hidden="true" />No notes yet. Use Add note to record what you checked.</li>}
            </ol>
          </SoftCard>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <SoftCard size="sm" className="grid content-start gap-3 p-6" aria-labelledby="zone-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="zone-h" className="text-xl font-bold">{zone ? `Suspected zone ${zone.name}` : "Water zone"}</h3>
            {zone && <span className="text-sm text-muted">Zone {zone.id}, {zone.wardIds.length} wards, {zoneAlerting} on alert</span>}
          </div>
          {!zone ? <p className="text-muted">The classifier did not single out a water zone for this alert.</p>
            : wardsGeo.data && zonesGeo.data && city.data
              ? <ZoneMiniMap zoneId={zone.id} wards={wardsGeo.data} zones={zonesGeo.data} city={city.data} statuses={statuses} label={`Map of suspected water zone ${zone.name} and the wards around it`} />
              : <LoadingBlock label="Loading the zone map" />}
        </SoftCard>
        <SoftCard size="sm" className="grid content-start gap-3 p-6" aria-labelledby="rain-h">
          <div className="flex items-center gap-3"><h3 id="rain-h" className="text-xl font-bold">Rain, last 14 days</h3><SourceBadge tag="real" /></div>
          {rain.isError ? <ErrorState title="Could not load rain" error={rain.error} onRetry={() => rain.refetch()} /> : !rain.data ? <LoadingBlock label="Loading rain" /> : rain.data.length === 0 ? (
            <p className="text-muted">No rain values for these days yet.</p>
          ) : (
            <>
              <svg viewBox="0 0 420 104" className="h-auto w-full" role="img" aria-label={`Daily rain, last ${rain.data.length} days. Highest ${rainMax} mm.`}>
                {rain.data.map((x, i) => {
                  const h = Math.max(10, (x.mm / rainMax) * 88);
                  return (
                    <g key={x.date}>
                      <rect x={i * 30 + 5} y={100 - h} width="20" height={h} rx="10" fill="var(--rain)"><title>{`${fmtDay(x.date)}: ${x.mm} mm`}</title></rect>
                    </g>
                  );
                })}
              </svg>
              <div className="flex justify-between text-sm text-muted" aria-hidden="true">
                <span>{fmtDay(rain.data[0].date)}</span><span>{fmtDay(rain.data[Math.floor(rain.data.length / 2)].date)}</span><span>{fmtDay(rain.data[rain.data.length - 1].date)}</span>
              </div>
              <p className="text-sm text-muted">
                Highest {rainMax} mm. {rainMax < 15.6 ? "No day reached moderate rain (15.6 mm). " : ""}One value for the whole city. <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a>
              </p>
            </>
          )}
        </SoftCard>
      </div>
      <NoteDialog open={noteOpen} onOpenChange={setNoteOpen} saving={action.isPending}
        onSave={(text) => act({ id, action: "note", text }, "Note saved.", () => setNoteOpen(false))} />
    </SoftCard>
  );
}

export function AlertsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const alerts = useAlerts();
  const city = useCity();
  const fresh = useNewAlerts(alerts.data);
  const lookup = cityLookup(city.data);
  const [status, setStatus] = useState<AlertStatus | "all">("open");
  const [cause, setCause] = useState<CauseType | "all">("all");
  const count = (s: AlertStatus) => alerts.data?.filter((a) => a.status === s).length ?? 0;
  const shown = (alerts.data ?? []).filter((a) => (status === "all" || a.status === status) && (cause === "all" || topCause(a.alert.causeProbs) === cause));

  return (
    <>
      <PageHeader title="Alerts"><HonestyPill /></PageHeader>
      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Filter alerts">
        {STATUS_FILTERS.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}
            className={cn("soft-btn inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm", status === value && "font-bold text-teal")}>
            <Icon className="size-[1.125rem]" aria-hidden="true" />{label} {count(value as AlertStatus)}
          </button>
        ))}
        <button type="button" aria-pressed={status === "all"} onClick={() => setStatus("all")} className={cn("soft-btn h-11 rounded-full px-4 text-sm", status === "all" && "font-bold text-teal")}>All {alerts.data?.length ?? 0}</button>
        <span className="mx-1 hidden h-7 w-px bg-[var(--map-line)] md:block" aria-hidden="true" />
        <button type="button" aria-pressed={cause === "all"} onClick={() => setCause("all")} className={cn("soft-btn h-11 rounded-full px-4 text-sm", cause === "all" && "font-bold text-teal")}>All causes</button>
        {CAUSES.map((c) => (
          <button key={c} type="button" aria-pressed={cause === c} onClick={() => setCause(c)}
            className={cn("soft-btn inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm", cause === c && "font-bold text-teal")}>
            <CauseDot cause={c} />{CAUSE_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12 xl:gap-8">
        <section aria-label="Alert list, newest first" className={cn("xl:col-span-4", id && "hidden xl:block")}>
          {alerts.isError ? <ErrorState title="Could not load alerts" error={alerts.error} onRetry={() => alerts.refetch()} />
            : !alerts.data ? <LoadingBlock label="Loading alerts" />
            : shown.length === 0 ? (
              <EmptyState title="No alerts match these filters" body={alerts.data.length ? "Try another status or cause." : "No alerts yet. Use Demo to plant a simulated outbreak."}
                action={<Button size="sm" onClick={() => { setStatus("all"); setCause("all"); }}>Show all alerts</Button>} />
            ) : (
              <ul className="grid gap-5">
                {shown.map((r) => (
                  <li key={r.id}>
                    <AlertCard record={r} selected={r.id === id} fresh={fresh.has(r.id)} wardName={lookup.wardName(r.alert.wardId)} zoneLabel={lookup.zoneLabel(lookup.ward(r.alert.wardId)?.zoneId)} />
                  </li>
                ))}
              </ul>
            )}
        </section>
        <div className={cn("xl:col-span-8", !id && "hidden xl:block")}>
          {id ? <AlertDetail id={id} /> : (
            <SoftCard size="lg" className="p-8">
              <EmptyState title="Pick an alert" body="Choose an alert on the left to see its signals, likely cause and evidence."
                action={alerts.data?.[0] && <Button variant="primary" size="sm" onClick={() => navigate(`/alerts/${alerts.data![0].id}`)}>Open the newest alert</Button>} />
            </SoftCard>
          )}
        </div>
      </div>
    </>
  );
}
