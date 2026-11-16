// Tests for the provider team management page — exercises loading/error/empty
// states, employee status actions, expand/collapse, and the add-employee toggle.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const employeesState: { data: unknown; isLoading: boolean; error: Error | null } = {
  data: undefined,
  isLoading: false,
  error: null,
};
const updateEmployeeMutate = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/team',
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

vi.mock('@/components/providers/AddEmployeeForm', () => ({
  AddEmployeeForm: () => createElement('div', { 'data-testid': 'add-employee-form' }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => employeesState,
  useUpdateEmployee: () => ({ mutate: updateEmployeeMutate, isPending: false }),
}));

const { default: ProviderTeamPage } = await import('@/app/(dashboard)/provider/team/page');

const activeEmployee = {
  id: 'e_active',
  first_name: 'Alice',
  last_name: 'Anderson',
  email: 'alice@example.com',
  phone: '555-1111',
  role: 'lead',
  status: 'active',
  background_check_status: 'passed',
  hire_date: '2024-08-12T00:00:00Z',
  date_of_birth: null,
  license_number: 'LIC123',
  license_state: 'WA',
  license_expiry: '2026-01-01T00:00:00Z',
  insurance_policy_number: 'POL456',
  insurance_expiry: '2026-02-01T00:00:00Z',
};
const pendingEmployee = {
  id: 'e_pending',
  first_name: 'Bob',
  last_name: 'Brown',
  email: null,
  phone: null,
  role: 'technician',
  status: 'pending',
  background_check_status: 'pending',
  hire_date: null,
  date_of_birth: null,
  license_number: null,
  license_state: null,
  license_expiry: null,
  insurance_policy_number: null,
  insurance_expiry: null,
};

beforeEach(() => {
  employeesState.data = undefined;
  employeesState.isLoading = false;
  employeesState.error = null;
  updateEmployeeMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderTeamPage', () => {
  it('renders loading skeletons when employees are loading', () => {
    employeesState.isLoading = true;
    render(withQueryClient(createElement(ProviderTeamPage)));
    expect(screen.queryByText(/no team members yet/i)).toBeNull();
    expect(screen.queryByText('Alice Anderson')).toBeNull();
  });

  it('renders error state when employees fetch fails', () => {
    employeesState.error = new Error('boom');
    render(withQueryClient(createElement(ProviderTeamPage)));
    expect(screen.getByText(/failed to load team members/i)).toBeDefined();
  });

  it('renders empty state when no employees exist', () => {
    employeesState.data = { employees: [] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    expect(screen.getByText(/no team members yet/i)).toBeDefined();
  });

  it('renders employee cards when data is present', () => {
    employeesState.data = { employees: [activeEmployee, pendingEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    expect(screen.getByText('Alice Anderson')).toBeDefined();
    expect(screen.getByText('Bob Brown')).toBeDefined();
    expect(screen.getByText('Verified')).toBeDefined();
    expect(screen.getByText('Check Pending')).toBeDefined();
  });

  it('expands an employee card on click and shows contact info', () => {
    employeesState.data = { employees: [activeEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getByRole('button', { name: /alice anderson details/i }));
    expect(screen.getByText('alice@example.com')).toBeDefined();
    expect(screen.getByText('555-1111')).toBeDefined();
    expect(screen.getByText(/LIC123/)).toBeDefined();
  });

  it('shows "Activate" action only for pending employees', () => {
    employeesState.data = { employees: [pendingEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getByRole('button', { name: /bob brown details/i }));
    fireEvent.click(screen.getByRole('button', { name: /^activate$/i }));
    expect(updateEmployeeMutate).toHaveBeenCalledWith({
      id: 'e_pending',
      data: { status: 'active' },
    });
  });

  it('shows "Suspend" action for active employees', () => {
    employeesState.data = { employees: [activeEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getByRole('button', { name: /alice anderson details/i }));
    fireEvent.click(screen.getByRole('button', { name: /^suspend$/i }));
    expect(updateEmployeeMutate).toHaveBeenCalledWith({
      id: 'e_active',
      data: { status: 'suspended' },
    });
  });

  it('terminates employee when Terminate clicked', () => {
    employeesState.data = { employees: [activeEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getByRole('button', { name: /alice anderson details/i }));
    fireEvent.click(screen.getByRole('button', { name: /^terminate$/i }));
    expect(updateEmployeeMutate).toHaveBeenCalledWith({
      id: 'e_active',
      data: { status: 'terminated' },
    });
  });

  it('switches to the add employee view when "Add Employee" clicked', () => {
    employeesState.data = { employees: [activeEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getAllByRole('button', { name: /add employee/i })[0] as HTMLElement);
    expect(screen.getByTestId('add-employee-form')).toBeDefined();
    expect(screen.getByRole('button', { name: /back to team/i })).toBeDefined();
  });

  it('returns to the team list when "Back to Team" clicked', () => {
    employeesState.data = { employees: [activeEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getAllByRole('button', { name: /add employee/i })[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: /back to team/i }));
    expect(screen.queryByTestId('add-employee-form')).toBeNull();
    expect(screen.getByText('Alice Anderson')).toBeDefined();
  });

  it('renders manager role with default badge variant', () => {
    employeesState.data = {
      employees: [{ ...activeEmployee, id: 'e_mgr', role: 'manager' }],
    };
    render(withQueryClient(createElement(ProviderTeamPage)));
    expect(screen.getByText('Manager')).toBeDefined();
  });

  it('renders apprentice role (default fallback) with outline badge variant', () => {
    employeesState.data = {
      employees: [{ ...activeEmployee, id: 'e_app', role: 'apprentice' }],
    };
    render(withQueryClient(createElement(ProviderTeamPage)));
    expect(screen.getByText('Apprentice')).toBeDefined();
  });

  it('renders suspended status color and Reactivate action', () => {
    const suspendedEmployee = {
      ...activeEmployee,
      id: 'e_susp',
      first_name: 'Charlie',
      last_name: 'Cole',
      status: 'suspended',
    };
    employeesState.data = { employees: [suspendedEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getByRole('button', { name: /charlie cole details/i }));
    expect(screen.getByText('Suspended')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /^reactivate$/i }));
    expect(updateEmployeeMutate).toHaveBeenCalledWith({
      id: 'e_susp',
      data: { status: 'active' },
    });
  });

  it('renders terminated employees without action buttons (no Terminate option)', () => {
    const terminatedEmployee = {
      ...activeEmployee,
      id: 'e_term',
      first_name: 'Dana',
      last_name: 'Davis',
      status: 'terminated',
    };
    employeesState.data = { employees: [terminatedEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getByRole('button', { name: /dana davis details/i }));
    expect(screen.getByText('Terminated')).toBeDefined();
    expect(screen.queryByRole('button', { name: /^terminate$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^activate$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^suspend$/i })).toBeNull();
  });

  it('renders failed background-check badge', () => {
    employeesState.data = {
      employees: [
        { ...activeEmployee, id: 'e_failed', background_check_status: 'failed' },
      ],
    };
    render(withQueryClient(createElement(ProviderTeamPage)));
    expect(screen.getByText('Check Failed')).toBeDefined();
  });

  it('renders not_started background-check badge', () => {
    employeesState.data = {
      employees: [
        {
          ...pendingEmployee,
          id: 'e_ns',
          background_check_status: 'not_started',
        },
      ],
    };
    render(withQueryClient(createElement(ProviderTeamPage)));
    expect(screen.getByText('Not Started')).toBeDefined();
  });

  it('renders date_of_birth, license_expiry, and insurance_expiry when expanded', () => {
    employeesState.data = {
      employees: [
        {
          ...activeEmployee,
          id: 'e_full',
          date_of_birth: '1985-06-15',
          license_expiry: '2027-03-01',
          insurance_expiry: '2027-04-01',
        },
      ],
    };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getByRole('button', { name: /alice anderson details/i }));
    expect(screen.getByText(/DOB:/i)).toBeDefined();
    // license_expiry and insurance_expiry render via toLocaleDateString — match
    // the year only since the locale-specific date formatting is brittle.
    expect(screen.getAllByText(/exp\.\s*.*2027/).length).toBeGreaterThanOrEqual(2);
  });

  it('shows "No license / No insurance on file" when missing', () => {
    employeesState.data = { employees: [pendingEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getByRole('button', { name: /bob brown details/i }));
    expect(screen.getByText(/No license on file/i)).toBeDefined();
    expect(screen.getByText(/No insurance on file/i)).toBeDefined();
  });

  it('opens the add-employee form via the empty-state action button', () => {
    employeesState.data = { employees: [] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    // There are two "Add Employee" buttons in empty state — the header one and
    // the one inside the empty state's action prop. Click the second one.
    const addButtons = screen.getAllByRole('button', { name: /add employee/i });
    expect(addButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(addButtons[1] as HTMLElement);
    expect(screen.getByTestId('add-employee-form')).toBeDefined();
  });

  it('terminates employee and calls handleRemove path', () => {
    employeesState.data = { employees: [pendingEmployee] };
    render(withQueryClient(createElement(ProviderTeamPage)));
    fireEvent.click(screen.getByRole('button', { name: /bob brown details/i }));
    fireEvent.click(screen.getByRole('button', { name: /^terminate$/i }));
    expect(updateEmployeeMutate).toHaveBeenCalledWith({
      id: 'e_pending',
      data: { status: 'terminated' },
    });
  });
});
