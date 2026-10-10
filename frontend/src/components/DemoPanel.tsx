import { FastForward, FlaskConical, KeyRound, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { getSession, setDemoKey } from "@/api/session";
import type { InjectableCause } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCity, useDemoActions, useDemoState } from "@/hooks/queries";
import { cityLookup } from "@/lib/city";
import { addDays, CAUSE_LABEL, fmtDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CauseDot } from "./Chips";

const CAUSES: InjectableCause[] = ["water", "food", "p2p"];
/* When the planted outbreak starts. "Today" is not offered: tested on the live detector
 * (2026-10-10, 3 wards) it raises no alert on the day an outbreak starts (relative risk under 1%);
 * from 2 days the ward turns Watch, and from 3 to 4 days back the alert is raised. */
const STARTS = [
  { daysAgo: 2, label: "2 days ago", note: "usually Watch on the map, not yet an alert" },
  { daysAgo: 4, label: "4 days ago", note: "the alert is raised" },
] as const;
const DEFAULT_DAYS_AGO = 4;

const daysAgoText = (n: number) => (n === 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`);

interface Placed { cause: InjectableCause; wardName: string; startDate: string; daysAgo: number; appearsAfterMs: number }

/** Demo controls (Shift+D or the Demo button). Fast-forward exists in mock mode only. */
export function DemoPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const city = useCity();
  const lookup = cityLookup(city.data);
  const demo = useDemoState();
  const { inject, reset, advance, canAdvance } = useDemoActions();
  const [cause, setCause] = useState<InjectableCause>("water");
  const [wardId, setWardId] = useState("18");
  const [daysAgo, setDaysAgo] = useState<number>(DEFAULT_DAYS_AGO);
  const [message, setMessage] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const wards = useMemo(() => [...lookup.wards].sort((a, b) => a.name.localeCompare(b.name)), [lookup.wards]);
  const busy = inject.isPending || reset.isPending || advance.isPending;
  // Reset and Inject need the demo key (never in the build). The judge link (/demo#key=...)
  // stores it for this tab, so the field is prefilled and both work at once.
  const [hasKey, setHasKey] = useState(() => Boolean(getSession().demoKey));
  const [keyDraft, setKeyDraft] = useState(() => getSession().demoKey ?? "");

  const failed = (e: unknown) => {
    setHasKey(Boolean(getSession().demoKey));
    setPlaced(null);
    setMessage(e instanceof Error ? e.message : "That did not work.");
  };
  const saveKey = (e: React.FormEvent) => {
    e.preventDefault();
    setDemoKey(keyDraft);
    setHasKey(Boolean(getSession().demoKey));
    setMessage(null);
  };
  const forgetKey = () => {
    setDemoKey(null);
    setKeyDraft("");
    setHasKey(false);
  };

  const doInject = () =>
    inject.mutate({ cause, wardId: Number(wardId), daysAgo }, {
      onSuccess: (res) => {
        setMessage(null);
        setPlaced({ cause, wardName: lookup.wardName(Number(wardId)), startDate: res.injection.startDate, daysAgo, appearsAfterMs: res.appearsAfterMs });
      },
      onError: failed,
    });
  const startDay = demo.data ? addDays(demo.data.today, -daysAgo) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="demo-desc">
        <DialogTitle>Demo controls</DialogTitle>
        <DialogDescription id="demo-desc">
          Plant a simulated outbreak to see the detector find it. Shortcut: Shift+D. Demo clock: {demo.data ? fmtDay(demo.data.today) : "loading"}.
        </DialogDescription>
        <form onSubmit={saveKey} className="grid gap-2">
          <label htmlFor="demo-key" className="font-bold">Demo key</label>
          <span className="text-sm text-muted">
            Needed for Inject and Reset only. Kept in this tab until it is closed. Judges: the demo key link is in the submission text.
          </span>
          <div className="flex flex-wrap gap-3">
            <input id="demo-key" type="password" autoComplete="off" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)}
              className="soft-in h-11 min-w-0 flex-1 rounded-btn px-4 text-ink placeholder:text-muted" placeholder="Paste the demo key" />
            {hasKey && keyDraft === getSession().demoKey ? (
              <Button type="button" size="sm" onClick={forgetKey} disabled={busy}>Forget key</Button>
            ) : (
              <Button type="submit" disabled={!keyDraft.trim()}><KeyRound aria-hidden="true" />Use key</Button>
            )}
          </div>
          {hasKey && keyDraft === getSession().demoKey && <span className="text-sm text-muted">Key ready for this tab.</span>}
        </form>
        <fieldset className="grid gap-3">
          <legend className="mb-2 font-bold">Outbreak type</legend>
          <div className="flex flex-wrap gap-3">
            {CAUSES.map((c) => (
              <button key={c} type="button" aria-pressed={cause === c} onClick={() => setCause(c)}
                className={cn("soft-btn inline-flex h-11 items-center gap-2 rounded-full px-4", cause === c && "font-bold text-teal")}>
                <CauseDot cause={c} />{CAUSE_LABEL[c]}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-2">
          <span className="font-bold" id="ward-label">Ward</span>
          <Select value={wardId} onValueChange={setWardId}>
            <SelectTrigger aria-labelledby="ward-label"><SelectValue /></SelectTrigger>
            <SelectContent>
              {wards.map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name} (ward {w.id})</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-bold">Starts</legend>
          <div className="flex flex-wrap gap-3">
            {STARTS.map((s) => (
              <button key={s.daysAgo} type="button" aria-pressed={daysAgo === s.daysAgo} onClick={() => setDaysAgo(s.daysAgo)}
                className={cn("soft-btn inline-flex h-11 items-center rounded-full px-4", daysAgo === s.daysAgo && "font-bold text-teal")}>
                {s.label}
              </button>
            ))}
          </div>
          <span className="text-sm text-muted">
            {STARTS.find((s) => s.daysAgo === daysAgo)?.note}{startDay && <> · starts <small>{fmtDay(startDay)}</small></>}.
            {" "}Today is not offered: the detector needs a few days of signals before it can raise an alert.
          </span>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={doInject} disabled={busy || !hasKey}><FlaskConical aria-hidden="true" />Inject outbreak</Button>
          {canAdvance && (
            <Button onClick={() => advance.mutate(undefined, { onSuccess: (s) => setMessage(`Moved to ${fmtDay(s.today)}. The daily detector run has been done for it.`), onError: failed })} disabled={busy}>
              <FastForward aria-hidden="true" />Fast-forward a day
            </Button>
          )}
          <Button onClick={() => reset.mutate(undefined, { onSuccess: () => { setPlaced(null); setMessage("Demo reset to its starting state."); }, onError: failed })} disabled={busy || !hasKey}>
            <RotateCcw aria-hidden="true" />Reset
          </Button>
        </div>
        <p role="status" aria-live="polite" className="min-h-6 text-muted">
          {busy ? "Working..." : message ?? (placed && (
            <>
              {CAUSE_LABEL[placed.cause]} outbreak placed in {placed.wardName}, started {daysAgoText(placed.daysAgo)}{" "}
              <small className="text-xs">({fmtDay(placed.startDate)})</small>, so its signals are already arriving.{" "}
              {placed.appearsAfterMs > 0
                ? `Its alerts appear in about ${Math.round(placed.appearsAfterMs / 1000)} seconds.`
                : "The detector has run: any alert it raised is on the Alerts page, raised today."}
            </>
          ))}
        </p>
      </DialogContent>
    </Dialog>
  );
}
