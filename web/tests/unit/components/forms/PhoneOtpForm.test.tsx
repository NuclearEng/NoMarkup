import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMutate = vi.fn();
const verifyMutate = vi.fn();
const sendState = { isPending: false };
const verifyState: { isPending: boolean; data?: { verified: boolean } } = {
  isPending: false,
  data: undefined,
};

vi.mock('@/hooks/useProfile', () => ({
  useSendPhoneOtp: () => ({
    mutateAsync: sendMutate,
    isPending: sendState.isPending,
  }),
  useVerifyPhone: () => ({
    mutateAsync: verifyMutate,
    isPending: verifyState.isPending,
    data: verifyState.data,
  }),
}));

const { PhoneOtpForm } = await import('@/components/forms/PhoneOtpForm');

describe('PhoneOtpForm', () => {
  beforeEach(() => {
    sendMutate.mockReset();
    verifyMutate.mockReset();
    sendMutate.mockResolvedValue({ sent: true });
    verifyMutate.mockResolvedValue({ verified: true });
    sendState.isPending = false;
    verifyState.isPending = false;
    verifyState.data = undefined;
  });

  it('validates phone before sending and posts OTP verify after send', async () => {
    render(createElement(PhoneOtpForm, { initialPhone: '', phoneVerified: false }));

    fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: 'not-a-phone' } });
    fireEvent.click(screen.getByRole('button', { name: /Send SMS code/i }));
    expect(sendMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Invalid phone number/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('button', { name: /Send SMS code/i }));
    await waitFor(() => {
      expect(sendMutate).toHaveBeenCalledWith('+15551234567');
    });

    fireEvent.change(screen.getByLabelText(/OTP code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify phone/i }));
    await waitFor(() => {
      expect(verifyMutate).toHaveBeenCalledWith('123456');
    });
  });

  it('shows verified status when the profile is already verified', () => {
    render(createElement(PhoneOtpForm, { initialPhone: '+15550001111', phoneVerified: true }));
    expect(screen.getByText(/Phone verified/i)).toBeDefined();
    expect((screen.getByLabelText(/Phone/i) as HTMLInputElement).value).toBe('+15550001111');
  });
});
