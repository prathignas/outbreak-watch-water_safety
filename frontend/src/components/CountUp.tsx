import { animate, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

/** A number that counts up when it first appears (600 ms). Instant under reduced motion. */
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, { duration: 0.6, ease: "easeOut", onUpdate: setShown });
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <span className="tabular">
      {/* Screen readers get the final value; aria-label is not allowed on a plain span. */}
      <span className="sr-only">{value.toFixed(decimals)}{suffix}</span>
      <span aria-hidden="true">{shown.toFixed(decimals)}{suffix}</span>
    </span>
  );
}
