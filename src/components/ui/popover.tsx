import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: any) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

// forwardRef (React 18): the stock shadcn wrappers assume React 19's
// ref-as-prop. Without it, asChild composition (e.g. PopoverAnchor
// around a DropdownMenuTrigger) never delivers a DOM node to Radix
// popper and the popover renders off-screen at translate(0,-200%).
const PopoverTrigger = React.forwardRef<any, any>(function PopoverTrigger(props, ref) {
  return <PopoverPrimitive.Trigger ref={ref} data-slot="popover-trigger" {...props} />;
})

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: any) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "ui:z-50 ui:w-72 ui:origin-(--radix-popover-content-transform-origin) ui:rounded-[10px] ui:border ui:bg-popover ui:p-4 ui:text-popover-foreground ui:shadow-md ui:outline-hidden ui:data-[side=bottom]:slide-in-from-top-2 ui:data-[side=left]:slide-in-from-right-2 ui:data-[side=right]:slide-in-from-left-2 ui:data-[side=top]:slide-in-from-bottom-2 ui:data-[state=closed]:animate-out ui:data-[state=closed]:fade-out-0 ui:data-[state=closed]:zoom-out-95 ui:data-[state=open]:animate-in ui:data-[state=open]:fade-in-0 ui:data-[state=open]:zoom-in-95",
          className
        )}
        {...props} />
    </PopoverPrimitive.Portal>
  );
}

const PopoverAnchor = React.forwardRef<any, any>(function PopoverAnchor(props, ref) {
  return <PopoverPrimitive.Anchor ref={ref} data-slot="popover-anchor" {...props} />;
})

function PopoverHeader({
  className,
  ...props
}: any) {
  return (
    <div
      data-slot="popover-header"
      className={cn("ui:flex ui:flex-col ui:gap-1 ui:text-sm", className)}
      {...props} />
  );
}

function PopoverTitle({
  className,
  ...props
}: any) {
  return (
    <div
      data-slot="popover-title"
      className={cn("ui:font-medium", className)}
      {...props} />
  );
}

function PopoverDescription({
  className,
  ...props
}: any) {
  return (
    <p
      data-slot="popover-description"
      className={cn("ui:text-muted-foreground", className)}
      {...props} />
  );
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
