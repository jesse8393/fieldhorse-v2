import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: any) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "ui:flex ui:items-center ui:gap-2 ui:text-sm ui:leading-none ui:font-medium ui:select-none ui:group-data-[disabled=true]:pointer-events-none ui:group-data-[disabled=true]:opacity-50 ui:peer-disabled:cursor-not-allowed ui:peer-disabled:opacity-50",
        className
      )}
      {...props} />
  );
}

export { Label }
