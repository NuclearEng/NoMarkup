'use client';

import { ChallengeManager } from '@/components/admin/ChallengeManager';
import { PageTransition } from '@/components/ui/page-transition';

export default function AdminChallengesPage() {
  return (
    <PageTransition>
    <div className="space-y-6">
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Challenge Management</h1>
        <p className="mt-1 text-zinc-400">
          Create and manage provider challenges and seasonal events.
        </p>
      </div>

      <ChallengeManager />
    </div>
    </PageTransition>
  );
}
