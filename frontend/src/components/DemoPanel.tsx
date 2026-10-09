import { FastForward, FlaskConical, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import type { InjectableCause } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCity, useDemoActions, useDemoState } from "@/hooks/queries";
import { cityLookup } from "@/lib/city";
import { CAUSE_LABEL, fmtDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CauseDot } from "./Chips";

const CAUSES: InjectableCause[] = ["water", "food", "p2p"];

/** Demo controls (Shift+D or the Demo button). Fast-forward exists in mock mode only. */
export function DemoPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const city = useCity();
  const lookup = cityLookup(city.data);
  const demo = useDemoState();
  const { inject, reset, advance, canAdvance } = useDemoActions();
  const [cause, setCause] = useState<InjectableCause>("water");
  const [wardId, setWardId] = useState("18");
  const [message, setMessage] = useState<string | null>(null);
  const wards = useMemo(() => [...lookup.wards].sort((a, b) => a.name.localeCompare(b.name)), [lookup.wards]);
  const busy = inject.isPending || reset.isPending || advance.isPending;

  const failed = (e: unknown) =>
    setMessage(e instanceof ApiError && e.status === 401 ? "The demo key was not accepted. Reload the page and enter it again." : e instanceof Error ? e.message : "That did not work.");

  const doInject = () =>
    inject.mutate({ cause, wardId: Number(wardId) }, {
      onSuccess: (res) => setMessage(
        `${CAUSE_LABEL[res.injection.cause]} outbreak placed in ${lookup.wardName(Number(wardId))}, starting ${fmtDay(res.injection.startDate)} so its signals are already arriving. ` +
        `Its alerts appear in about ${Math.round(res.appearsAfterMs / 1000)} seconds.`),
      onError: failed,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="demo-desc">
        <DialogTitle>Demo controls</DialogTitle>
        <DialogDescription id="demo-desc">
          Plant a simulated outbreak to see the detector find it. Shortcut: Shift+D. Demo clock: {demo.data ? fmtDay(demo.data.today) : "loading"}.
        </DialogDescription>
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
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={doInject} disabled={busy}><FlaskConical aria-hidden="true" />Inject outbreak</Button>
          {canAdvance && (
            <Button onClick={() => advance.mutate(undefined, { onSuccess: (s) => setMessage(`Moved to ${fmtDay(s.today)}. The daily detector run has been done for it.`), onError: failed })} disabled={busy}>
              <FastForward aria-hidden="true" />Fast-forward a day
            </Button>
          )}
          <Button onClick={() => reset.mutate(undefined, { onSuccess: () => setMessage("Demo reset to its starting state."), onError: failed })} disabled={busy}>
            <RotateCcw aria-hidden="true" />Reset
          </Button>
        </div>
        <p role="status" aria-live="polite" className="min-h-6 text-muted">{busy ? "Working..." : message}</p>
      </DialogContent>
    </Dialog>
  );
}
