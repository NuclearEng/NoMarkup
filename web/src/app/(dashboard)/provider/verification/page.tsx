'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { BackgroundCheckPanel } from '@/components/providers/BackgroundCheckPanel';
import { VerificationDocumentsPanel } from '@/components/providers/VerificationDocumentsPanel';
import { Button } from '@/components/ui/button';
import { PageTransition } from '@/components/ui/page-transition';

export default function ProviderVerificationPage() {
  return (
    <PageTransition>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-[var(--brand-gold)]" aria-hidden="true" />
              <h1 className="gold-text text-2xl font-bold tracking-tight">Verification documents</h1>
            </div>
            <p className="mt-1 text-zinc-300">
              View status, re-upload after rejection, and manage identity documents for bidding.
            </p>
          </div>
          <Button variant="outline" asChild className="min-h-[44px]">
            <Link href="/provider/onboarding">Provider onboarding</Link>
          </Button>
        </div>

        <BackgroundCheckPanel />
        <VerificationDocumentsPanel />
      </div>
    </PageTransition>
  );
}
