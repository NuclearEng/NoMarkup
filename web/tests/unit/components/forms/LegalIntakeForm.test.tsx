import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LegalIntakeForm } from '@/components/forms/LegalIntakeForm';
import type { CreateJobInput } from '@/types';

// Tell React we're running in an act() environment so async wrappers behave.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Radix Select uses ResizeObserver + pointer-capture, which jsdom lacks.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub;
  }
  Element.prototype.hasPointerCapture = (): boolean => false;
  Element.prototype.releasePointerCapture = (): void => {};
  Element.prototype.scrollIntoView = (): void => {};
});

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

// A minimal legal subtree mirroring the DB: a level-1 `legal` root with
// level-2 matter types as children. The form should surface these as the
// matter-type options — NOT the generic 3-level service-category picker.
const LEGAL_TREE = [
  {
    id: 'goods-root',
    parentId: null,
    name: 'Goods',
    slug: 'goods',
    level: 1,
    description: null,
    icon: null,
    sortOrder: 0,
    children: [],
  },
  {
    id: 'legal-root',
    parentId: null,
    name: 'Legal Services',
    slug: 'legal',
    level: 1,
    description: null,
    icon: null,
    sortOrder: 1,
    children: [
      { id: 'legal-doc-prep', parentId: 'legal-root', name: 'Document Preparation', slug: 'legal-doc-prep', level: 2, description: null, icon: null, sortOrder: 1, children: [] },
      { id: 'legal-contract-review', parentId: 'legal-root', name: 'Contract Review', slug: 'legal-contract-review', level: 2, description: null, icon: null, sortOrder: 2, children: [] },
      { id: 'legal-consultation', parentId: 'legal-root', name: 'Consultation', slug: 'legal-consultation', level: 2, description: null, icon: null, sortOrder: 3, children: [] },
    ],
  },
];

vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: () => ({ data: LEGAL_TREE, isLoading: false, isError: false, refetch: vi.fn() }),
}));

const createJobMutateAsyncMock = vi.fn<(input: CreateJobInput) => Promise<{ id: string }>>();
vi.mock('@/hooks/useJobs', () => ({
  useCreateJob: () => ({
    mutateAsync: createJobMutateAsyncMock,
    isPending: false,
    isError: false,
  }),
}));

describe('LegalIntakeForm', () => {
  beforeEach(() => {
    pushMock.mockReset();
    createJobMutateAsyncMock.mockReset();
    createJobMutateAsyncMock.mockResolvedValue({ id: 'job-123' });
  });

  it('renders the legal matter-type selector, not the generic service-category picker', async () => {
    const user = userEvent.setup();
    render(<LegalIntakeForm />);

    // The legal-tailored prompt is present.
    expect(
      screen.getByText(/what type of legal help do you need\?/i),
    ).toBeInTheDocument();

    // The generic wizard's "Service Category" label must NOT appear.
    expect(screen.queryByText(/service category/i)).not.toBeInTheDocument();

    // Opening the matter-type select reveals the legal matter types from the
    // legal subtree (and only those).
    const matterTrigger = screen.getByRole('combobox', {
      name: /what type of legal help do you need\?/i,
    });
    await user.click(matterTrigger);

    expect(await screen.findByRole('option', { name: 'Document Preparation' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Contract Review' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Consultation' })).toBeInTheDocument();
    // A non-legal category (Goods) must not leak into the matter types.
    expect(screen.queryByRole('option', { name: 'Goods' })).not.toBeInTheDocument();
  });

  it('submits a job in the chosen legal category with the right payload', async () => {
    const user = userEvent.setup();
    render(<LegalIntakeForm />);

    // Matter type → Contract Review (a legal category id).
    await user.click(
      screen.getByRole('combobox', { name: /what type of legal help do you need\?/i }),
    );
    await user.click(await screen.findByRole('option', { name: 'Contract Review' }));

    // Title + description (meet the min-length validators).
    await user.type(
      screen.getByLabelText(/give your matter a short title/i),
      'Review a commercial lease before I sign it',
    );
    await user.type(
      screen.getByLabelText(/describe your matter/i),
      'I have a five-year commercial lease and want an attorney to review the terms before I commit.',
    );

    // Jurisdiction → CA.
    await user.click(screen.getByRole('combobox', { name: /which state is this matter in\?/i }));
    await user.click(await screen.findByRole('option', { name: 'CA' }));

    // Budget. (The input sits inside a relative wrapper for the $ prefix, so
    // the FormLabel's htmlFor lands on the wrapper — query by placeholder.)
    await user.type(screen.getByPlaceholderText('500'), '500');

    // Submit.
    await user.click(screen.getByRole('button', { name: /post my legal job/i }));

    await waitFor(() => {
      expect(createJobMutateAsyncMock).toHaveBeenCalledTimes(1);
    });

    const input = createJobMutateAsyncMock.mock.calls[0]?.[0] as CreateJobInput;
    // The job carries the LEGAL category id so it lands in the legal vertical.
    expect(input.category_id).toBe('legal-contract-review');
    expect(input.title).toBe('Review a commercial lease before I sign it');
    expect(input.publish).toBe(true);
    // Budget converted to integer cents (server re-validates).
    expect(input.offer_accepted_cents).toBe(50000);
    // Jurisdiction folded into the description for the attorney.
    expect(input.description).toContain('Jurisdiction: CA');

    // On success we route the customer to their jobs list.
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/jobs/mine');
    });
  });
});
