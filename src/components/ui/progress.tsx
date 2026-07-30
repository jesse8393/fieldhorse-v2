import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: any) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "ui:relative ui:h-2 ui:w-full ui:overflow-hidden ui:rounded-[10px] ui:bg-primary/20",
        className
      )}
      {...props}>
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="ui:h-full ui:w-full ui:flex-1 ui:bg-primary ui:transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }} />
    </ProgressPrimitive.Root>
  );
}

export { Progress }
