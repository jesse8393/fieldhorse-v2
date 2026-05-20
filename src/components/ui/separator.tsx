import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: any) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "ui:shrink-0 ui:bg-border ui:data-[orientation=horizontal]:h-px ui:data-[orientation=horizontal]:w-full ui:data-[orientation=vertical]:h-full ui:data-[orientation=vertical]:w-px",
        className
      )}
      {...props} />
  );
}

export { Separator }
