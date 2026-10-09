import { useEffect, useRef, useState } from "react";
import type { AlertRecord } from "@/api/types";

/** Alerts that appeared since the page first loaded (they glow once). Empty on first load. */
export function useNewAlerts(alerts: AlertRecord[] | undefined): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!alerts) return;
    if (!seen.current) {
      seen.current = new Set(alerts.map((a) => a.id));
      return;
    }
    const added = alerts.filter((a) => !seen.current!.has(a.id)).map((a) => a.id);
    added.forEach((id) => seen.current!.add(id));
    if (added.length) {
      setFresh(new Set(added));
      const t = setTimeout(() => setFresh(new Set()), 1400);
      return () => clearTimeout(t);
    }
  }, [alerts]);
  return fresh;
}
