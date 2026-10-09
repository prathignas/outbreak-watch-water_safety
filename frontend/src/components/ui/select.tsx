import * as React from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger className={cn("soft-in flex h-12 w-full items-center justify-between gap-2 rounded-btn px-4 text-left text-ink", className)} {...props}>
      {children}
      <SelectPrimitive.Icon asChild><ChevronDownIcon className="size-5 text-muted" aria-hidden="true" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content position="popper" sideOffset={8}
        className={cn("soft z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-btn p-2 text-ink", className)} {...props}>
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item className={cn("relative flex h-11 cursor-default items-center rounded-chip pr-3 pl-9 outline-none select-none data-[highlighted]:shadow-press data-[highlighted]:text-teal", className)} {...props}>
      <span className="absolute left-3 flex size-4 items-center justify-center"><SelectPrimitive.ItemIndicator><CheckIcon className="size-4" aria-hidden="true" /></SelectPrimitive.ItemIndicator></span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
