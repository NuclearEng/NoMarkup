'use client';

import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/lib/query-client';
import { TooltipProvider } from '@/components/ui/tooltip';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={500}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
