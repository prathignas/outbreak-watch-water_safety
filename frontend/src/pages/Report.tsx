import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Send } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { api, ApiError, config, type ComplaintResponse } from "@/api/client";
import { SourceBadge } from "@/components/Chips";
import { PageHeader } from "@/components/Shell";
import { SoftCard } from "@/components/SoftCard";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCity } from "@/hooks/queries";

const MAX_TEXT = 2000;

/**
 * The citizen complaint form: the only source of "user" rows (POST /complaints).
 * Sends { complaintId, wardId, description }. complaintId is made once per complaint, so a
 * retry of the same submission is counted once by the server.
 */
export function ReportPage() {
  const city = useCity();
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const wardLabel = useId();
  const textId = useId();
  const [wardId, setWardId] = useState("");
  const [description, setDescription] = useState("");
  const [complaintId, setComplaintId] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<ComplaintResponse | null>(null);

  const send = useMutation({
    mutationFn: () => api.submitComplaint({ complaintId, wardId: Number(wardId), description: description.trim() }),
    onSuccess: async (res) => {
      setDone(res);
      setDescription("");
      setComplaintId(crypto.randomUUID()); // the next complaint is a new one
      await qc.invalidateQueries({ queryKey: ["signals"] });
    },
  });

  const wards = [...(city.data?.wards ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const canSend = wardId !== "" && description.trim().length > 0 && !send.isPending;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSend) send.mutate();
  }

  return (
    <>
      <PageHeader title="Report a problem" />
      <SoftCard className="grid max-w-2xl gap-6 p-6 md:p-8" aria-labelledby="report-h">
        <div className="grid gap-2">
          <h2 id="report-h" className="text-2xl font-bold">Tell the health team what you see</h2>
          <p className="text-muted">
            Dirty water, a sick family, food that made people ill. Each report counts once for your ward today and is
            stored as <SourceBadge tag="user" />. It is not a diagnosis; an officer reviews the numbers.
          </p>
          {config.mode === "mock" && <p className="text-sm font-bold">Mock mode: reports are not saved anywhere.</p>}
        </div>

        <form onSubmit={onSubmit} className="grid gap-5" noValidate>
          <div className="grid gap-2">
            <span id={wardLabel} className="font-bold">Your ward</span>
            <Select value={wardId} onValueChange={setWardId} disabled={!city.data}>
              <SelectTrigger aria-labelledby={wardLabel}><SelectValue placeholder={city.data ? "Choose your ward" : "Loading wards"} /></SelectTrigger>
              <SelectContent>
                {wards.map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name} (ward {w.id})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <label htmlFor={textId} className="font-bold">What is happening?</label>
            <textarea
              id={textId}
              value={description}
              maxLength={MAX_TEXT}
              rows={5}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="For example: the tap water has smelled bad since Monday and two neighbours have stomach upsets."
              className="soft-in min-h-32 w-full resize-y rounded-btn px-4 py-3 text-ink placeholder:text-muted"
            />
            <span className="text-sm text-muted">Please do not include names or phone numbers.</span>
          </div>

          <Button type="submit" variant="primary" disabled={!canSend} className="justify-self-start">
            <Send aria-hidden="true" />{send.isPending ? "Sending" : "Send report"}
          </Button>

          <AnimatePresence mode="wait">
            {send.isError && (
              <motion.p key="err" role="alert" className="font-bold text-alert-ink"
                initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {send.error instanceof ApiError ? send.error.message : "The report could not be sent."} Please try again.
              </motion.p>
            )}
            {done && !send.isError && (
              <motion.p key="ok" role="status" className="flex items-start gap-2"
                initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal" aria-hidden="true" />
                <span>
                  {done.duplicate ? "We already had this report; it is counted once." : "Thank you, your report was received."}{" "}
                  Reports for ward {done.signal.wardId} today: <b>{done.signal.count}</b>.
                </span>
              </motion.p>
            )}
          </AnimatePresence>
        </form>
      </SoftCard>
    </>
  );
}
