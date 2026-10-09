import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'animate-fade-in flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="bg-muted text-muted-foreground mb-4 flex h-16 w-16 items-center justify-center rounded-full">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold">{title}</h3>
      {description ? (
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 [&_button]:min-h-[44px] [&_a]:min-h-[44px]">
          {action}
        </div>
      ) : null}
    </div>
  );
}
