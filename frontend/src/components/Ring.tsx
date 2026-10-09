import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/** Soft ring gauge (thermostat dial): 270 degree arc on an inset track, a raised face in the middle. */
export function Ring({ value, size, stroke, children, color = "var(--gauge)", label }: {
  value: number; size: number; stroke: number; children?: ReactNode; color?: string; label: string;
}) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2 - 8;
  const c = 2 * Math.PI * r;
  const len = c * 0.75;
  const v = Math.max(0, Math.min(1, value));
  const common = { cx: size / 2, cy: size / 2, r, fill: "none", strokeLinecap: "round" as const, transform: `rotate(135 ${size / 2} ${size / 2})` };
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="absolute inset-0" aria-hidden="true">
        <circle {...common} stroke="var(--inset)" strokeWidth={stroke} strokeDasharray={`${len} ${c}`} />
        <motion.circle {...common} stroke={color} strokeWidth={stroke - 4}
          initial={{ strokeDasharray: `${reduce ? len * v : 0} ${c}` }} animate={{ strokeDasharray: `${len * v} ${c}` }}
          transition={{ duration: reduce ? 0 : 0.8, ease: "easeOut" }} />
      </svg>
      <div className="soft absolute rounded-full" style={{ inset: stroke + 18 }} aria-hidden="true" />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden="true">{children}</div>
    </div>
  );
}
