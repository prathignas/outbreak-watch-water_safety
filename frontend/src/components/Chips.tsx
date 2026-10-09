import { Eye, Info, Siren, Waves } from "lucide-react";
import type { CauseType, SourceTag } from "@/contract/types";
import { CAUSE_LABEL, SOURCE_LABEL, STATUS_LABEL, type WardStatus } from "@/lib/format";
import { cn } from "@/lib/utils";

const statusStyle: Record<WardStatus, string> = { calm: "bg-calm-bg text-calm-ink", watch: "bg-watch-bg text-watch-ink", alert: "bg-alert-bg text-alert-ink" };
export const STATUS_ICON = { calm: Waves, watch: Eye, alert: Siren } as const;

/** Status is never colour alone: always label + icon. */
export function StatusChip({ status, children, className }: { status: WardStatus; children?: React.ReactNode; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={cn("inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-bold", statusStyle[status], className)}>
      <Icon className="size-[18px]" aria-hidden="true" />
      {children ?? STATUS_LABEL[status]}
    </span>
  );
}

/** Real / User / Simulated source badge. */
export function SourceBadge({ tag }: { tag: SourceTag }) {
  const real = tag === "real" || tag === "scraped";
  return (
    <span className={cn("soft-in inline-flex h-7 items-center rounded-chip px-3 text-sm font-bold", real ? "text-teal" : "text-muted")}>
      {SOURCE_LABEL[tag]}
    </span>
  );
}

export function CauseDot({ cause, className }: { cause: CauseType; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-3 shrink-0 rounded-full", className)} style={{ background: `var(--c-${cause})` }} />;
}

export function CauseLabel({ cause }: { cause: CauseType }) {
  return <span className="inline-flex items-center gap-2"><CauseDot cause={cause} />{CAUSE_LABEL[cause]}</span>;
}

export function TriageHintLabel() {
  return (
    <span className="soft-in inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm text-muted">
      <Info className="size-[18px]" aria-hidden="true" />Triage hint, not a diagnosis
    </span>
  );
}
