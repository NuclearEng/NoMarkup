import type { Metadata } from 'next';

import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

export const metadata: Metadata = {
  title: 'Finish setup',
  description: 'Add a display name, phone, service address, or provider role.',
};

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <OnboardingWizard />
    </div>
  );
}
