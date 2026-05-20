import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Sheet({
  ...props
}: any) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}: any) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: any) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}: any) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: any) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "ui:fixed ui:inset-0 ui:z-50 ui:bg-black/50 ui:data-[state=closed]:animate-out ui:data-[state=closed]:fade-out-0 ui:data-[state=open]:animate-in ui:data-[state=open]:fade-in-0",
        className
      )}
      {...props} />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: any) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "ui:fixed ui:z-50 ui:flex ui:flex-col ui:gap-4 ui:bg-background ui:shadow-lg ui:transition ui:ease-in-out ui:data-[state=closed]:animate-out ui:data-[state=closed]:duration-300 ui:data-[state=open]:animate-in ui:data-[state=open]:duration-500",
          side === "right" &&
            "ui:inset-y-0 ui:right-0 ui:h-full ui:w-3/4 ui:border-l ui:data-[state=closed]:slide-out-to-right ui:data-[state=open]:slide-in-from-right ui:sm:max-w-sm",
          side === "left" &&
            "ui:inset-y-0 ui:left-0 ui:h-full ui:w-3/4 ui:border-r ui:data-[state=closed]:slide-out-to-left ui:data-[state=open]:slide-in-from-left ui:sm:max-w-sm",
          side === "top" &&
            "ui:inset-x-0 ui:top-0 ui:h-auto ui:border-b ui:data-[state=closed]:slide-out-to-top ui:data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "ui:inset-x-0 ui:bottom-0 ui:h-auto ui:border-t ui:data-[state=closed]:slide-out-to-bottom ui:data-[state=open]:slide-in-from-bottom",
          className
        )}
        {...props}>
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            className="ui:absolute ui:top-4 ui:right-4 ui:rounded-xs ui:opacity-70 ui:ring-offset-background ui:transition-opacity ui:hover:opacity-100 ui:focus:ring-2 ui:focus:ring-ring ui:focus:ring-offset-2 ui:focus:outline-hidden ui:disabled:pointer-events-none ui:data-[state=open]:bg-secondary">
            <XIcon className="ui:size-4" />
            <span className="ui:sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({
  className,
  ...props
}: any) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("ui:flex ui:flex-col ui:gap-1.5 ui:p-4", className)}
      {...props} />
  );
}

function SheetFooter({
  className,
  ...props
}: any) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("ui:mt-auto ui:flex ui:flex-col ui:gap-2 ui:p-4", className)}
      {...props} />
  );
}

function SheetTitle({
  className,
  ...props
}: any) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("ui:font-semibold ui:text-foreground", className)}
      {...props} />
  );
}

function SheetDescription({
  className,
  ...props
}: any) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("ui:text-sm ui:text-muted-foreground", className)}
      {...props} />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
