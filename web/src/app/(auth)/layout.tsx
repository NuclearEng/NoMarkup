import { Logo } from '@/components/layout/Logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="from-background via-background to-muted/30 relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-br px-4 py-8">
      {/* Subtle dot pattern for visual depth */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.04)_1px,transparent_0)] bg-[size:24px_24px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.035)_1px,transparent_0)]" />

      {/* Brand gold radial glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 opacity-[0.07] dark:opacity-[0.05]"
        style={{
          background: 'radial-gradient(ellipse at center, var(--brand-gold) 0%, transparent 70%)',
        }}
        aria-hidden="true"
      />

      <div className="animate-fade-in relative mb-8">
        <Logo size="lg" />
      </div>
      <div className="animate-auth-card-enter relative w-full max-w-md">{children}</div>
    </div>
  );
}
