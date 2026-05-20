import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: any) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("ui:relative", className)}
      {...props}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="ui:size-full ui:rounded-[inherit] ui:transition-[color,box-shadow] ui:outline-none ui:focus-visible:ring-[3px] ui:focus-visible:ring-ring/50 ui:focus-visible:outline-1">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: any) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "ui:flex ui:touch-none ui:p-px ui:transition-colors ui:select-none",
        orientation === "vertical" &&
          "ui:h-full ui:w-2.5 ui:border-l ui:border-l-transparent",
        orientation === "horizontal" &&
          "ui:h-2.5 ui:flex-col ui:border-t ui:border-t-transparent",
        className
      )}
      {...props}>
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="ui:relative ui:flex-1 ui:rounded-full ui:bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar }
