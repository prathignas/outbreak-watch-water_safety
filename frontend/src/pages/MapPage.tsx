import { ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTheme } from "@/app/theme";
import { CityMap } from "@/components/CityMap";
import { StatusChip, STATUS_ICON } from "@/components/Chips";
import { HonestyPill, PageHeader } from "@/components/Shell";
import { SoftCard } from "@/components/SoftCard";
import { ErrorState, LoadingBlock } from "@/components/States";
import { buttonVariants } from "@/components/ui/button";
import { useAlerts, useCity, useRisk } from "@/hooks/queries";
import { useNewAlerts } from "@/hooks/useNewAlerts";
import { cityLookup } from "@/lib/city";
import { pct, STATUS_LABEL, WATCH_LINE, wardStatuses, type WardStatus } from "@/lib/format";
import { useWardsGeo, useZonesGeo } from "@/lib/geo";

function Legend() {
  const swatch: Record<WardStatus, string> = { calm: "var(--map-calm)", watch: "var(--map-watch)", alert: "var(--map-alert)" };
  const text: Record<WardStatus, string> = { calm: `Calm, under ${pct(WATCH_LINE)}`, watch: `Watch, ${pct(WATCH_LINE)} to alert line`, alert: "Alert, outlined with a marker" };
  return (
    <ul className="soft edge grid gap-2 rounded-card p-4 text-sm" aria-label="Map legend">
      {(["calm", "watch", "alert"] as const).map((s) => {
        const Icon = STATUS_ICON[s];
        return (
          <li key={s} className="flex items-center gap-2">
            <span className="size-4 rounded" style={{ background: swatch[s], outline: s === "alert" ? "2px solid var(--alert-outline)" : undefined }} aria-hidden="true" />
            <Icon className="size-4" aria-hidden="true" />{text[s]}
          </li>
        );
      })}
      <li className="flex items-center gap-2"><span className="h-0 w-4 border-t border-[var(--muted)]" aria-hidden="true" />BWSSB water zone</li>
      <li className="flex items-center gap-2"><span className="size-4 rounded border-2 border-[var(--teal)] shadow-[0_0_8px_var(--aqua)]" aria-hidden="true" />Suspected zone</li>
    </ul>
  );
}

export function MapPage() {
  const { theme } = useTheme();
  const city = useCity();
  const risk = useRisk();
  const alerts = useAlerts();
  const wardsGeo = useWardsGeo();
  const zonesGeo = useZonesGeo();
  const [selected, setSelected] = useState<number | null>(null);
  const fresh = useNewAlerts(alerts.data);
  const lookup = cityLookup(city.data);
  const statuses = useMemo(() => wardStatuses(risk.data, alerts.data), [risk.data, alerts.data]);
  const active = (alerts.data ?? []).filter((a) => a.status !== "resolved");
  const suspected = useMemo(() => [...new Set(active.map((a) => a.alert.suspectedZoneId).filter((z): z is number => z !== null))], [active]);
  const newWards = useMemo(() => (alerts.data ?? []).filter((a) => fresh.has(a.id)).map((a) => a.alert.wardId), [alerts.data, fresh]);
  const listed = [...statuses.entries()].filter(([, s]) => s !== "calm")
    .sort((a, b) => (a[1] === b[1] ? (risk.data?.find((r) => r.wardId === b[0])?.probability ?? 0) - (risk.data?.find((r) => r.wardId === a[0])?.probability ?? 0) : a[1] === "alert" ? -1 : 1));
  const sel = selected !== null ? lookup.ward(selected) : undefined;
  const selAlert = selected !== null ? active.find((a) => a.alert.wardId === selected) : undefined;
  const loading = !city.data || !wardsGeo.data || !zonesGeo.data;
  const error = city.error ?? wardsGeo.error ?? zonesGeo.error ?? risk.error;

  return (
    <>
      <PageHeader title="Map"><HonestyPill /></PageHeader>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 xl:gap-8">
        <SoftCard size="lg" touch={false} className="relative h-[min(72vh,760px)] min-h-[26.25rem] p-3 xl:col-span-9" aria-labelledby="map-h">
          <h2 id="map-h" className="sr-only">Wards by relative risk</h2>
          {error ? <div className="p-6"><ErrorState title="Could not load the map" error={error} onRetry={() => { void city.refetch(); void wardsGeo.refetch(); void zonesGeo.refetch(); void risk.refetch(); }} /></div>
            : loading ? <LoadingBlock label="Loading the map" className="p-6" /> : (
              <CityMap wards={wardsGeo.data!} zones={zonesGeo.data!} city={city.data!} statuses={statuses} risk={risk.data} suspectedZones={suspected}
                newAlertWards={newWards} selectedWard={selected} onSelectWard={setSelected} theme={theme}
                label="Map of 243 wards by relative risk (simulated health data). Use the list beside the map to pick a ward with the keyboard." />
            )}
          <div className="pointer-events-none absolute top-6 left-6 flex flex-col gap-3">
            <p className="soft pointer-events-auto max-w-[calc(100vw-120px)] rounded-card px-4 py-2 text-sm font-bold md:max-w-none md:rounded-full">Relative risk (simulated health data)</p>
            <div className="pointer-events-auto hidden md:block"><Legend /></div>
          </div>
        </SoftCard>
        <div className="flex flex-col gap-6 xl:col-span-3">
          {sel && (
            <SoftCard className="flex flex-col gap-3 p-6" aria-live="polite" aria-label={`Selected ward ${sel.name}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{sel.name}</h2>
                  <p className="text-sm text-muted">Ward {sel.id}, {lookup.zoneLabel(sel.zoneId)}</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="soft-btn inline-flex size-11 items-center justify-center rounded-full" aria-label="Close ward card"><X className="size-5" aria-hidden="true" /></button>
              </div>
              <StatusChip status={statuses.get(sel.id) ?? "calm"} />
              <p>Relative risk {pct(risk.data?.find((r) => r.wardId === sel.id)?.probability ?? 0)}</p>
              {selAlert
                ? <Link to={`/alerts/${selAlert.id}`} className={buttonVariants({ variant: "primary", size: "sm", className: "self-start" })}><ChevronRight aria-hidden="true" />Open its alert</Link>
                : <p className="text-sm text-muted">No open alert for this ward.</p>}
            </SoftCard>
          )}
          <div className="md:hidden"><Legend /></div>
          <SoftCard className="flex flex-col gap-3 p-6" aria-labelledby="list-h">
            <h2 id="list-h" className="text-xl font-bold">Wards on alert or watch</h2>
            {!risk.data ? <LoadingBlock label="Loading wards" /> : listed.length === 0 ? <p className="text-muted">Every ward is calm today.</p> : (
              <ul className="grid max-h-[30rem] gap-2 overflow-y-auto pr-1">
                {listed.map(([id, s]) => {
                  const Icon = STATUS_ICON[s];
                  return (
                    <li key={id}>
                      <button type="button" onClick={() => setSelected(id)} aria-pressed={selected === id}
                        className="soft-btn flex w-full items-center gap-3 rounded-btn px-4 py-2 text-left">
                        <Icon className="size-5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{lookup.wardName(id)}</span>
                        <span className="text-sm text-muted">{STATUS_LABEL[s]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </SoftCard>
        </div>
      </div>
    </>
  );
}
