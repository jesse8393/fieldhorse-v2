"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function Command({
  className,
  ...props
}) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "ui:flex ui:h-full ui:w-full ui:flex-col ui:overflow-hidden ui:rounded-md ui:bg-popover ui:text-popover-foreground",
        className
      )}
      {...props} />
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = true,
  ...props
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="ui:sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn("ui:overflow-hidden ui:p-0", className)}
        showCloseButton={showCloseButton}>
        <Command
          className="ui:**:data-[slot=command-input-wrapper]:h-12 ui:[&_[cmdk-group-heading]]:px-2 ui:[&_[cmdk-group-heading]]:font-medium ui:[&_[cmdk-group-heading]]:text-muted-foreground ui:[&_[cmdk-group]]:px-2 ui:[&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 ui:[&_[cmdk-input-wrapper]_svg]:h-5 ui:[&_[cmdk-input-wrapper]_svg]:w-5 ui:[&_[cmdk-input]]:h-12 ui:[&_[cmdk-item]]:px-2 ui:[&_[cmdk-item]]:py-3 ui:[&_[cmdk-item]_svg]:h-5 ui:[&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="ui:flex ui:h-9 ui:items-center ui:gap-2 ui:border-b ui:px-3">
      <SearchIcon className="ui:size-4 ui:shrink-0 ui:opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "ui:flex ui:h-10 ui:w-full ui:rounded-md ui:bg-transparent ui:py-3 ui:text-sm ui:outline-hidden ui:placeholder:text-muted-foreground ui:disabled:cursor-not-allowed ui:disabled:opacity-50",
          className
        )}
        {...props} />
    </div>
  );
}

function CommandList({
  className,
  ...props
}) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "ui:max-h-[300px] ui:scroll-py-1 ui:overflow-x-hidden ui:overflow-y-auto",
        className
      )}
      {...props} />
  );
}

function CommandEmpty({
  ...props
}) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="ui:py-6 ui:text-center ui:text-sm"
      {...props} />
  );
}

function CommandGroup({
  className,
  ...props
}) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "ui:overflow-hidden ui:p-1 ui:text-foreground ui:[&_[cmdk-group-heading]]:px-2 ui:[&_[cmdk-group-heading]]:py-1.5 ui:[&_[cmdk-group-heading]]:text-xs ui:[&_[cmdk-group-heading]]:font-medium ui:[&_[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      {...props} />
  );
}

function CommandSeparator({
  className,
  ...props
}) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("ui:-mx-1 ui:h-px ui:bg-border", className)}
      {...props} />
  );
}

function CommandItem({
  className,
  ...props
}) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "ui:relative ui:flex ui:cursor-default ui:items-center ui:gap-2 ui:rounded-sm ui:px-2 ui:py-1.5 ui:text-sm ui:outline-hidden ui:select-none ui:data-[disabled=true]:pointer-events-none ui:data-[disabled=true]:opacity-50 ui:data-[selected=true]:bg-accent ui:data-[selected=true]:text-accent-foreground ui:[&_svg]:pointer-events-none ui:[&_svg]:shrink-0 ui:[&_svg:not([class*=size-])]:size-4 ui:[&_svg:not([class*=text-])]:text-muted-foreground",
        className
      )}
      {...props} />
  );
}

function CommandShortcut({
  className,
  ...props
}) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ui:ml-auto ui:text-xs ui:tracking-widest ui:text-muted-foreground",
        className
      )}
      {...props} />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
