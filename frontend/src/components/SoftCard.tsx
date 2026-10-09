import { motion } from "framer-motion";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTouchFeedback } from "./touch";

type Props = Omit<ComponentProps<typeof motion.section>, "children"> & {
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Touch shake + edge shine. Off for big containers that hold a map. */
  touch?: boolean;
};

/** A raised soft card: same colour as the page, two soft shadows, large radius. */
export function SoftCard({ children, size = "md", touch = true, className, ...props }: Props) {
  const fb = useTouchFeedback(touch);
  return (
    <motion.section
      animate={fb.animate}
      {...fb.handlers}
      className={cn("edge relative", size === "lg" ? "soft-lg rounded-lg" : size === "sm" ? "soft-sm rounded-card" : "soft rounded-card", fb.shineClass, className)}
      {...props}
    >
      {children}
    </motion.section>
  );
}
