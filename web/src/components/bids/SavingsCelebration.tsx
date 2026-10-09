'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

const CELEBRATION_TIER = {
  NICE: 'nice',
  GREAT: 'great',
  AMAZING: 'amazing',
  LEGENDARY: 'legendary',
} as const;
type CelebrationTier = (typeof CELEBRATION_TIER)[keyof typeof CELEBRATION_TIER];

interface SavingsCelebrationProps {
  savingsPercent: number;
  isVisible: boolean;
  onDismiss: () => void;
  onPlaySound?: (tier: CelebrationTier) => void;
  className?: string;
}

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  color: string;
  shape: 'circle' | 'rect' | 'diamond';
  opacity: number;
  decay: number;
}

/** CSS custom-property names resolved at confetti start (canvas needs concrete colors). */
const TIER_CONFIGS: Record<
  CelebrationTier,
  {
    label: string;
    particleCount: number;
    colorVars: string[];
    showBurst: boolean;
    showEdgeGlow: boolean;
  }
> = {
  [CELEBRATION_TIER.NICE]: {
    label: 'Nice Savings!',
    particleCount: 24,
    colorVars: ['--brand-green', '--brand-green-dim', '--brand-teal'],
    showBurst: false,
    showEdgeGlow: false,
  },
  [CELEBRATION_TIER.GREAT]: {
    label: 'Great Deal!',
    particleCount: 48,
    colorVars: [
      '--brand-green',
      '--brand-green-dim',
      '--brand-gold',
      '--brand-gold-bright',
      '--brand-teal',
    ],
    showBurst: false,
    showEdgeGlow: false,
  },
  [CELEBRATION_TIER.AMAZING]: {
    label: 'Amazing Deal!',
    particleCount: 72,
    colorVars: [
      '--brand-gold',
      '--brand-gold-bright',
      '--brand-gold-dim',
      '--trust-medium',
    ],
    showBurst: true,
    showEdgeGlow: false,
  },
  [CELEBRATION_TIER.LEGENDARY]: {
    label: 'Legendary Savings!',
    particleCount: 120,
    colorVars: [
      '--brand-gold',
      '--brand-gold-bright',
      '--brand-gold-dim',
      '--trust-medium',
      '--destructive',
      '--brand-green',
    ],
    showBurst: true,
    showEdgeGlow: true,
  },
};

/** Resolve a CSS custom property (and HSL-channel tokens) for canvas fillStyle. */
function resolveTokenColor(varName: string): string {
  if (typeof window === 'undefined') return '';
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return '';
  // Trust / status tokens are stored as HSL channels without the hsl() wrapper.
  if (varName.startsWith('--trust-') || varName.startsWith('--status-') || varName.startsWith('--bid-')) {
    return `hsl(${raw})`;
  }
  return raw;
}

function resolveConfettiColors(colorVars: string[]): string[] {
  const resolved = colorVars.map(resolveTokenColor).filter((c) => c.length > 0);
  // Canvas requires at least one fill — fall back to brand green via CSS when empty.
  if (resolved.length === 0) {
    const green = resolveTokenColor('--brand-green');
    return green ? [green] : ['currentColor'];
  }
  return resolved;
}

function getTier(savingsPercent: number): CelebrationTier {
  if (savingsPercent >= 40) return CELEBRATION_TIER.LEGENDARY;
  if (savingsPercent >= 30) return CELEBRATION_TIER.AMAZING;
  if (savingsPercent >= 20) return CELEBRATION_TIER.GREAT;
  return CELEBRATION_TIER.NICE;
}

function createParticle(
  canvasWidth: number,
  canvasHeight: number,
  colors: string[],
): ConfettiParticle {
  const colorIndex = Math.floor(Math.random() * colors.length);
  const shapes: ConfettiParticle['shape'][] = ['circle', 'rect', 'diamond'];
  const shapeIndex = Math.floor(Math.random() * shapes.length);

  return {
    x: canvasWidth / 2 + (Math.random() - 0.5) * canvasWidth * 0.4,
    y: canvasHeight / 2,
    vx: (Math.random() - 0.5) * 12,
    vy: -(Math.random() * 8 + 4),
    rotation: Math.random() * 360,
    rotationSpeed: (Math.random() - 0.5) * 10,
    size: Math.random() * 6 + 3,
    color: colors[colorIndex] ?? colors[0] ?? 'currentColor',
    shape: shapes[shapeIndex] ?? 'circle',
    opacity: 1,
    decay: 0.008 + Math.random() * 0.008,
  };
}

function drawParticle(ctx: CanvasRenderingContext2D, particle: ConfettiParticle) {
  ctx.save();
  ctx.translate(particle.x, particle.y);
  ctx.rotate((particle.rotation * Math.PI) / 180);
  ctx.globalAlpha = particle.opacity;
  ctx.fillStyle = particle.color;

  switch (particle.shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, particle.size / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'rect':
      ctx.fillRect(
        -particle.size / 2,
        -particle.size / 4,
        particle.size,
        particle.size / 2,
      );
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(0, -particle.size / 2);
      ctx.lineTo(particle.size / 3, 0);
      ctx.lineTo(0, particle.size / 2);
      ctx.lineTo(-particle.size / 3, 0);
      ctx.closePath();
      ctx.fill();
      break;
  }

  ctx.restore();
}

/** Determine the celebration tier and trigger a canvas-based confetti celebration. */
export function triggerCelebration(savingsPercent: number): CelebrationTier {
  return getTier(savingsPercent);
}

export function SavingsCelebration({
  savingsPercent,
  isVisible,
  onDismiss,
  onPlaySound,
  className,
}: SavingsCelebrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<ConfettiParticle[]>([]);
  const animFrameRef = useRef<number>(0);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showText, setShowText] = useState(false);

  const tier = getTier(savingsPercent);
  const config = TIER_CONFIGS[tier];

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const startConfetti = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = resolveConfettiColors(config.colorVars);
    particlesRef.current = Array.from({ length: config.particleCount }, () =>
      createParticle(canvas.width, canvas.height, colors),
    );

    function animate() {
      const canvasEl = canvasRef.current;
      if (!canvasEl) return;
      const context = canvasEl.getContext('2d');
      if (!context) return;

      context.clearRect(0, 0, canvasEl.width, canvasEl.height);

      const liveParticles: ConfettiParticle[] = [];
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15; // gravity
        p.rotation += p.rotationSpeed;
        p.opacity -= p.decay;

        if (p.opacity > 0 && p.y < canvasEl.height + 20) {
          drawParticle(context, p);
          liveParticles.push(p);
        }
      }

      particlesRef.current = liveParticles;

      if (liveParticles.length > 0) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    }

    animFrameRef.current = requestAnimationFrame(animate);
  }, [config.colorVars, config.particleCount, prefersReducedMotion]);

  useEffect(() => {
    if (!isVisible) {
      setShowOverlay(false);
      setShowText(false);
      return;
    }

    setShowOverlay(true);

    onPlaySound?.(tier);

    // Stagger the text reveal
    const textTimer = setTimeout(() => {
      setShowText(true);
    }, 200);

    // Start confetti after a small delay
    const confettiTimer = setTimeout(() => {
      startConfetti();
    }, 100);

    // Auto-dismiss after 3 seconds
    const dismissTimer = setTimeout(() => {
      onDismiss();
    }, 3000);

    return () => {
      clearTimeout(textTimer);
      clearTimeout(confettiTimer);
      clearTimeout(dismissTimer);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [isVisible, tier, onDismiss, onPlaySound, startConfetti]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  if (!isVisible) return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- overlay dismissal via click/keyboard
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center',
        className,
      )}
      onClick={onDismiss}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter') onDismiss();
      }}
      role="status"
      aria-live="polite"
      aria-label={`Celebration: ${config.label} You saved ${String(Math.round(savingsPercent))} percent`}
    >
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/40 transition-opacity duration-300',
          showOverlay ? 'opacity-100' : 'opacity-0',
        )}
      />

      {/* Canvas for confetti */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      />

      {/* Expanding ring burst (amazing + legendary) */}
      {config.showBurst ? (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 gold-border animate-celebration-burst"
          aria-hidden="true"
        />
      ) : null}

      {/* Edge glow (legendary only) */}
      {config.showEdgeGlow ? (
        <div
          className="pointer-events-none absolute inset-0 animate-glow-breathe"
          style={{
            boxShadow:
              'inset 0 0 80px var(--brand-gold-glow), inset 0 0 160px rgba(201, 168, 76, 0.1)',
          }}
          aria-hidden="true"
        />
      ) : null}

      {/* Center text */}
      <div
        className={cn(
          'relative z-10 text-center transition-all duration-500',
          showText
            ? 'scale-100 opacity-100'
            : 'scale-75 opacity-0',
          showText && !prefersReducedMotion && 'animate-celebration-scale-bounce',
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-8 py-6 backdrop-blur-sm',
            tier === CELEBRATION_TIER.LEGENDARY
              ? 'bg-black/60 gold-glow'
              : tier === CELEBRATION_TIER.AMAZING
                ? 'bg-black/50 gold-glow'
                : 'bg-black/50',
          )}
        >
          {tier === CELEBRATION_TIER.LEGENDARY ? (
            <p className="mb-2 text-2xl" aria-hidden="true">
              {/* Fire emoji only for legendary -- specified in requirements */}
              {'\uD83D\uDD25'}
            </p>
          ) : null}
          <p
            className={cn(
              'text-2xl font-bold sm:text-3xl',
              tier === CELEBRATION_TIER.LEGENDARY || tier === CELEBRATION_TIER.AMAZING
                ? 'gold-text'
                : 'text-white',
            )}
          >
            {config.label}
          </p>
          <p className="mt-2 text-lg font-semibold text-white/90">
            {String(Math.round(savingsPercent))}% below budget
          </p>
        </div>
      </div>
    </div>
  );
}
