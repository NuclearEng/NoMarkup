import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-emerald-500/20 text-emerald-400 shadow',
        secondary: 'border-transparent bg-zinc-500/20 text-zinc-300',
        destructive: 'border-transparent bg-red-500/20 text-red-400 shadow',
        outline: 'text-foreground',
        glass: 'glass-badge text-foreground',
        active: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
        draft: 'border-zinc-500/30 bg-zinc-500/15 text-zinc-400',
        awarded: 'border-blue-500/30 bg-blue-500/15 text-blue-400',
        'in-progress': 'border-amber-500/30 bg-amber-500/15 text-amber-400',
        completed: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
        disputed: 'border-red-500/30 bg-red-500/15 text-red-400',
        cancelled: 'border-red-500/30 bg-red-500/15 text-red-400',
        pending: 'border-amber-500/30 bg-amber-500/15 text-amber-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
