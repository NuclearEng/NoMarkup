import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

// MOCKED: the profile / property hooks and next/navigation. PROVEN: which step
// the wizard resumes on, every validation and failure message, the exact
// payloads handed to each mutation, and what the summary step links to.
// NOT PROVEN: the gateway endpoints behind those hooks.

interface ProfileShape {
  displayName: string;
  phone: string | null;
  roles: string[];
}

const hooks = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  profile: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn<() => Promise<unknown>>(),
  },
  updateProfile: vi.fn<(input: unknown) => Promise<unknown>>(),
  enableRole: vi.fn<(role: unknown) => Promise<unknown>>(),
  sendOtp: vi.fn<(phone: unknown) => Promise<unknown>>(),
  verifyPhone: vi.fn<(code: unknown) => Promise<unknown>>(),
  createProperty: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hooks.push }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => hooks.profile,
  useUpdateProfile: () => ({ mutateAsync: hooks.updateProfile, isPending: false }),
  useEnableRole: () => ({ mutateAsync: hooks.enableRole, isPending: false }),
  useSendPhoneOtp: () => ({ mutateAsync: hooks.sendOtp, isPending: false }),
  useVerifyPhone: () => ({ mutateAsync: hooks.verifyPhone, isPending: false }),
}));

vi.mock('@/hooks/useProperties', () => ({
  useCreateProperty: () => ({ mutateAsync: hooks.createProperty, isPending: false }),
}));

import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

function setProfile(overrides: Partial<ProfileShape> = {}): void {
  hooks.profile.data = {
    id: 'u1',
    email: 'a@example.com',
    displayName: '',
    avatarUrl: null,
    roles: ['customer'],
    status: 'active',
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    mfaEnabled: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    resolve: () => {
      release();
    },
  };
}

function progress(): HTMLElement {
  return screen.getByRole('progressbar', { name: 'Setup progress' });
}

/** Start on the address step (profile already has a name and a phone). */
function renderAtAddress(overrides: Partial<ProfileShape> = {}) {
  setProfile({ displayName: 'Ada', phone: '+15550001111', ...overrides });
  return render(<OnboardingWizard />);
}

/** Start on the provider step. */
async function renderAtProvider(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<ProfileShape> = {},
) {
  renderAtAddress(overrides);
  await user.click(screen.getByTestId('onboarding.skip'));
}

async function fillAddress(
  user: ReturnType<typeof userEvent.setup>,
  values: { nickname?: string; street?: string; city?: string; state?: string; zip?: string },
) {
  if (values.nickname) await user.type(screen.getByLabelText('Nickname'), values.nickname);
  if (values.street) await user.type(screen.getByLabelText('Street'), values.street);
  if (values.city) await user.type(screen.getByLabelText('City'), values.city);
  if (values.state) await user.type(screen.getByLabelText('State'), values.state);
  if (values.zip) await user.type(screen.getByLabelText('ZIP'), values.zip);
}

beforeEach(() => {
  hooks.push.mockReset();
  hooks.profile.isLoading = false;
  hooks.profile.isError = false;
  hooks.profile.refetch.mockReset();
  hooks.profile.refetch.mockResolvedValue(undefined);
  setProfile();
  for (const fn of [
    hooks.updateProfile,
    hooks.enableRole,
    hooks.sendOtp,
    hooks.verifyPhone,
    hooks.createProperty,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue({});
  }
});

describe('OnboardingWizard — profile loading and errors', () => {
  it('shows a loading status and still lets the user leave', async () => {
    const user = userEvent.setup();
    hooks.profile.data = undefined;
    hooks.profile.isLoading = true;
    render(<OnboardingWizard />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading profile…');
    expect(screen.queryByTestId('onboarding.root')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(hooks.push).toHaveBeenCalledWith('/dashboard');
  });

  it('offers a retry and an exit when the profile cannot be loaded', async () => {
    const user = userEvent.setup();
    hooks.profile.data = undefined;
    hooks.profile.isError = true;
    render(<OnboardingWizard />);

    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load your profile.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(hooks.profile.refetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(hooks.push).toHaveBeenCalledWith('/dashboard');
  });

  it('keeps the wizard usable when a background refetch fails but a profile is cached', () => {
    hooks.profile.isError = true;
    render(<OnboardingWizard />);
    expect(screen.getByTestId('onboarding.root')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding.error')).not.toBeInTheDocument();
  });
});

describe('OnboardingWizard — resuming at the right step', () => {
  it('starts a brand-new user on the display name at 0%, which is not optional', () => {
    render(<OnboardingWizard />);
    expect(screen.getByTestId('onboarding.displayName')).toHaveValue('');
    expect(progress()).toHaveAttribute('value', '0');
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.queryByText(/Optional — you can skip/)).not.toBeInTheDocument();
  });

  it('treats a whitespace-only name as missing', () => {
    setProfile({ displayName: '   ', phone: '+15550001111' });
    render(<OnboardingWizard />);
    expect(screen.getByTestId('onboarding.displayName')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding.continue')).toBeDisabled();
  });

  it('resumes on the phone step at 25% when only the name is set', () => {
    setProfile({ displayName: 'Ada' });
    render(<OnboardingWizard />);
    expect(screen.getByTestId('onboarding.phone')).toHaveValue('');
    expect(progress()).toHaveAttribute('value', '25');
    expect(screen.getByText(/Optional — you can skip/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open security settings' })).toHaveAttribute(
      'href',
      '/settings/security',
    );
  });

  it('resumes on the address step at 50% when name and phone are set', () => {
    renderAtAddress();
    expect(screen.getByLabelText('Nickname')).toBeInTheDocument();
    expect(progress()).toHaveAttribute('value', '50');
    expect(screen.getByRole('link', { name: 'Open Properties' })).toHaveAttribute(
      'href',
      '/properties',
    );
  });
});

describe('OnboardingWizard — display name step', () => {
  it('saves the trimmed name and moves to the phone step', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    const continueButton = screen.getByTestId('onboarding.continue');
    expect(continueButton).toBeDisabled();

    await user.type(screen.getByLabelText('Display name'), '  Ada Lovelace  ');
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    expect(await screen.findByTestId('onboarding.phone')).toBeInTheDocument();
    expect(hooks.updateProfile).toHaveBeenCalledWith({ display_name: 'Ada Lovelace' });
    expect(screen.getByRole('status')).toHaveTextContent('Display name saved.');
  });

  it('rejects a name longer than 80 characters without calling the API', () => {
    render(<OnboardingWizard />);
    // maxLength stops typing at 80; a programmatic value (autofill, paste via
    // script) is the only way past it, so drive the input directly.
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'x'.repeat(81) },
    });
    fireEvent.click(screen.getByTestId('onboarding.continue'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Display name must be at most 80 characters.',
    );
    expect(hooks.updateProfile).not.toHaveBeenCalled();
    expect(screen.getByTestId('onboarding.displayName')).toBeInTheDocument();
  });

  it('accepts a name of exactly 80 characters', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'y'.repeat(80) },
    });
    await user.click(screen.getByTestId('onboarding.continue'));
    await screen.findByTestId('onboarding.phone');
    expect(hooks.updateProfile).toHaveBeenCalledWith({ display_name: 'y'.repeat(80) });
  });

  it('shows the gateway reason and stays on the step when saving fails', async () => {
    const user = userEvent.setup();
    hooks.updateProfile.mockRejectedValue(
      new ApiError(409, JSON.stringify({ error: 'display name is taken' })),
    );
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Display name'), 'Ada');
    await user.click(screen.getByTestId('onboarding.continue'));

    expect(await screen.findByRole('alert')).toHaveTextContent('display name is taken');
    expect(screen.getByTestId('onboarding.displayName')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding.continue')).toBeEnabled();
  });

  it('falls back to a specific message for a non-API failure', async () => {
    const user = userEvent.setup();
    hooks.updateProfile.mockRejectedValue(new Error('socket hang up'));
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Display name'), 'Ada');
    await user.click(screen.getByTestId('onboarding.continue'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save your display name.',
    );
  });

  it('disables both buttons while the save is in flight', async () => {
    const user = userEvent.setup();
    const gate = deferred();
    hooks.updateProfile.mockReturnValue(gate.promise);
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Display name'), 'Ada');
    await user.click(screen.getByTestId('onboarding.continue'));

    expect(screen.getByTestId('onboarding.continue')).toBeDisabled();
    expect(screen.getByTestId('onboarding.skip')).toBeDisabled();

    gate.resolve();
    await screen.findByTestId('onboarding.phone');
    expect(screen.getByTestId('onboarding.continue')).toBeEnabled();
  });

  it('clears a stale error when the step is skipped', async () => {
    const user = userEvent.setup();
    hooks.updateProfile.mockRejectedValue(new Error('boom'));
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Display name'), 'Ada');
    await user.click(screen.getByTestId('onboarding.continue'));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding.phone')).toBeInTheDocument();
  });
});

describe('OnboardingWizard — phone step', () => {
  beforeEach(() => {
    setProfile({ displayName: 'Ada' });
  });

  it('cannot send a code until a phone number is entered', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    const send = screen.getByRole('button', { name: 'Save phone and send SMS code' });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('Phone number'), '   ');
    expect(send).toBeDisabled();
    expect(screen.queryByLabelText('SMS code')).not.toBeInTheDocument();
  });

  it('saves the phone, sends a code, then verifies it and moves on', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Phone number'), ' +15551234567 ');
    await user.click(screen.getByRole('button', { name: 'Save phone and send SMS code' }));

    const otp = await screen.findByLabelText('SMS code');
    expect(hooks.updateProfile).toHaveBeenCalledWith({ phone: '+15551234567' });
    expect(hooks.sendOtp).toHaveBeenCalledWith('+15551234567');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Code sent. Enter it below, or skip and verify later.',
    );
    expect(screen.getByRole('button', { name: 'Resend SMS code' })).toBeEnabled();

    const verify = screen.getByRole('button', { name: 'Verify code' });
    expect(verify).toBeDisabled();
    await user.type(otp, ' 123456 ');
    await user.click(verify);

    expect(await screen.findByLabelText('Nickname')).toBeInTheDocument();
    expect(hooks.verifyPhone).toHaveBeenCalledWith('123456');
    expect(screen.getByRole('status')).toHaveTextContent('Phone verified.');
  });

  it('does not send a code when saving the phone fails', async () => {
    const user = userEvent.setup();
    hooks.updateProfile.mockRejectedValue(
      new ApiError(400, JSON.stringify({ message: 'phone must be E.164' })),
    );
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Phone number'), '555');
    await user.click(screen.getByRole('button', { name: 'Save phone and send SMS code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('phone must be E.164');
    expect(hooks.sendOtp).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('SMS code')).not.toBeInTheDocument();
  });

  it('reports a failed SMS send and keeps the code field hidden', async () => {
    const user = userEvent.setup();
    hooks.sendOtp.mockRejectedValue(new Error('twilio down'));
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Phone number'), '+15551234567');
    await user.click(screen.getByRole('button', { name: 'Save phone and send SMS code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not send a verification code.',
    );
    expect(screen.queryByLabelText('SMS code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save phone and send SMS code' })).toBeEnabled();
  });

  it('stays on the phone step with the reason when the code is wrong', async () => {
    const user = userEvent.setup();
    hooks.verifyPhone.mockRejectedValue(
      new ApiError(400, JSON.stringify({ error: 'code expired' })),
    );
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Phone number'), '+15551234567');
    await user.click(screen.getByRole('button', { name: 'Save phone and send SMS code' }));
    await user.type(await screen.findByLabelText('SMS code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('code expired');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('SMS code')).toHaveValue('000000');
  });

  it('uses the fallback when verification fails without an API error', async () => {
    const user = userEvent.setup();
    hooks.verifyPhone.mockRejectedValue('nope');
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Phone number'), '+15551234567');
    await user.click(screen.getByRole('button', { name: 'Save phone and send SMS code' }));
    await user.type(await screen.findByLabelText('SMS code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not verify that code.');
  });

  it('continues without an API call when no phone was entered', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.click(screen.getByTestId('onboarding.continue'));
    expect(screen.getByLabelText('Nickname')).toBeInTheDocument();
    expect(hooks.updateProfile).not.toHaveBeenCalled();
  });

  it('saves an unverified phone on Continue and says it can be verified later', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Phone number'), '+15551234567');
    await user.click(screen.getByTestId('onboarding.continue'));

    expect(await screen.findByLabelText('Nickname')).toBeInTheDocument();
    expect(hooks.updateProfile).toHaveBeenCalledWith({ phone: '+15551234567' });
    expect(hooks.sendOtp).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Phone saved. You can verify it later from Settings.',
    );
  });

  it('stays on the phone step when saving on Continue fails', async () => {
    const user = userEvent.setup();
    hooks.updateProfile.mockRejectedValue(new Error('offline'));
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Phone number'), '+15551234567');
    await user.click(screen.getByTestId('onboarding.continue'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save that phone number.',
    );
    expect(screen.getByTestId('onboarding.phone')).toBeInTheDocument();
  });

  it('skips the phone without saving what was typed', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.type(screen.getByLabelText('Phone number'), '+15551234567');
    await user.click(screen.getByRole('button', { name: 'Skip phone' }));
    expect(screen.getByLabelText('Nickname')).toBeInTheDocument();
    expect(hooks.updateProfile).not.toHaveBeenCalled();
  });
});

describe('OnboardingWizard — address step', () => {
  it.each([
    ['nickname', { street: '1 Main St', city: 'Austin', state: 'TX', zip: '78701' }],
    ['street', { nickname: 'Home', city: 'Austin', state: 'TX', zip: '78701' }],
    ['city', { nickname: 'Home', street: '1 Main St', state: 'TX', zip: '78701' }],
    ['2-letter state', { nickname: 'Home', street: '1 Main St', city: 'Austin', state: 'T', zip: '78701' }],
    ['ZIP', { nickname: 'Home', street: '1 Main St', city: 'Austin', state: 'TX' }],
  ])('requires a %s before saving', async (_field, values) => {
    const user = userEvent.setup();
    renderAtAddress();
    await fillAddress(user, values);
    await user.click(screen.getByTestId('onboarding.addProperty'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nickname, street, city, a 2-letter state, and ZIP are required.',
    );
    expect(hooks.createProperty).not.toHaveBeenCalled();
  });

  it('saves a trimmed address with an upper-cased state and confirms it by name', async () => {
    const user = userEvent.setup();
    renderAtAddress();
    await fillAddress(user, {
      nickname: ' Lake house ',
      street: ' 1 Main St ',
      city: ' Austin ',
      state: 'tx',
      zip: ' 78701 ',
    });
    await user.click(screen.getByTestId('onboarding.addProperty'));

    expect(await screen.findByText('Saved “Lake house”')).toBeInTheDocument();
    expect(hooks.createProperty).toHaveBeenCalledWith({
      nickname: 'Lake house',
      street: '1 Main St',
      city: 'Austin',
      state: 'TX',
      zip_code: '78701',
    });
    expect(screen.getByText('Property “Lake house” saved.')).toBeInTheDocument();
    // Saving does not advance: the user can add another or continue.
    expect(progress()).toHaveAttribute('value', '50');
  });

  it('reports a failed save and does not claim the address was saved', async () => {
    const user = userEvent.setup();
    hooks.createProperty.mockRejectedValue(
      new ApiError(422, JSON.stringify({ error: 'address could not be geocoded' })),
    );
    renderAtAddress();
    await fillAddress(user, {
      nickname: 'Home',
      street: '1 Main St',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
    });
    await user.click(screen.getByTestId('onboarding.addProperty'));

    expect(await screen.findByRole('alert')).toHaveTextContent('address could not be geocoded');
    expect(screen.queryByText(/Saved “/)).not.toBeInTheDocument();
  });

  it('uses the fallback for a non-API address failure', async () => {
    const user = userEvent.setup();
    hooks.createProperty.mockRejectedValue(new Error('offline'));
    renderAtAddress();
    await fillAddress(user, {
      nickname: 'Home',
      street: '1 Main St',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
    });
    await user.click(screen.getByTestId('onboarding.addProperty'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that address.');
  });

  it('Continue moves to the provider step at 75% and clears the validation error', async () => {
    const user = userEvent.setup();
    renderAtAddress();
    await user.click(screen.getByTestId('onboarding.addProperty'));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByTestId('onboarding.continue'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Enable provider role/ })).not.toBeChecked();
    expect(progress()).toHaveAttribute('value', '75');
  });
});

describe('OnboardingWizard — provider step and summary', () => {
  it('finishes as customer-only without enabling a role or showing provider links', async () => {
    const user = userEvent.setup();
    await renderAtProvider(user);
    await user.click(screen.getByRole('button', { name: 'Finish' }));

    expect(screen.getByText('Setup complete.')).toBeInTheDocument();
    expect(screen.getByText('Signed in as Ada')).toBeInTheDocument();
    expect(progress()).toHaveAttribute('value', '100');
    expect(hooks.enableRole).not.toHaveBeenCalled();
    expect(screen.queryByText('Finish provider setup')).not.toBeInTheDocument();
    expect(screen.queryByText(/Optional — you can skip/)).not.toBeInTheDocument();
  });

  it('skips to the summary as customer-only', async () => {
    const user = userEvent.setup();
    await renderAtProvider(user);
    await user.click(screen.getByRole('button', { name: 'Skip — stay customer only' }));
    expect(screen.getByText('Setup complete.')).toBeInTheDocument();
    expect(hooks.enableRole).not.toHaveBeenCalled();
  });

  it('enables the provider role when opted in and links to the provider setup pages', async () => {
    const user = userEvent.setup();
    await renderAtProvider(user);
    await user.click(screen.getByRole('checkbox', { name: /Enable provider role/ }));
    await user.click(screen.getByRole('button', { name: 'Enable and finish' }));

    expect(await screen.findByText('Finish provider setup')).toBeInTheDocument();
    expect(hooks.enableRole).toHaveBeenCalledWith('provider');
    expect(screen.getByRole('status')).toHaveTextContent('Provider role enabled.');
    expect(screen.getByRole('link', { name: 'Provider workspace' })).toHaveAttribute(
      'href',
      '/provider/workspace',
    );
    expect(screen.getByRole('link', { name: 'Verification documents' })).toHaveAttribute(
      'href',
      '/provider/verification',
    );
    expect(screen.getByRole('link', { name: 'Stripe Connect payouts' })).toHaveAttribute(
      'href',
      '/settings/payment-methods',
    );
  });

  it('stays on the provider step with the reason when enabling the role fails', async () => {
    const user = userEvent.setup();
    hooks.enableRole.mockRejectedValue(
      new ApiError(403, JSON.stringify({ error: 'verify your email first' })),
    );
    await renderAtProvider(user);
    await user.click(screen.getByRole('checkbox', { name: /Enable provider role/ }));
    await user.click(screen.getByRole('button', { name: 'Enable and finish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('verify your email first');
    expect(screen.queryByText('Setup complete.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable and finish' })).toBeEnabled();
  });

  it('uses the fallback for a non-API role failure', async () => {
    const user = userEvent.setup();
    hooks.enableRole.mockRejectedValue(new Error('offline'));
    await renderAtProvider(user);
    await user.click(screen.getByRole('checkbox', { name: /Enable provider role/ }));
    await user.click(screen.getByRole('button', { name: 'Enable and finish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not enable the provider role.',
    );
  });

  it('un-ticking the box goes back to a plain Finish', async () => {
    const user = userEvent.setup();
    await renderAtProvider(user);
    const box = screen.getByRole('checkbox', { name: /Enable provider role/ });
    await user.click(box);
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByText('Setup complete.')).toBeInTheDocument();
    expect(hooks.enableRole).not.toHaveBeenCalled();
  });

  it('tells an existing provider the role is already on and offers no opt-in or skip', async () => {
    const user = userEvent.setup();
    await renderAtProvider(user, { roles: ['customer', 'provider'] });

    expect(screen.getByText('Provider role already enabled.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding.skip')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(hooks.enableRole).not.toHaveBeenCalled();
    expect(screen.getByText('Finish provider setup')).toBeInTheDocument();
  });

  it('Done returns to the dashboard', async () => {
    const user = userEvent.setup();
    await renderAtProvider(user);
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    await user.click(screen.getByTestId('onboarding.done'));
    await waitFor(() => {
      expect(hooks.push).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('omits the signed-in line when the profile has no display name', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Skip phone' }));
    await user.click(screen.getByRole('button', { name: 'Skip address' }));
    await user.click(screen.getByRole('button', { name: 'Skip — stay customer only' }));

    expect(screen.getByText('Setup complete.')).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });
});
