import { Logo } from '@/components/layout/Logo';
import { GradientMesh } from '@/components/landing/GradientMesh';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#070b14] px-4 py-8">
      {/* Animated gradient mesh background — same as hero */}
      <GradientMesh className="z-0" />

      {/* Vignette overlay — dark edges for depth */}
      <div
        className="auth-vignette pointer-events-none absolute inset-0 z-[1]"
        aria-hidden="true"
      />

      {/* Brand gold radial glow — centered behind card */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 z-[1] h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 opacity-[0.06]"
        style={{
          background: 'radial-gradient(ellipse at center, var(--brand-gold) 0%, transparent 70%)',
        }}
        aria-hidden="true"
      />

      <div className="animate-fade-in relative z-[2] mb-8">
        <Logo size="lg" />
      </div>
      <div className="animate-auth-card-enter relative z-[2] w-full max-w-md">{children}</div>
    </div>
  );
}
