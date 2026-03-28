'use client';

import { ChallengeManager } from '@/components/admin/ChallengeManager';

export default function AdminChallengesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Challenge Management</h1>
        <p className="mt-1 text-muted-foreground">
          Create and manage provider challenges and seasonal events.
        </p>
      </div>

      <ChallengeManager />
    </div>
  );
}
