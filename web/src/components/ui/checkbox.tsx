"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  // FE-07: min-h-11 min-w-11 hit target (≥44px). Visual box stays h-4 w-4
  // via the inner span so layout density is unchanged.
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer group inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none grid h-4 w-4 place-content-center rounded-sm border border-primary shadow",
        "group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground",
      )}
    >
      <CheckboxPrimitive.Indicator className="grid place-content-center text-current">
        <Check className="h-4 w-4" />
      </CheckboxPrimitive.Indicator>
    </span>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
