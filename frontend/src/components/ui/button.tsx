import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/* Soft pill button. Always icon + label (never shadow alone). Lifts on hover, presses in on click. */
const buttonVariants = cva(
  "soft-btn inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap no-underline disabled:opacity-60 disabled:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: { default: "text-ink", primary: "btn-primary", quiet: "text-ink shadow-none hover:shadow-raise-sm" },
      size: { default: "h-12 px-6 text-base", sm: "h-11 px-4 text-sm", icon: "size-11 p-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
