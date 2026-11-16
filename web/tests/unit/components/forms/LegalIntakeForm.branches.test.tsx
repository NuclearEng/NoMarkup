import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createContext, useContext, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateJobInput } from '@/types';

interface TreeNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  level: number;
  description: null;
  icon: null;
  sortOrder: number;
  children: TreeNode[];
}

const push = vi.fn();
const refetch = vi.fn();
const treeState: { data: TreeNode[] | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
const createState = { isPending: false };
const mutateAsync = vi.fn<(input: CreateJobInput) => Promise<unknown>>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: () => ({ ...treeState, refetch }),
}));

vi.mock('@/hooks/useJobs', () => ({
  useCreateJob: () => ({
    mutateAsync,
    get isPending(): boolean {
      return createState.isPending;
    },
  }),
}));

// Radix Select needs pointer capture + portals in jsdom; a listbox of clickable
// options keeps the value / onValueChange contract. Option labels are unique
// across the form's selects, so tests pick by option name.
vi.mock('@/components/ui/select', () => {
  const Ctx = createContext<{ value: string; onValueChange: (v: string) => void }>({
    value: '',
    onValueChange: () => undefined,
  });
  function Select({
    children,
    value,
    onValueChange,
  }: {
    children?: ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) {
    return (
      <Ctx.Provider value={{ value: value ?? '', onValueChange: onValueChange ?? (() => undefined) }}>
        <div>{children}</div>
      </Ctx.Provider>
    );
  }
  function SelectItem({ children, value }: { children?: ReactNode; value: string }) {
    const ctx = useContext(Ctx);
    return (
      <div
        role="option"
        tabIndex={0}
        aria-selected={ctx.value === value}
        onClick={() => {
          ctx.onValueChange(value);
        }}
        onKeyDown={() => undefined}
      >
        {children}
      </div>
    );
  }
  return {
    Select,
    SelectItem,
    SelectContent: ({ children }: { children?: ReactNode }) => <div role="listbox">{children}</div>,
    SelectTrigger: () => null,
    SelectValue: () => null,
  };
});

import { LegalIntakeForm } from '@/components/forms/LegalIntakeForm';

function node(id: string, name: string, slug: string, children: TreeNode[] = []): TreeNode {
  return { id, parentId: null, name, slug, level: 1, description: null, icon: null, sortOrder: 0, children };
}

function legalTree(): TreeNode[] {
  return [
    node('goods-root', 'Goods', 'goods'),
    node('legal-root', 'Legal Services', 'legal', [
      node('legal-doc-prep', 'Document Preparation', 'legal-doc-prep'),
      node('legal-contract-review', 'Contract Review', 'legal-contract-review'),
    ]),
  ];
}

const TITLE = 'Review a commercial lease';
const DESCRIPTION =
  'I am about to sign a five year commercial lease and want the indemnity clauses reviewed first.';

function pick(optionName: string): void {
  fireEvent.click(screen.getByRole('option', { name: optionName }));
}

function fillRequired(): void {
  pick('Contract Review');
  fireEvent.change(screen.getByPlaceholderText(/Review a commercial lease before I sign/), {
    target: { value: TITLE },
  });
  fireEvent.change(screen.getByPlaceholderText(/What's going on/), { target: { value: DESCRIPTION } });
  pick('CA');
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Post my legal job/ }));
    await Promise.resolve();
  });
}

function submittedInput(): CreateJobInput {
  const call = mutateAsync.mock.calls[0];
  if (!call) throw new Error('job was not created');
  return call[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  treeState.data = legalTree();
  treeState.isLoading = false;
  treeState.isError = false;
  createState.isPending = false;
  mutateAsync.mockResolvedValue({ id: 'job-1' });
});

describe('LegalIntakeForm matter-type loading states', () => {
  it('shows a labelled skeleton while the category tree loads', () => {
    treeState.data = undefined;
    treeState.isLoading = true;
    render(<LegalIntakeForm />);
    expect(screen.getByRole('status', { name: 'Loading legal matter types' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Contract Review' })).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the tree fails to load', () => {
    treeState.data = undefined;
    treeState.isError = true;
    render(<LegalIntakeForm />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load the legal matter types. Please retry.",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the same retry state when the tree has no legal subtree', () => {
    treeState.data = [node('goods-root', 'Goods', 'goods')];
    render(<LegalIntakeForm />);
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load the legal matter types/);
    expect(screen.queryByRole('option', { name: 'Goods' })).not.toBeInTheDocument();
  });
});

describe('LegalIntakeForm deep-link preset', () => {
  it('pre-selects a valid preset matter type', () => {
    render(<LegalIntakeForm presetMatterCategoryId="legal-doc-prep" />);
    expect(screen.getByRole('option', { name: 'Document Preparation' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('ignores a preset that is not a legal matter type', () => {
    render(<LegalIntakeForm presetMatterCategoryId="goods-root" />);
    expect(screen.getByRole('option', { name: 'Document Preparation' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('option', { name: 'Contract Review' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it("does not overwrite the user's own choice when the tree refreshes", () => {
    const { rerender } = render(<LegalIntakeForm presetMatterCategoryId="goods-root" />);
    pick('Contract Review');
    treeState.data = legalTree();
    rerender(<LegalIntakeForm presetMatterCategoryId="legal-doc-prep" />);
    expect(screen.getByRole('option', { name: 'Contract Review' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: 'Document Preparation' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});

describe('LegalIntakeForm validation', () => {
  it('blocks an empty submission and explains each missing field', async () => {
    render(<LegalIntakeForm />);
    await submit();
    expect(await screen.findByText('Select the type of legal help you need')).toBeInTheDocument();
    expect(screen.getByText('Select the state your matter is in')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('treats a $0 budget as "no ceiling" rather than a zero-dollar cap', async () => {
    render(<LegalIntakeForm />);
    fillRequired();
    fireEvent.change(screen.getByPlaceholderText('500'), { target: { value: '0' } });
    await submit();
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(submittedInput().offer_accepted_cents).toBeUndefined();
  });

  it('counts title characters as the user types', () => {
    render(<LegalIntakeForm />);
    expect(screen.getByText('0/200 characters (minimum 10)')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Review a commercial lease before I sign/), {
      target: { value: 'Lease' },
    });
    expect(screen.getByText('5/200 characters (minimum 10)')).toBeInTheDocument();
  });
});

describe('LegalIntakeForm submission mapping', () => {
  it('maps an urgent matter with a budget to a same-day, date-range sealed auction', async () => {
    render(<LegalIntakeForm />);
    fillRequired();
    pick('Urgent — within 48 hours');
    expect(screen.getByText('Deadline, hearing, or time-sensitive filing.')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('500'), { target: { value: '750' } });
    pick('Video consultation');
    await submit();

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/jobs/mine');
    });
    expect(submittedInput()).toEqual({
      category_id: 'legal-contract-review',
      title: TITLE,
      description: `${DESCRIPTION}\n\n— Jurisdiction: CA\n— Preferred contact: Video consultation`,
      schedule_type: 'date_range',
      is_recurring: false,
      offer_accepted_cents: 75000,
      auction_duration_hours: 72,
      auction_type: 'sealed',
      same_day_requested: true,
      publish: true,
    });
  });

  it('maps a flexible matter with no budget to a flexible schedule with no ceiling or same-day flag', async () => {
    render(<LegalIntakeForm />);
    fillRequired();
    pick('Flexible — no firm deadline');
    expect(screen.getByText('Looking for the right fit at the right price.')).toBeInTheDocument();
    pick('Phone call');
    await submit();

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    const input = submittedInput();
    expect(input.schedule_type).toBe('flexible');
    expect(input.offer_accepted_cents).toBeUndefined();
    expect(input.same_day_requested).toBeUndefined();
    expect(input.description).toContain('— Preferred contact: Phone call');
  });

  it('treats a cleared budget as no budget', async () => {
    render(<LegalIntakeForm />);
    fillRequired();
    const budget = screen.getByPlaceholderText('500');
    fireEvent.change(budget, { target: { value: '300' } });
    fireEvent.change(budget, { target: { value: '' } });
    expect(budget).toHaveValue(null);
    await submit();
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(submittedInput().offer_accepted_cents).toBeUndefined();
  });
});

describe('LegalIntakeForm submission failures', () => {
  it('shows the server reason and stays on the form', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('phone number not verified'));
    render(<LegalIntakeForm />);
    fillRequired();
    await submit();
    expect(await screen.findByText('phone number not verified')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('uses fallback copy for a non-Error failure', async () => {
    mutateAsync.mockRejectedValueOnce('nope');
    render(<LegalIntakeForm />);
    fillRequired();
    await submit();
    expect(
      await screen.findByText('Could not post your legal job. Please try again.'),
    ).toBeInTheDocument();
  });

  it('disables submit and shows a posting label while the job is being created', () => {
    createState.isPending = true;
    render(<LegalIntakeForm />);
    expect(screen.getByRole('button', { name: 'Posting…' })).toBeDisabled();
  });
});
