import { cn } from '@/lib/utils';

const GOLD_CARD_VARIANT = {
  SUBTLE: 'subtle',
  PROMINENT: 'prominent',
  WINNING: 'winning',
} as const;
type GoldCardVariant = (typeof GOLD_CARD_VARIANT)[keyof typeof GOLD_CARD_VARIANT];

interface GoldAccentCardProps {
  children: React.ReactNode;
  variant?: GoldCardVariant;
  className?: string;
}

export function GoldAccentCard({
  children,
  variant = GOLD_CARD_VARIANT.SUBTLE,
  className,
}: GoldAccentCardProps) {
  return (
    <div
      className={cn(
        'bg-card text-card-foreground rounded-xl border shadow transition-all duration-200',
        variant === GOLD_CARD_VARIANT.SUBTLE &&
          'border-t-2 border-t-[var(--brand-gold)] hover:shadow-md',
        variant === GOLD_CARD_VARIANT.PROMINENT &&
          'border-l-[3px] border-l-[var(--brand-gold)] shadow-[0_2px_12px_-3px_var(--brand-gold-glow)] hover:shadow-[0_4px_20px_-4px_var(--brand-gold-glow)]',
        variant === GOLD_CARD_VARIANT.WINNING &&
          'gold-border border-[1.5px] animate-glow-breathe',
        className,
      )}
    >
      {children}
    </div>
  );
}

export { GOLD_CARD_VARIANT };
export type { GoldCardVariant, GoldAccentCardProps };
