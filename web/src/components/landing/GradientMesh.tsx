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

      {/* Blob 1 — deep navy/blue, top-left drift */}
      <div
        className="gradient-blob-1 absolute -top-1/4 -left-1/4 h-[800px] w-[800px] rounded-full opacity-60 will-change-transform"
        style={{
          background: 'radial-gradient(circle, #0f1b3d 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />

      {/* Blob 2 — violet, center-right drift */}
      <div
        className="gradient-blob-2 absolute -right-1/4 top-1/4 h-[700px] w-[700px] rounded-full opacity-50 will-change-transform"
        style={{
          background: 'radial-gradient(circle, #2d1b69 0%, transparent 70%)',
          filter: 'blur(90px)',
        }}
      />

      {/* Blob 3 — emerald, bottom drift */}
      <div
        className="gradient-blob-3 absolute -bottom-1/4 left-1/3 h-[600px] w-[600px] rounded-full opacity-40 will-change-transform"
        style={{
          background: 'radial-gradient(circle, #0d3b2e 0%, transparent 70%)',
          filter: 'blur(100px)',
        }}
      />

      {/* Blob 4 — subtle dark blue accent */}
      <div
        className="gradient-blob-4 absolute top-1/2 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 will-change-transform"
        style={{
          background: 'radial-gradient(circle, #0a0f1e 0%, transparent 70%)',
          filter: 'blur(70px)',
        }}
      />

      {/* Subtle grain overlay for texture */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}
