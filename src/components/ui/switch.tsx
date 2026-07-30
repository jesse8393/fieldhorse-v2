import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: any) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "ui:peer ui:group/switch ui:inline-flex ui:shrink-0 ui:items-center ui:rounded-[10px] ui:border ui:border-transparent ui:shadow-xs ui:transition-all ui:outline-none ui:focus-visible:border-ring ui:focus-visible:ring-[3px] ui:focus-visible:ring-ring/50 ui:disabled:cursor-not-allowed ui:disabled:opacity-50 ui:data-[size=default]:h-[1.15rem] ui:data-[size=default]:w-8 ui:data-[size=sm]:h-3.5 ui:data-[size=sm]:w-6 ui:data-[state=checked]:bg-primary ui:data-[state=unchecked]:bg-input ui:dark:data-[state=unchecked]:bg-input/80",
        className
      )}
      {...props}>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "ui:pointer-events-none ui:block ui:rounded-[10px] ui:bg-background ui:ring-0 ui:transition-transform ui:group-data-[size=default]/switch:size-4 ui:group-data-[size=sm]/switch:size-3 ui:data-[state=checked]:translate-x-[calc(100%-2px)] ui:data-[state=unchecked]:translate-x-0 ui:dark:data-[state=checked]:bg-primary-foreground ui:dark:data-[state=unchecked]:bg-foreground"
        )} />
    </SwitchPrimitive.Root>
  );
}

export { Switch }
