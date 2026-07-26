'use client';

import { MailWarning, X } from 'lucide-react';
import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { MobileTabBar } from '@/components/layout/MobileTabBar';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { AuthGuard } from '@/components/providers/AuthGuard';
import { WebSocketProvider } from '@/components/providers/WebSocketProvider';
import { useProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';

function EmailVerificationBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const { data: profile } = useProfile();

  if (dismissed || !profile || profile.emailVerified) return null;

  async function handleResend() {
    if (!profile) return;
    setResending(true);
    try {
      await api.post('/api/v1/auth/resend-verification', { email: profile.email });
      setResent(true);
    } catch {
      // silently ignore — the email may already be sent
    } finally {
      setResending(false);
    }
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/[0.07] px-4 py-2.5"
    >
      <MailWarning className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
      <p className="flex-1 text-sm text-amber-200">
        {resent
          ? 'Verification email sent! Check your inbox.'
          : 'Verify your email address to unlock all features.'}
      </p>
      {!resent ? (
        <button
          type="button"
          onClick={() => { void handleResend(); }}
          disabled={resending}
          className="min-h-[44px] shrink-0 px-2 text-xs font-medium text-amber-400 underline-offset-2 hover:underline disabled:opacity-50"
        >
          {resending ? 'Sending…' : 'Resend email'}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => { setDismissed(true); }}
        aria-label="Dismiss verification notice"
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded text-amber-400/60 hover:text-amber-400"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-[100dvh] flex-col overflow-x-clip bg-background">
        <Header />
        <EmailVerificationBanner />

        <div className="flex min-w-0 flex-1">
          {/* Desktop sidebar — hidden on mobile. Shared with the marketplace. */}
          <SidebarNav />

          <WebSocketProvider>
            <div className="dashboard-ambient min-w-0 flex-1 overflow-x-clip px-3 pt-3 pb-2 sm:px-4 sm:pt-4 md:px-6 md:pt-6">
              {children}
            </div>
          </WebSocketProvider>
        </div>

        {/* The one mobile nav system (bottom tabs + More). Its in-flow spacer
            clears the fixed bar, so no bottom inset is needed on the content. */}
        <MobileTabBar />
      </div>
    </AuthGuard>
  );
}
