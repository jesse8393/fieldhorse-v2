import * as React from "react"
import { Avatar as AvatarPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Avatar({
  className,
  size = "default",
  ...props
}: any) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "ui:group/avatar ui:relative ui:flex ui:size-8 ui:shrink-0 ui:overflow-hidden ui:rounded-[10px] ui:select-none ui:data-[size=lg]:size-10 ui:data-[size=sm]:size-6",
        className
      )}
      {...props} />
  );
}

function AvatarImage({
  className,
  ...props
}: any) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("ui:aspect-square ui:size-full", className)}
      {...props} />
  );
}

function AvatarFallback({
  className,
  ...props
}: any) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "ui:flex ui:size-full ui:items-center ui:justify-center ui:rounded-[10px] ui:bg-muted ui:text-sm ui:text-muted-foreground ui:group-data-[size=sm]/avatar:text-xs",
        className
      )}
      {...props} />
  );
}

function AvatarBadge({
  className,
  ...props
}: any) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "ui:absolute ui:right-0 ui:bottom-0 ui:z-10 ui:inline-flex ui:items-center ui:justify-center ui:rounded-[10px] ui:bg-primary ui:text-primary-foreground ui:ring-2 ui:ring-background ui:select-none",
        "ui:group-data-[size=sm]/avatar:size-2 ui:group-data-[size=sm]/avatar:[&>svg]:hidden",
        "ui:group-data-[size=default]/avatar:size-2.5 ui:group-data-[size=default]/avatar:[&>svg]:size-2",
        "ui:group-data-[size=lg]/avatar:size-3 ui:group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props} />
  );
}

function AvatarGroup({
  className,
  ...props
}: any) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "ui:group/avatar-group ui:flex ui:-space-x-2 ui:*:data-[slot=avatar]:ring-2 ui:*:data-[slot=avatar]:ring-background",
        className
      )}
      {...props} />
  );
}

function AvatarGroupCount({
  className,
  ...props
}: any) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "ui:relative ui:flex ui:size-8 ui:shrink-0 ui:items-center ui:justify-center ui:rounded-[10px] ui:bg-muted ui:text-sm ui:text-muted-foreground ui:ring-2 ui:ring-background ui:group-has-data-[size=lg]/avatar-group:size-10 ui:group-has-data-[size=sm]/avatar-group:size-6 ui:[&>svg]:size-4 ui:group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 ui:group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props} />
  );
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
}
