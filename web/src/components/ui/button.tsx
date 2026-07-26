import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow hover:bg-primary/90 hover:shadow-md hover:-translate-y-0.5',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-md hover:shadow-red-200 hover:animate-[shimmer_0.5s_ease-in-out]',
        outline:
          'border border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground hover:-translate-y-0.5 hover:shadow-md',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 hover:-translate-y-0.5 hover:shadow-md',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        glass:
          'glass-button text-foreground hover:text-foreground',
        accept:
          'bg-bid-winning text-white shadow-sm hover:bg-trust-high hover:shadow-[0_0_20px_hsl(var(--trust-high)_/_0.35)] hover:-translate-y-0.5 active:scale-[0.97] animate-accept-attention',
        bid:
          'bg-bid-active text-white shadow-sm hover:bg-status-open hover:shadow-[0_0_20px_hsl(var(--bid-active)_/_0.35)] active:scale-[0.97]',
        urgent:
          'bg-trust-medium text-black shadow-sm hover:bg-trust-medium/90 animate-[gold-pulse_2s_ease-in-out_infinite]',
        premium:
          'gold-gradient text-white shadow-sm hover:shadow-[0_0_24px_var(--brand-gold-glow)] hover:-translate-y-0.5 relative overflow-hidden after:absolute after:inset-0 after:translate-x-[-100%] after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:animate-[shimmer-sweep_3s_ease-in-out_infinite]',
      },
      size: {
        default: 'h-11 min-h-[44px] min-w-[44px] px-4 py-2',
        sm: 'h-9 min-h-[44px] min-w-[44px] rounded-md px-3 text-xs',
        lg: 'h-12 min-h-[44px] min-w-[44px] rounded-md px-8',
        icon: 'h-11 w-11 min-h-[44px] min-w-[44px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
