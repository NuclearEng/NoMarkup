import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddEmployeeForm } from '@/components/providers/AddEmployeeForm';

// jsdom does not include ResizeObserver — required by Radix select primitives
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

const pushMock = vi.fn();
const addEmployeeMutate = vi.fn().mockResolvedValue(undefined);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useAddEmployee: () => ({
    mutateAsync: addEmployeeMutate,
    isPending: false,
  }),
}));

describe('AddEmployeeForm', () => {
  beforeEach(() => {
    pushMock.mockReset();
    addEmployeeMutate.mockReset();
    addEmployeeMutate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Personal Information section', () => {
    render(<AddEmployeeForm />);
    expect(screen.getByText('Personal Information')).toBeDefined();
    expect(screen.getByLabelText(/First Name/)).toBeDefined();
    expect(screen.getByLabelText(/Last Name/)).toBeDefined();
  });

  it('renders Identity Verification section', () => {
    render(<AddEmployeeForm />);
    expect(screen.getByText('Identity Verification')).toBeDefined();
    expect(screen.getByText(/SSN \(Last 4 Digits\)/)).toBeDefined();
  });

  it('renders Licenses & Certifications section', () => {
    render(<AddEmployeeForm />);
    expect(screen.getByText('Licenses & Certifications')).toBeDefined();
    expect(screen.getByLabelText(/License Number/)).toBeDefined();
  });

  it('renders Add Employee submit button', () => {
    render(<AddEmployeeForm />);
    expect(screen.getByRole('button', { name: /Add Employee/ })).toBeDefined();
  });

  it('renders Cancel button that navigates back to /provider/team', async () => {
    const user = userEvent.setup();
    render(<AddEmployeeForm />);
    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(pushMock).toHaveBeenCalledWith('/provider/team');
  });

  it('shows validation errors when required fields are missing on submit', async () => {
    const user = userEvent.setup();
    render(<AddEmployeeForm />);
    await user.click(screen.getByRole('button', { name: /Add Employee/ }));
    // First name + Last name are required
    expect(await screen.findByText(/First name is required/)).toBeDefined();
    expect(await screen.findByText(/Last name is required/)).toBeDefined();
    expect(addEmployeeMutate).not.toHaveBeenCalled();
  });

  it('calls addEmployee with mapped payload when valid', async () => {
    const user = userEvent.setup();
    render(<AddEmployeeForm />);

    await user.type(screen.getByLabelText(/First Name/), 'Jane');
    await user.type(screen.getByLabelText(/Last Name/), 'Doe');
    await user.click(screen.getByRole('button', { name: /Add Employee/ }));

    // Wait for the submission to resolve
    await vi.waitFor(() => {
      expect(addEmployeeMutate).toHaveBeenCalled();
    });
    interface EmployeePayload {
      first_name: string;
      last_name: string;
      role: string;
    }
    const payload = addEmployeeMutate.mock.calls[0]?.[0] as EmployeePayload;
    expect(payload.first_name).toBe('Jane');
    expect(payload.last_name).toBe('Doe');
    expect(payload.role).toBe('technician');
  });
});
