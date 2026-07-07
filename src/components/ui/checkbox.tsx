"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: any) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "ui:peer ui:size-4 ui:shrink-0 ui:rounded-[4px] ui:border ui:border-input ui:shadow-xs ui:transition-shadow ui:outline-none ui:focus-visible:border-ring ui:focus-visible:ring-[3px] ui:focus-visible:ring-ring/50 ui:disabled:cursor-not-allowed ui:disabled:opacity-50 ui:aria-invalid:border-destructive ui:aria-invalid:ring-destructive/20 ui:data-[state=checked]:border-primary ui:data-[state=checked]:bg-primary ui:data-[state=checked]:text-primary-foreground ui:dark:bg-input/30 ui:dark:aria-invalid:ring-destructive/40 ui:dark:data-[state=checked]:bg-primary",
        className
      )}
      {...props}>
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="ui:grid ui:place-content-center ui:text-current ui:transition-none">
        <CheckIcon className="ui:size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox }
