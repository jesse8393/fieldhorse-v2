"use client";
import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext({
  size: "default",
  variant: "default",
  spacing: 0,
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  children,
  ...props
}) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      style={{
        "--gap": spacing
      }}
      className={cn(
        "ui:group/toggle-group ui:flex ui:w-fit ui:items-center ui:gap-[--spacing(var(--gap))] ui:rounded-md ui:data-[spacing=default]:data-[variant=outline]:shadow-xs",
        className
      )}
      {...props}>
      <ToggleGroupContext.Provider value={{ variant, size, spacing }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(toggleVariants({
        variant: context.variant || variant,
        size: context.size || size,
      }), "ui:w-auto ui:min-w-0 ui:shrink-0 ui:px-3 ui:focus:z-10 ui:focus-visible:z-10", "ui:data-[spacing=0]:rounded-none ui:data-[spacing=0]:shadow-none ui:data-[spacing=0]:first:rounded-l-md ui:data-[spacing=0]:last:rounded-r-md ui:data-[spacing=0]:data-[variant=outline]:border-l-0 ui:data-[spacing=0]:data-[variant=outline]:first:border-l", className)}
      {...props}>
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem }
