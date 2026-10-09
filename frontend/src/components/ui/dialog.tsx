import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(15_29_38/0.45)]" />
      <DialogPrimitive.Content
        className={cn("soft-lg edge fixed top-1/2 left-1/2 z-50 grid w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-lg p-8 text-ink", className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="soft-btn absolute top-6 right-6 inline-flex size-11 items-center justify-center rounded-full" aria-label="Close">
          <XIcon className="size-5" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

const DialogTitle = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn("font-display text-2xl font-bold", className)} {...props} />
);
const DialogDescription = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn("text-muted", className)} {...props} />
);

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogTitle, DialogDescription };
