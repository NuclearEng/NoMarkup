'use client';

import { cn } from '@/lib/utils';

interface GradientMeshProps {
  className?: string;
}

export function GradientMesh({ className }: GradientMeshProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 overflow-hidden',
        className,
      )}
      aria-hidden="true"
    >
      {/* Base dark background */}
      <div className="absolute inset-0 bg-[#070b14]" />

      {/* Blob 1 — rich deep navy/blue, top-left drift — larger for atmospheric coverage */}
      <div
        className="gradient-blob-1 absolute -top-1/4 -left-1/4 h-[1000px] w-[1000px] rounded-full opacity-70 will-change-transform"
        style={{
          background: 'radial-gradient(circle, #0d1f4a 0%, #091333 40%, transparent 70%)',
          filter: 'blur(100px)',
        }}
      />

      {/* Blob 2 — saturated violet, center-right drift */}
      <div
        className="gradient-blob-2 absolute -right-1/4 top-1/4 h-[900px] w-[900px] rounded-full opacity-55 will-change-transform"
        style={{
          background: 'radial-gradient(circle, #3d1f8e 0%, #241260 40%, transparent 70%)',
          filter: 'blur(110px)',
        }}
      />

      {/* Blob 3 — brighter emerald accent, bottom drift */}
      <div
        className="gradient-blob-3 absolute -bottom-1/4 left-1/3 h-[800px] w-[800px] rounded-full opacity-45 will-change-transform"
        style={{
          background: 'radial-gradient(circle, #0f4d3a 0%, #0a3328 40%, transparent 70%)',
          filter: 'blur(120px)',
        }}
      />

      {/* Blob 4 — subtle warm gold accent, drifting center */}
      <div
        className="gradient-blob-4 absolute top-1/2 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 will-change-transform"
        style={{
          background: 'radial-gradient(circle, #2a1f0e 0%, #0f0c05 40%, transparent 70%)',
          filter: 'blur(90px)',
        }}
      />

      {/* Film grain/noise overlay — slightly more visible for cinematic texture */}
      <div
        className="absolute inset-0 opacity-[0.045]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='5' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          backgroundSize: '256px 256px',
        }}
      />
    </div>
  );
}
