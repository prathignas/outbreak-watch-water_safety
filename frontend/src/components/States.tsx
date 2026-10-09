import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden="true" />;
}

export function LoadingBlock({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("grid gap-4", className)} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-6 w-2/3" />
    </div>
  );
}

export function ErrorState({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4 p-2" role="alert">
      <p className="flex items-center gap-2 font-bold text-[var(--danger-ink)]"><AlertTriangle className="size-5" aria-hidden="true" />{title}</p>
      <p className="text-muted">{error instanceof Error ? error.message : "Something went wrong."}</p>
      {onRetry && <Button onClick={onRetry} size="sm"><RefreshCw aria-hidden="true" />Try again</Button>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 p-2">
      <p className="font-display text-xl font-bold">{title}</p>
      <p className="text-muted">{body}</p>
      {action}
    </div>
  );
}
