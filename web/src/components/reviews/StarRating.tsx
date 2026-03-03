'use client';

import { Star } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

interface StarRatingDisplayProps {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
}

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const SIZE_MAP = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
} as const;

const TOUCH_SIZE_MAP = {
  sm: 'min-h-[44px] min-w-[44px]',
  md: 'min-h-[44px] min-w-[44px]',
  lg: 'min-h-[44px] min-w-[44px]',
} as const;

export function StarRatingDisplay({ rating, size = 'md', showValue = false }: StarRatingDisplayProps) {
  const sizeClass = SIZE_MAP[size];

  return (
    <div className="flex items-center gap-1" aria-label={`Rating: ${String(rating)} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => {
        const starIndex = i + 1;
        const isFilled = starIndex <= Math.round(rating);
        return (
          <Star
            key={starIndex}
            className={cn(
              sizeClass,
              isFilled
                ? 'fill-yellow-400 text-yellow-400'
                : 'fill-none text-gray-300',
            )}
            aria-hidden="true"
          />
        );
      })}
      {showValue ? (
        <span className="ml-1 text-sm font-medium text-muted-foreground">
          {rating.toFixed(1)}
        </span>
      ) : null}
    </div>
  );
}

export function StarRatingInput({ value, onChange, size = 'md', label }: StarRatingInputProps) {
  const [hoverValue, setHoverValue] = useState(0);
  const sizeClass = SIZE_MAP[size];
  const touchClass = TOUCH_SIZE_MAP[size];

  const displayValue = hoverValue > 0 ? hoverValue : value;

  return (
    <div
      className="flex items-center"
      role="radiogroup"
      aria-label={label ?? 'Star rating'}
    >
      {Array.from({ length: 5 }, (_, i) => {
        const starIndex = i + 1;
        const isFilled = starIndex <= displayValue;
        return (
          <button
            key={starIndex}
            type="button"
            role="radio"
            aria-checked={starIndex === value}
            aria-label={`${String(starIndex)} star${starIndex !== 1 ? 's' : ''}`}
            className={cn(
              'flex items-center justify-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              touchClass,
            )}
            onClick={() => { onChange(starIndex); }}
            onMouseEnter={() => { setHoverValue(starIndex); }}
            onMouseLeave={() => { setHoverValue(0); }}
          >
            <Star
              className={cn(
                sizeClass,
                isFilled
                  ? 'fill-yellow-400 text-yellow-400'
                  : 'fill-none text-gray-300 hover:text-yellow-300',
              )}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
