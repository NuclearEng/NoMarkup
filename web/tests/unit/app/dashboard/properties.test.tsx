// Tests for the properties management page — exercises loading/error/empty
// states, the add-property form toggle, and the two-step delete confirmation.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const propertiesState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const refetch = vi.fn();
const createMutate = vi.fn(() => Promise.resolve({}));
const deleteMutate = vi.fn(() => Promise.resolve({}));
const createState = { isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/properties',
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

const preferredState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
} = { data: { providers: [], preferred_threshold: 3 }, isLoading: false, isError: false };

vi.mock('@/hooks/useProperties', () => ({
  useCreateProperty: () => ({
    mutateAsync: createMutate,
    isPending: createState.isPending,
  }),
  useDeleteProperty: () => ({ mutateAsync: deleteMutate, isPending: false }),
  useProperties: () => ({
    data: propertiesState.data,
    isLoading: propertiesState.isLoading,
    isError: propertiesState.isError,
    refetch,
  }),
  usePreferredProviders: () => ({
    data: preferredState.data,
    isLoading: preferredState.isLoading,
    isError: preferredState.isError,
  }),
}));

const { default: PropertiesPage } = await import('@/app/(dashboard)/properties/page');

const lakeHouse = {
  id: 'p1',
  nickname: 'Lake House',
  address: { street: '123 Lakefront Rd', city: 'Bellevue', state: 'WA', zip_code: '98004' },
  notes: 'Gate code 1234',
  active_jobs: 2,
  total_spend_cents: 250000,
};
const studio = {
  id: 'p2',
  nickname: 'Studio',
  address: { street: '456 City Ave', city: 'Seattle', state: 'WA', zip_code: '98101' },
  notes: '',
  active_jobs: 1,
  total_spend_cents: 50000,
};

beforeEach(() => {
  propertiesState.data = undefined;
  propertiesState.isLoading = false;
  propertiesState.isError = false;
  preferredState.data = { providers: [], preferred_threshold: 3 };
  preferredState.isLoading = false;
  preferredState.isError = false;
  createState.isPending = false;
  refetch.mockClear();
  createMutate.mockClear();
  deleteMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PropertiesPage', () => {
  it('renders loading state while properties are loading', () => {
    propertiesState.isLoading = true;
    render(withQueryClient(createElement(PropertiesPage)));
    expect(screen.queryByText('Lake House')).toBeNull();
    expect(screen.queryByText(/no properties yet/i)).toBeNull();
  });

  it('renders error state and triggers refetch on Retry', () => {
    propertiesState.isError = true;
    render(withQueryClient(createElement(PropertiesPage)));
    expect(screen.getByText(/failed to load properties/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when no properties', () => {
    propertiesState.data = [];
    render(withQueryClient(createElement(PropertiesPage)));
    expect(screen.getByText(/no properties yet/i)).toBeDefined();
  });

  it('renders property cards when data present', () => {
    propertiesState.data = [lakeHouse, studio];
    render(withQueryClient(createElement(PropertiesPage)));
    expect(screen.getByText('Lake House')).toBeDefined();
    expect(screen.getByText('Studio')).toBeDefined();
    expect(screen.getByText(/123 Lakefront Rd/)).toBeDefined();
  });

  it('uses correct singular/plural copy for active jobs counts', () => {
    propertiesState.data = [studio, { ...lakeHouse, active_jobs: 0 }];
    render(withQueryClient(createElement(PropertiesPage)));
    expect(screen.getByText(/^1 active job$/)).toBeDefined();
    expect(screen.getByText(/^0 active jobs$/)).toBeDefined();
  });

  it('renders notes only when present', () => {
    propertiesState.data = [lakeHouse, studio];
    render(withQueryClient(createElement(PropertiesPage)));
    expect(screen.getByText('Gate code 1234')).toBeDefined();
  });

  it('toggles the add-property form when "Add Property" header button clicked', () => {
    propertiesState.data = [lakeHouse];
    render(withQueryClient(createElement(PropertiesPage)));
    fireEvent.click(screen.getAllByRole('button', { name: /add property/i })[0] as HTMLElement);
    expect(screen.getByText('Add New Property')).toBeDefined();
    expect(screen.getByLabelText(/nickname/i)).toBeDefined();
  });

  it('hides the add-property form when Cancel clicked', () => {
    propertiesState.data = [lakeHouse];
    render(withQueryClient(createElement(PropertiesPage)));
    fireEvent.click(screen.getAllByRole('button', { name: /add property/i })[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText('Add New Property')).toBeNull();
  });

  it('requires confirmation before deleting a property', () => {
    propertiesState.data = [lakeHouse];
    render(withQueryClient(createElement(PropertiesPage)));
    fireEvent.click(screen.getByRole('button', { name: /^delete lake house$/i }));
    expect(deleteMutate).not.toHaveBeenCalled();
    // After first click the button switches to confirm mode.
    expect(screen.getByRole('button', { name: /confirm delete lake house/i })).toBeDefined();
  });

  it('calls delete mutation when confirm-delete clicked', () => {
    propertiesState.data = [lakeHouse];
    render(withQueryClient(createElement(PropertiesPage)));
    fireEvent.click(screen.getByRole('button', { name: /^delete lake house$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm delete lake house/i }));
    expect(deleteMutate).toHaveBeenCalledWith('p1');
  });

  it('clicking Add Property in the empty state opens the form', () => {
    propertiesState.data = [];
    render(withQueryClient(createElement(PropertiesPage)));
    // The empty state has its own Add Property button; choose the one inside the empty card.
    const emptyAddBtn = screen.getAllByRole('button', { name: /add property/i });
    // The last Add Property button is the one in the empty state action.
    fireEvent.click(emptyAddBtn[emptyAddBtn.length - 1] as HTMLButtonElement);
    expect(screen.getByText('Add New Property')).toBeDefined();
    expect(screen.getByLabelText(/nickname/i)).toBeDefined();
  });

  it('submitting valid property form invokes createProperty.mutateAsync and resets', async () => {
    const user = userEvent.setup();
    propertiesState.data = [];
    const { container } = render(withQueryClient(createElement(PropertiesPage)));
    // Open the form via header Add Property button.
    fireEvent.click(screen.getAllByRole('button', { name: /add property/i })[0] as HTMLElement);

    await user.type(screen.getByLabelText(/nickname/i), 'Cabin');
    await user.type(screen.getByLabelText(/street address/i), '789 Pine Rd');
    await user.type(screen.getByLabelText(/^city$/i), 'Leavenworth');
    await user.type(screen.getByLabelText(/^state$/i), 'WA');
    await user.type(screen.getByLabelText(/zip code/i), '98826');
    // Submit via the form's submit button (type="submit").
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalled();
    });
    // After successful submit, form should close.
    await waitFor(() => {
      expect(screen.queryByText('Add New Property')).toBeNull();
    });
  });

  it('renders preferred providers section (account-wide soft empty)', () => {
    propertiesState.data = [lakeHouse];
    render(withQueryClient(createElement(PropertiesPage)));
    expect(screen.getByText(/providers · all properties/i)).toBeDefined();
    expect(screen.getByText(/no completed contracts yet/i)).toBeDefined();
  });

  it('renders preferred provider rows when API returns data', () => {
    propertiesState.data = [lakeHouse];
    preferredState.data = {
      preferred_threshold: 3,
      providers: [
        {
          provider_id: 'pr-1',
          display_name: 'Ace Plumbing',
          completed_count: 4,
          last_completed_at: null,
          is_preferred: true,
        },
      ],
    };
    render(withQueryClient(createElement(PropertiesPage)));
    expect(screen.getByText('Ace Plumbing')).toBeDefined();
    expect(screen.getByLabelText(/preferred provider/i)).toBeDefined();
  });

  it('links property nickname and view history to detail route', () => {
    propertiesState.data = [lakeHouse];
    render(withQueryClient(createElement(PropertiesPage)));
    const links = screen.getAllByRole('link');
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/properties/p1');
  });

});
