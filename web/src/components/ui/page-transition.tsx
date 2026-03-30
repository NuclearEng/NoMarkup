import { cn } from '@/lib/utils';

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <div className={cn('animate-page-enter', className)}>
      {children}
    </div>
  );
}

export { PageTransition };
export type { PageTransitionProps };
