'use client';

import { Children, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface StaggerChildrenProps {
  children: React.ReactNode;
  staggerMs?: number;
  initialDelay?: number;
  animation?: 'fade-up' | 'fade-in' | 'scale-in';
  className?: string;
}

const ANIMATION_MAP = {
  'fade-up': 'stagger-fade-up',
  'fade-in': 'stagger-fade-in',
  'scale-in': 'stagger-scale-in',
} as const;

const ANIMATION_DURATION = '400ms';
const ANIMATION_EASING = 'ease-out';

function StaggerChildren({
  children,
  staggerMs = 50,
  initialDelay = 0,
  animation = 'fade-up',
  className,
}: StaggerChildrenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    if (prefersReducedMotion) {
      setIsVisible(true);
      return;
    }

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          // Observe once, then disconnect
          observerRef.current?.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    observerRef.current.observe(node);

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const animationName = ANIMATION_MAP[animation];
  const childArray = Children.toArray(children);

  return (
    <div ref={containerRef} className={cn(className)}>
      {childArray.map((child, index) => {
        const delay = initialDelay + index * staggerMs;

        return (
          <div
            key={index}
            className="stagger-animated"
            style={
              isVisible
                ? {
                    animation: `${animationName} ${ANIMATION_DURATION} ${ANIMATION_EASING} ${String(delay)}ms both`,
                  }
                : {
                    opacity: 0,
                  }
            }
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}

export { StaggerChildren };
export type { StaggerChildrenProps };
