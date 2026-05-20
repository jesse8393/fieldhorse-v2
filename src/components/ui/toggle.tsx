import * as React from "react"
import { cva } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "ui:inline-flex ui:items-center ui:justify-center ui:gap-2 ui:rounded-md ui:text-sm ui:font-medium ui:whitespace-nowrap ui:transition-[color,box-shadow] ui:outline-none ui:hover:bg-muted ui:hover:text-muted-foreground ui:focus-visible:border-ring ui:focus-visible:ring-[3px] ui:focus-visible:ring-ring/50 ui:disabled:pointer-events-none ui:disabled:opacity-50 ui:aria-invalid:border-destructive ui:aria-invalid:ring-destructive/20 ui:data-[state=on]:bg-accent ui:data-[state=on]:text-accent-foreground ui:dark:aria-invalid:ring-destructive/40 ui:[&_svg]:pointer-events-none ui:[&_svg]:shrink-0 ui:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "ui:bg-transparent",
        outline:
          "ui:border ui:border-input ui:bg-transparent ui:shadow-xs ui:hover:bg-accent ui:hover:text-accent-foreground",
      },
      size: {
        default: "ui:h-9 ui:min-w-9 ui:px-2",
        sm: "ui:h-8 ui:min-w-8 ui:px-1.5",
        lg: "ui:h-10 ui:min-w-10 ui:px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: any) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props} />
  );
}

export { Toggle, toggleVariants }
