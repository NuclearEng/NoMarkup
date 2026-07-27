"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      // FE-07: min-h-11 so the control's vertical hit strip is ≥44px
      "relative flex min-h-11 w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className={cn(
        // FE-07: 44×44 hit target; visual knob stays ~16px via ::after
        "relative block h-11 w-11 shrink-0 rounded-full border-0 bg-transparent shadow-none",
        "after:pointer-events-none after:absolute after:left-1/2 after:top-1/2",
        "after:h-4 after:w-4 after:-translate-x-1/2 after:-translate-y-1/2",
        "after:rounded-full after:border after:border-primary/50 after:bg-background after:shadow",
        "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
