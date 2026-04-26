import { fireEvent, render, screen } from '@testing-library/react';
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
let isPending = false;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useAddEmployee: () => ({
    mutateAsync: addEmployeeMutate,
    get isPending() {
      return isPending;
    },
  }),
}));

describe('AddEmployeeForm', () => {
  beforeEach(() => {
    pushMock.mockReset();
    addEmployeeMutate.mockReset();
    addEmployeeMutate.mockResolvedValue(undefined);
    isPending = false;
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

  it('shows the loading state on the submit button when the mutation is pending', () => {
    isPending = true;
    render(<AddEmployeeForm />);
    expect(screen.getByRole('button', { name: /Adding\.\.\./ })).toBeDefined();
  });

  it('strips non-digits from the SSN field and limits to 4 chars', async () => {
    const user = userEvent.setup();
    render(<AddEmployeeForm />);
    const ssn = screen.getByPlaceholderText('XXXX');
    await user.type(ssn, 'a1b2c34567');
    if (!(ssn instanceof HTMLInputElement)) throw new Error('expected input element');
    expect(ssn.value).toBe('1234');
  });

  it('accepts a valid PNG file via the hidden input and shows the file card', async () => {
    const { container } = render(<AddEmployeeForm />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const file = new File(['hello'], 'id.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    expect(await screen.findByText('id.png')).toBeDefined();
    expect(screen.getByLabelText(/Remove uploaded file/)).toBeDefined();
  });

  it('removes the uploaded file when Remove is clicked', async () => {
    const user = userEvent.setup();
    const { container } = render(<AddEmployeeForm />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'id.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await user.click(await screen.findByLabelText(/Remove uploaded file/));
    expect(screen.queryByText('id.png')).toBeNull();
  });

  it('rejects an unsupported file type with an error message', async () => {
    const { container } = render(<AddEmployeeForm />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'doc.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    const alert = await screen.findByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.textContent).toMatch(/JPG, PNG, WebP, or PDF/);
  });

  it('rejects an oversized file with an error message', async () => {
    const { container } = render(<AddEmployeeForm />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // Build a fake file that reports a size > 10MB
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [big], configurable: true });
    fireEvent.change(input);
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText(/exceeds the 10 MB limit/)).toBeDefined();
  });

  it('opens the file picker when the drop zone is clicked', async () => {
    const user = userEvent.setup();
    const { container } = render(<AddEmployeeForm />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    const dropzone = screen.getByRole('button', { name: /Upload government ID/ });
    await user.click(dropzone);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('opens the file picker when Enter is pressed on the drop zone', async () => {
    const user = userEvent.setup();
    const { container } = render(<AddEmployeeForm />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    const dropzone = screen.getByRole('button', { name: /Upload government ID/ });
    dropzone.focus();
    await user.keyboard('{Enter}');
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockClear();
    await user.keyboard(' ');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('handles drag enter, drag leave, drag over, and drop interactions', () => {
    render(<AddEmployeeForm />);
    const dropzone = screen.getByRole('button', { name: /Upload government ID/ });
    fireEvent.dragEnter(dropzone);
    expect(screen.getByText(/Drop file here/)).toBeDefined();
    fireEvent.dragOver(dropzone);
    fireEvent.dragLeave(dropzone);
    expect(screen.getByText(/Click or drag file to upload/)).toBeDefined();
    const file = new File(['hello'], 'id.jpg', { type: 'image/jpeg' });
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    });
    expect(screen.getByText('id.jpg')).toBeDefined();
  });

  it('drop with no files leaves the dropzone empty', () => {
    render(<AddEmployeeForm />);
    const dropzone = screen.getByRole('button', { name: /Upload government ID/ });
    fireEvent.drop(dropzone, { dataTransfer: { files: [] } });
    expect(screen.getByText(/Click or drag file to upload/)).toBeDefined();
  });
});
