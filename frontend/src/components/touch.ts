import { useAnimationControls, useReducedMotion } from "framer-motion";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";

/**
 * Card touch feedback (approved 2026-10-06): a tiny shake (under 1 degree, 2 px, 300 ms, once)
 * and a short shine along the edge (450 ms). Reduced motion: no shake, a still edge highlight.
 */
export function useTouchFeedback(enabled = true) {
  const controls = useAnimationControls();
  const reduce = useReducedMotion();
  const [shining, setShining] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const touch = useCallback(() => {
    if (!enabled) return;
    setShining(false);
    requestAnimationFrame(() => setShining(true));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShining(false), 460);
    if (!reduce) void controls.start({ rotate: [0, -0.7, 0.6, -0.3, 0], x: [0, -2, 2, -1, 0], transition: { duration: 0.3, ease: "easeOut" } });
  }, [controls, enabled, reduce]);

  return {
    animate: controls,
    shineClass: enabled ? `shine${shining ? " shining" : ""}` : "",
    handlers: {
      onPointerDown: touch,
      onKeyDown: (e: KeyboardEvent) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) touch();
      },
    },
  };
}
