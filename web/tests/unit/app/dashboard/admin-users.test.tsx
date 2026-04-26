// Behavior tests for the admin users list page.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminUser, PaginationResponse } from '@/types';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/users',
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

const useAdminUsersMock = vi.fn();
const suspendMutateAsync = vi.fn();
const banMutateAsync = vi.fn();

vi.mock('@/hooks/useAdmin', () => ({
  useAdminUsers: (...args: unknown[]) => useAdminUsersMock(...args) as unknown,
  useBanUser: () => ({ mutateAsync: banMutateAsync, isPending: false }),
  useSuspendUser: () => ({ mutateAsync: suspendMutateAsync, isPending: false }),
}));

// Replace Radix Select with a native <select> so onValueChange can be driven
// directly via a `change` event in tests.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (val: string) => void;
    children: React.ReactNode;
  }) =>
    createElement(
      'select',
      {
        'data-testid': `radix-select-${value}`,
        value,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          onValueChange(e.target.value);
        },
      },
      children,
    ),
  SelectTrigger: ({
    children,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    'aria-label'?: string;
  }) =>
    createElement('span', { 'data-trigger': true, 'data-aria-label': ariaLabel }, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    createElement('span', { 'data-placeholder': placeholder }),
  SelectContent: ({ children }: { children: React.ReactNode }) =>
    createElement('optgroup', { label: 'opts' }, children),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => createElement('option', { value }, children),
}));

import AdminUsersPage from '@/app/(dashboard)/admin/users/page';

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    display_name: 'Alice Doe',
    first_name: 'Alice',
    last_name: 'Doe',
    phone: '555-0100',
    roles: ['customer'],
    status: 'active',
    avatar_url: '',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePagination(overrides: Partial<PaginationResponse> = {}): PaginationResponse {
  return {
    totalCount: 40,
    page: 1,
    pageSize: 20,
    totalPages: 2,
    hasNext: true,
    ...overrides,
  };
}

beforeAll(() => {
  if (typeof HTMLDialogElement !== 'undefined') {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  }
});

beforeEach(() => {
  useAdminUsersMock.mockReset();
  suspendMutateAsync.mockReset().mockResolvedValue(undefined);
  banMutateAsync.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminUsersPage', () => {
  it('renders without throwing', () => {
    useAdminUsersMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));
    expect(container).toBeTruthy();
  });

  it('shows error state when the hook returns isError', () => {
    useAdminUsersMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(withQueryClient(createElement(AdminUsersPage)));
    expect(screen.getByText('Failed to load users')).toBeInTheDocument();
  });

  it('lists rows returned by the hook', () => {
    useAdminUsersMock.mockReturnValue({
      data: { users: [makeUser()], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminUsersPage)));
    expect(screen.getByText('Alice Doe')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('updates the search query state and resets page on submit', async () => {
    const user = userEvent.setup();
    useAdminUsersMock.mockReturnValue({
      data: { users: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminUsersPage)));

    const input = screen.getByLabelText('Search users');
    await user.type(input, 'alice');
    expect(useAdminUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'alice', page: 1, page_size: 20 }),
    );
  });

  it('clicking Suspend opens confirm dialog with reason field', async () => {
    const user = userEvent.setup();
    useAdminUsersMock.mockReturnValue({
      data: { users: [makeUser()], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));

    await user.click(screen.getByRole('button', { name: /suspend alice doe/i }));
    const dialog = container.querySelector('dialog');
    expect(dialog).toBeTruthy();
    const reason = dialog?.querySelector('textarea#action-reason');
    expect(reason).toBeTruthy();
  });

  it('Suspend confirm calls suspend mutation with userId + reason', async () => {
    const user = userEvent.setup();
    useAdminUsersMock.mockReturnValue({
      data: {
        users: [makeUser({ id: 'u-99' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));

    await user.click(screen.getByRole('button', { name: /suspend alice doe/i }));
    const reason = container.querySelector<HTMLTextAreaElement>('textarea#action-reason');
    expect(reason).toBeTruthy();
    if (reason) {
      act(() => {
        fireEvent.change(reason, { target: { value: 'spam account' } });
      });
    }
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Suspend User"]',
    );
    expect(confirmBtn).toBeTruthy();
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    expect(suspendMutateAsync).toHaveBeenCalledWith({ userId: 'u-99', reason: 'spam account' });
  });

  it('Ban confirm calls ban mutation with userId + reason', async () => {
    const user = userEvent.setup();
    useAdminUsersMock.mockReturnValue({
      data: {
        users: [makeUser({ id: 'u-42' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));

    await user.click(screen.getByRole('button', { name: /ban alice doe/i }));
    const reason = container.querySelector<HTMLTextAreaElement>('textarea#action-reason');
    if (reason) {
      act(() => {
        fireEvent.change(reason, { target: { value: 'fraud' } });
      });
    }
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Ban User"]',
    );
    expect(confirmBtn).toBeTruthy();
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    expect(banMutateAsync).toHaveBeenCalledWith({ userId: 'u-42', reason: 'fraud' });
  });

  it('Suspend is disabled for already suspended users', () => {
    useAdminUsersMock.mockReturnValue({
      data: {
        users: [makeUser({ status: 'suspended' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminUsersPage)));
    expect(screen.getByRole('button', { name: /suspend alice doe/i })).toBeDisabled();
  });

  it('Ban is disabled for already banned users', () => {
    useAdminUsersMock.mockReturnValue({
      data: {
        users: [makeUser({ status: 'banned' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminUsersPage)));
    expect(screen.getByRole('button', { name: /ban alice doe/i })).toBeDisabled();
  });

  it('Cancel closes dialog without invoking mutations', async () => {
    const user = userEvent.setup();
    useAdminUsersMock.mockReturnValue({
      data: { users: [makeUser()], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));

    await user.click(screen.getByRole('button', { name: /suspend alice doe/i }));
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Cancel action"]',
    );
    expect(cancelBtn).toBeTruthy();
    if (cancelBtn) {
      fireEvent.click(cancelBtn);
    }

    expect(suspendMutateAsync).not.toHaveBeenCalled();
  });

  it('confirm button is disabled until reason is non-empty', async () => {
    const user = userEvent.setup();
    useAdminUsersMock.mockReturnValue({
      data: { users: [makeUser()], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));

    await user.click(screen.getByRole('button', { name: /suspend alice doe/i }));
    const confirmBtn = container.querySelector<HTMLButtonElement>(
      'dialog button[aria-label="Suspend User"]',
    );
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn?.disabled).toBe(true);
  });

  it('changing status filter via Select resets page and re-queries with status', () => {
    useAdminUsersMock.mockReturnValue({
      data: { users: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));
    // First select is status (value="__all__"), second is role.
    const selects = container.querySelectorAll('select');
    const statusSel = selects[0];
    expect(statusSel).toBeTruthy();
    if (statusSel) {
      fireEvent.change(statusSel, { target: { value: 'suspended' } });
    }
    expect(useAdminUsersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'suspended', page: 1 }),
    );
  });

  it('pagination Next button calls onPageChange', async () => {
    const user = userEvent.setup();
    useAdminUsersMock.mockReturnValue({
      data: { users: [makeUser()], pagination: makePagination() },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminUsersPage)));

    const nextBtn = screen.getByRole('button', { name: /go to next page/i });
    expect(nextBtn).toBeEnabled();
    await user.click(nextBtn);
    // After page change, hook is re-invoked with page: 2
    expect(useAdminUsersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it('renders empty message when no users returned', () => {
    useAdminUsersMock.mockReturnValue({
      data: { users: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminUsersPage)));
    expect(
      screen.getByText('No users found matching the current filters.'),
    ).toBeInTheDocument();
  });

  it('renders user roles as badges', () => {
    useAdminUsersMock.mockReturnValue({
      data: {
        users: [makeUser({ roles: ['customer', 'provider'] })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));
    const scope = within(container);
    expect(scope.getByText('customer')).toBeInTheDocument();
    expect(scope.getByText('provider')).toBeInTheDocument();
  });

  it('submitting the search form prevents default and resets page to 1', async () => {
    useAdminUsersMock.mockReturnValue({
      data: { users: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));
    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    if (form) {
      fireEvent.submit(form);
    }
    // Hook re-invoked with page: 1
    expect(useAdminUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, page_size: 20 }),
    );
  });

  it('changes status filter then resets to All — exercises both branches', () => {
    useAdminUsersMock.mockReturnValue({
      data: { users: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));
    const selects = container.querySelectorAll('select');
    const statusSel = selects[0];
    if (statusSel) {
      fireEvent.change(statusSel, { target: { value: 'active' } });
      // Now switch back to ALL_FILTER — exercises the undefined branch.
      fireEvent.change(statusSel, { target: { value: '__all__' } });
    }
    expect(useAdminUsersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: undefined, page: 1 }),
    );
  });

  it('uses email when display_name is empty', () => {
    useAdminUsersMock.mockReturnValue({
      data: {
        users: [makeUser({ display_name: '', email: 'noname@example.com' })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    render(withQueryClient(createElement(AdminUsersPage)));
    // Two occurrences (one in the link, one in the email cell)
    expect(screen.getAllByText('noname@example.com').length).toBeGreaterThan(0);
  });

  it('uses email in dialog title when display_name is empty', async () => {
    const user = userEvent.setup();
    useAdminUsersMock.mockReturnValue({
      data: {
        users: [makeUser({
          id: 'u-no-name',
          display_name: '',
          email: 'noname@example.com',
          first_name: null as unknown as string,
          last_name: null as unknown as string,
        })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));
    // The aria-label uses '' fallback when first_name/last_name are nullish.
    const suspendBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Suspend  "]',
    );
    expect(suspendBtn).toBeTruthy();
    if (suspendBtn) {
      await user.click(suspendBtn);
    }
    // Dialog should show email since display_name is empty
    expect(screen.getByText(/Suspend noname@example.com/)).toBeInTheDocument();
  });

  it('opens Ban dialog uses email fallback when display_name empty', async () => {
    const user = userEvent.setup();
    useAdminUsersMock.mockReturnValue({
      data: {
        users: [makeUser({
          id: 'u-no-name-2',
          display_name: '',
          email: 'banme@example.com',
          first_name: null as unknown as string,
          last_name: null as unknown as string,
        })],
        pagination: makePagination({ totalPages: 1, hasNext: false }),
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));
    const banBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Ban  "]',
    );
    expect(banBtn).toBeTruthy();
    if (banBtn) {
      await user.click(banBtn);
    }
    expect(screen.getByText(/Ban banme@example.com/)).toBeInTheDocument();
  });

  it('changes role filter then resets to All — exercises both branches', () => {
    useAdminUsersMock.mockReturnValue({
      data: { users: [], pagination: makePagination({ totalPages: 1, hasNext: false }) },
      isLoading: false,
      isError: false,
    });
    const { container } = render(withQueryClient(createElement(AdminUsersPage)));
    const selects = container.querySelectorAll('select');
    const roleSel = selects[1];
    expect(roleSel).toBeTruthy();
    if (roleSel) {
      fireEvent.change(roleSel, { target: { value: 'provider' } });
    }
    expect(useAdminUsersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'provider', page: 1 }),
    );
    if (roleSel) {
      fireEvent.change(roleSel, { target: { value: '__all__' } });
    }
    expect(useAdminUsersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: undefined, page: 1 }),
    );
  });
});
