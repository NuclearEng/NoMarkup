// Smoke test for the file-a-dispute multi-step wizard.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/disputes/new',
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

vi.mock('@/hooks/useContracts', () => ({
  useContracts: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useDisputes', () => ({
  useFileDispute: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}));

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({ uploadImage: vi.fn(), isUploading: false }),
}));

import DisputeNewPage from '@/app/(dashboard)/disputes/new/page';

describe('DisputeNewPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(DisputeNewPage)));
    expect(container).toBeTruthy();
  });
});
