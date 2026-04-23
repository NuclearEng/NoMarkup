'use client';

import { useState, useEffect, useRef } from 'react';

import { formatCents } from '@/lib/utils';

interface SavingsCelebrationProps {
  savingsCents: number;
  jobTitle: string;
  onClose: () => void;
}

export function SavingsCelebration({ savingsCents, jobTitle, onClose }: SavingsCelebrationProps) {
  const [visible, setVisible] = useState(false);
  const [particles, setParticles] = useState<
    Array<{ id: number; x: number; y: number; color: string; delay: number }>
  >([]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const newParticles = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: -10 - Math.random() * 20,
      color:
        (['#10b981', '#059669', '#34d399', '#6ee7b7', '#a7f3d0', '#fbbf24', '#f59e0b'] as const)[
          Math.floor(Math.random() * 7)
        ] ?? '#10b981',
      delay: Math.random() * 0.5,
    }));
    setParticles(newParticles);

    requestAnimationFrame(() => {
      setVisible(true);
    });

    const timer = setTimeout(() => {
      onCloseRef.current();
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  if (!visible && particles.length === 0) return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- overlay dismissal via click/keyboard
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="dialog"
      aria-label={`You saved ${formatCents(savingsCents)}`}
      aria-modal="true"
    >
      {/* Confetti particles */}
      {particles.map((p) => (
        <div
          key={p.id}
          className="animate-confetti-fall absolute h-2 w-2 rounded-full"
          style={{
            left: `${String(p.x)}%`,
            top: `${String(p.y)}%`,
            backgroundColor: p.color,
            animationDelay: `${String(p.delay)}s`,
          }}
        />
      ))}

      {/* Savings card */}
      <div
        className={`text-center transition-all duration-500 ${visible ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}
      >
        <div className="mb-2 text-6xl font-bold text-white tabular-nums">
          {formatCents(savingsCents)}
        </div>
        <div className="mb-1 text-xl font-medium text-emerald-400">saved on NoMarkup</div>
        <div className="text-sm text-white/70">{jobTitle}</div>
      </div>
    </div>
  );
}
