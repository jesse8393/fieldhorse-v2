import * as React from "react"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function DropdownMenu({
  ...props
}: any) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({
  ...props
}: any) {
  return (<DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />);
}

function DropdownMenuTrigger({
  ...props
}: any) {
  return (<DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />);
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: any) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "ui:z-50 ui:max-h-(--radix-dropdown-menu-content-available-height) ui:min-w-[8rem] ui:origin-(--radix-dropdown-menu-content-transform-origin) ui:overflow-x-hidden ui:overflow-y-auto ui:rounded-md ui:border ui:bg-popover ui:p-1 ui:text-popover-foreground ui:shadow-md ui:data-[side=bottom]:slide-in-from-top-2 ui:data-[side=left]:slide-in-from-right-2 ui:data-[side=right]:slide-in-from-left-2 ui:data-[side=top]:slide-in-from-bottom-2 ui:data-[state=closed]:animate-out ui:data-[state=closed]:fade-out-0 ui:data-[state=closed]:zoom-out-95 ui:data-[state=open]:animate-in ui:data-[state=open]:fade-in-0 ui:data-[state=open]:zoom-in-95",
          className
        )}
        {...props} />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({
  ...props
}: any) {
  return (<DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />);
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: any) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "ui:relative ui:flex ui:cursor-default ui:items-center ui:gap-2 ui:rounded-sm ui:px-2 ui:py-1.5 ui:text-sm ui:outline-hidden ui:select-none ui:focus:bg-accent ui:focus:text-accent-foreground ui:data-[disabled]:pointer-events-none ui:data-[disabled]:opacity-50 ui:data-[inset]:pl-8 ui:data-[variant=destructive]:text-destructive ui:data-[variant=destructive]:focus:bg-destructive/10 ui:data-[variant=destructive]:focus:text-destructive ui:dark:data-[variant=destructive]:focus:bg-destructive/20 ui:[&_svg]:pointer-events-none ui:[&_svg]:shrink-0 ui:[&_svg:not([class*=size-])]:size-4 ui:[&_svg:not([class*=text-])]:text-muted-foreground ui:data-[variant=destructive]:*:[svg]:text-destructive!",
        className
      )}
      {...props} />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: any) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "ui:relative ui:flex ui:cursor-default ui:items-center ui:gap-2 ui:rounded-sm ui:py-1.5 ui:pr-2 ui:pl-8 ui:text-sm ui:outline-hidden ui:select-none ui:focus:bg-accent ui:focus:text-accent-foreground ui:data-[disabled]:pointer-events-none ui:data-[disabled]:opacity-50 ui:[&_svg]:pointer-events-none ui:[&_svg]:shrink-0 ui:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      checked={checked}
      {...props}>
      <span
        className="ui:pointer-events-none ui:absolute ui:left-2 ui:flex ui:size-3.5 ui:items-center ui:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="ui:size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: any) {
  return (<DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />);
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: any) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "ui:relative ui:flex ui:cursor-default ui:items-center ui:gap-2 ui:rounded-sm ui:py-1.5 ui:pr-2 ui:pl-8 ui:text-sm ui:outline-hidden ui:select-none ui:focus:bg-accent ui:focus:text-accent-foreground ui:data-[disabled]:pointer-events-none ui:data-[disabled]:opacity-50 ui:[&_svg]:pointer-events-none ui:[&_svg]:shrink-0 ui:[&_svg:not([class*=size-])]:size-4",
        className
      )}
      {...props}>
      <span
        className="ui:pointer-events-none ui:absolute ui:left-2 ui:flex ui:size-3.5 ui:items-center ui:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="ui:size-2 ui:fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: any) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "ui:px-2 ui:py-1.5 ui:text-sm ui:font-medium ui:data-[inset]:pl-8",
        className
      )}
      {...props} />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: any) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("ui:-mx-1 ui:my-1 ui:h-px ui:bg-border", className)}
      {...props} />
  );
}

function DropdownMenuShortcut({
  className,
  ...props
}: any) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ui:ml-auto ui:text-xs ui:tracking-widest ui:text-muted-foreground",
        className
      )}
      {...props} />
  );
}

function DropdownMenuSub({
  ...props
}: any) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: any) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "ui:flex ui:cursor-default ui:items-center ui:gap-2 ui:rounded-sm ui:px-2 ui:py-1.5 ui:text-sm ui:outline-hidden ui:select-none ui:focus:bg-accent ui:focus:text-accent-foreground ui:data-[inset]:pl-8 ui:data-[state=open]:bg-accent ui:data-[state=open]:text-accent-foreground ui:[&_svg]:pointer-events-none ui:[&_svg]:shrink-0 ui:[&_svg:not([class*=size-])]:size-4 ui:[&_svg:not([class*=text-])]:text-muted-foreground",
        className
      )}
      {...props}>
      {children}
      <ChevronRightIcon className="ui:ml-auto ui:size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: any) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "ui:z-50 ui:min-w-[8rem] ui:origin-(--radix-dropdown-menu-content-transform-origin) ui:overflow-hidden ui:rounded-md ui:border ui:bg-popover ui:p-1 ui:text-popover-foreground ui:shadow-lg ui:data-[side=bottom]:slide-in-from-top-2 ui:data-[side=left]:slide-in-from-right-2 ui:data-[side=right]:slide-in-from-left-2 ui:data-[side=top]:slide-in-from-bottom-2 ui:data-[state=closed]:animate-out ui:data-[state=closed]:fade-out-0 ui:data-[state=closed]:zoom-out-95 ui:data-[state=open]:animate-in ui:data-[state=open]:fade-in-0 ui:data-[state=open]:zoom-in-95",
        className
      )}
      {...props} />
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
