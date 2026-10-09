import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/* Soft neumorphic switch: an inset track with a raised knob. */
function Switch({ className, children, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn("soft-in relative inline-flex h-11 w-24 shrink-0 items-center justify-between rounded-full px-3 text-muted", className)} {...props}>
      {children}
      <SwitchPrimitive.Thumb className="soft-sm pointer-events-none absolute top-1.5 left-1.5 block size-8 rounded-full transition-transform duration-200 data-[state=checked]:translate-x-[3.25rem]" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
