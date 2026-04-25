// Smoke test for the provider onboarding wizard.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/onboarding',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({ uploadImage: vi.fn(), isUploading: false }),
}));

import ProviderOnboardingPage from '@/app/(dashboard)/provider/onboarding/page';

describe('ProviderOnboardingPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderOnboardingPage)));
    expect(container).toBeTruthy();
  });
});
