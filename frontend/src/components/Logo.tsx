import { motion, useReducedMotion } from "framer-motion";

/** Water drop with a small pulse line inside. Ripples once on load (not under reduced motion). */
export function Logo({ size = 48, ripple = false, className = "" }: { size?: number; ripple?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }} className={`shrink-0 overflow-visible ${className}`}>
      {ripple && !reduce && (
        <motion.circle cx="24" cy="31" r="14" fill="none" stroke="var(--aqua)" strokeWidth="1.5"
          initial={{ r: 12, opacity: 0.8 }} animate={{ r: 24, opacity: 0 }} transition={{ duration: 0.9, ease: "easeOut", delay: 0.2 }} />
      )}
      <path d="M24 4C24 4 9 21 9 31a15 15 0 0 0 30 0C39 21 24 4 24 4Z" fill="var(--teal)" />
      <path d="M24 9C24 9 13 22 13 31" fill="none" stroke="var(--aqua)" strokeWidth="2" strokeLinecap="round" opacity=".7" />
      <polyline points="14,32 19,32 21.5,26 25,38 28,29 30,32 34,32" fill="none" stroke="var(--on-teal)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
