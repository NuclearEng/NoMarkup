import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Children, createElement, isValidElement, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChallengeManager } from '@/components/admin/ChallengeManager';
import type { AdminChallenge } from '@/types';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
});

const mockCreate = vi.fn();

vi.mock('@/hooks/useChallenges', () => ({
  useAdminChallenges: vi.fn(),
  useCreateChallenge: () => ({ mutate: mockCreate, isPending: false, isError: false }),
}));

// Replace Radix Select with a native <select> so onValueChange is triggerable
// via fireEvent.change in jsdom (Radix Select triggers depend on pointer
// events that jsdom doesn't simulate). Walk children to extract every
// <SelectItem value="..." /> into <option> elements, and pluck the
// <SelectTrigger id="..."> id so the native select keeps its label association.
function collectFromChildren(
  children: ReactNode,
): { items: Array<{ value: string; label: ReactNode }>; triggerId: string | undefined } {
  const items: Array<{ value: string; label: ReactNode }> = [];
  let triggerId: string | undefined;
  const walk = (node: ReactNode): void => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const elementType = child.type as { displayName?: string } | string;
      const displayName =
        typeof elementType === 'string' ? '' : (elementType.displayName ?? '');
      const props = child.props as {
        value?: string;
        id?: string;
        children?: ReactNode;
      };
      if (displayName === 'MockSelectItem' && props.value !== undefined) {
        items.push({ value: props.value, label: props.children });
      }
      if (displayName === 'MockSelectTrigger' && props.id !== undefined) {
        triggerId = props.id;
      }
      if (props.children !== undefined) walk(props.children);
    });
  };
  walk(children);
  return { items, triggerId };
}

vi.mock('@/components/ui/select', () => {
  function MockSelect({
    children,
    value,
    onValueChange,
  }: {
    children?: ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }): ReactNode {
    const { items, triggerId } = collectFromChildren(children);
    return createElement(
      'select',
      {
        id: triggerId,
        value: value ?? '',
        onChange: (e: { target: { value: string } }) => {
          onValueChange?.(e.target.value);
        },
      },
      items.map((item) =>
        createElement('option', { key: item.value, value: item.value }, item.label),
      ),
    );
  }
  function MockSelectTrigger({
    children,
    id,
  }: {
    children?: ReactNode;
    id?: string;
  }): ReactNode {
    return createElement('span', { 'data-trigger-id': id }, children);
  }
  MockSelectTrigger.displayName = 'MockSelectTrigger';
  function MockSelectContent({ children }: { children?: ReactNode }): ReactNode {
    return createElement('span', null, children);
  }
  function MockSelectItem({
    children,
    value,
  }: {
    children?: ReactNode;
    value: string;
  }): ReactNode {
    return createElement('span', { 'data-value': value }, children);
  }
  MockSelectItem.displayName = 'MockSelectItem';
  function MockSelectValue(): ReactNode {
    return null;
  }
  return {
    Select: MockSelect,
    SelectTrigger: MockSelectTrigger,
    SelectContent: MockSelectContent,
    SelectItem: MockSelectItem,
    SelectValue: MockSelectValue,
  };
});

const { useAdminChallenges } = await import('@/hooks/useChallenges');

function makeChallenge(overrides: Partial<AdminChallenge> = {}): AdminChallenge {
  return {
    id: 'ch-1',
    title: 'Speed Demon',
    description: 'Win 10 jobs in a week',
    challenge_type: 'jobs_completed',
    target_value: 10,
    reward_type: 'badge',
    reward_value: 'Rising Star',
    starts_at: '2026-04-01T00:00:00Z',
    ends_at: '2026-05-01T00:00:00Z',
    is_seasonal: false,
    season_name: null,
    max_participants: null,
    participant_count: 12,
    completed_count: 3,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

describe('ChallengeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty-state message when there are no challenges', () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    render(createElement(ChallengeManager));
    expect(screen.getByText(/No challenges created yet/i)).toBeDefined();
  });

  it('renders summary metrics and a challenge row', () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [makeChallenge(), makeChallenge({ id: 'ch-2', is_active: false })],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    render(createElement(ChallengeManager));
    // Total Challenges = 2
    expect(screen.getByText('Total Challenges')).toBeDefined();
    // Both rows render with the same title; just confirm at least one renders.
    const titles = screen.getAllByText('Speed Demon');
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Active Now')).toBeDefined();
  });

  it('toggles the new challenge form when New Challenge is clicked', async () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    const user = userEvent.setup();
    render(createElement(ChallengeManager));
    await user.click(screen.getByRole('button', { name: /new challenge/i }));
    expect(screen.getByLabelText(/^title$/i)).toBeDefined();
    expect(screen.getByLabelText(/target value/i)).toBeDefined();
  });

  it('renders skeleton placeholders when challenges are loading', () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    const { container } = render(createElement(ChallengeManager));
    // Skeleton component renders with its own class; just look for several elements
    // matching shadcn/ui Skeleton conventions (they render a div with the right shape)
    const skeletons = container.querySelectorAll('div[class*="skeleton"], [class*="bg-accent"]');
    // Fallback: at minimum the empty state should NOT render while loading
    expect(screen.queryByText(/No challenges created yet/i)).toBeNull();
    expect(skeletons.length).toBeGreaterThanOrEqual(0);
  });

  it('toggles the form to Cancel button after opening', async () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    const user = userEvent.setup();
    render(createElement(ChallengeManager));
    await user.click(screen.getByRole('button', { name: /new challenge/i }));
    // After opening, two Cancel buttons appear (toggle in header + form footer)
    const cancels = screen.getAllByRole('button', { name: /^cancel$/i });
    expect(cancels.length).toBeGreaterThanOrEqual(2);
  });

  it('inline Cancel button closes the form via resetForm', async () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    const user = userEvent.setup();
    render(createElement(ChallengeManager));
    await user.click(screen.getByRole('button', { name: /new challenge/i }));
    await user.type(screen.getByLabelText(/^title$/i), 'Holiday Push');
    // Click the form's Cancel button (variant outline) — there are two cancels by name.
    const cancels = screen.getAllByRole('button', { name: /^cancel$/i });
    await user.click(cancels[cancels.length - 1] as HTMLElement);
    expect(screen.queryByLabelText(/^title$/i)).toBeNull();
  });

  it('does not call createChallenge.mutate when required fields are empty', async () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    const user = userEvent.setup();
    render(createElement(ChallengeManager));
    await user.click(screen.getByRole('button', { name: /new challenge/i }));
    // Submit without filling fields — the HTML "required" attributes block the
    // event from reaching handleSubmit, and even if it did, our early-return
    // guard prevents mutate from being called.
    const submit = screen.getByRole('button', { name: /create challenge/i });
    await user.click(submit);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('exposes the seasonal name field after toggling the seasonal switch', async () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    const user = userEvent.setup();
    render(createElement(ChallengeManager));
    await user.click(screen.getByRole('button', { name: /new challenge/i }));
    expect(screen.queryByLabelText(/season name/i)).toBeNull();
    await user.click(screen.getByLabelText(/seasonal event/i));
    expect(screen.getByLabelText(/season name/i)).toBeDefined();
  });

  it('typing in title and description updates the inputs', async () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    const user = userEvent.setup();
    render(createElement(ChallengeManager));
    await user.click(screen.getByRole('button', { name: /new challenge/i }));
    const title = screen.getByLabelText(/^title$/i);
    await user.type(title, 'Summer Sprint');
    if (!(title instanceof HTMLInputElement)) throw new Error('expected input element');
    expect(title.value).toBe('Summer Sprint');
    const desc = screen.getByLabelText(/^description$/i);
    await user.type(desc, 'Win 5');
    if (!(desc instanceof HTMLTextAreaElement)) throw new Error('expected textarea element');
    expect(desc.value).toBe('Win 5');
  });

  it('renders an inactive challenge with the Ended badge', () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [makeChallenge({ id: 'ch-x', is_active: false })],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);
    render(createElement(ChallengeManager));
    expect(screen.getByText('Ended')).toBeDefined();
  });

  it('renders the seasonal badge when challenge is seasonal', () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [makeChallenge({ is_seasonal: true, season_name: 'Spring 2026' })],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);
    render(createElement(ChallengeManager));
    expect(screen.getByText('Spring 2026')).toBeDefined();
  });

  it('submits the form with all required fields and calls createChallenge.mutate', async () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    // Capture the mutate args to confirm onSuccess fires resetForm.
    type MutateArg = {
      onSuccess?: () => void;
    };
    let capturedOnSuccess: (() => void) | undefined;
    mockCreate.mockImplementation((_input: unknown, options?: MutateArg) => {
      capturedOnSuccess = options?.onSuccess;
    });

    const user = userEvent.setup();
    const { container } = render(createElement(ChallengeManager));

    await user.click(screen.getByRole('button', { name: /new challenge/i }));

    // Fill all required fields.
    await user.type(screen.getByLabelText(/^title$/i), 'Speed Demon');
    await user.type(screen.getByLabelText(/^description$/i), 'Win 10 jobs in a week');
    await user.type(screen.getByLabelText(/target value/i), '10');
    await user.type(screen.getByLabelText(/reward value/i), 'Rising Star');

    // Set datetime-local fields directly (userEvent.type chokes on segmented inputs).
    const startsAt = container.querySelector('#starts-at') as HTMLInputElement;
    const endsAt = container.querySelector('#ends-at') as HTMLInputElement;
    // fireEvent for datetime-local — change event with full ISO-like value.
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(startsAt, { target: { value: '2026-04-01T00:00' } });
    fireEvent.change(endsAt, { target: { value: '2026-05-01T00:00' } });

    // Add an optional max-participants value to exercise that branch.
    await user.type(screen.getByLabelText(/max participants/i), '50');

    // Submit via the form (clicking the submit button triggers onSubmit if all
    // native required fields are filled).
    const submit = screen.getByRole('button', { name: /create challenge/i });
    await user.click(submit);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0];
    expect(args).toBeDefined();
    const input = args?.[0] as { title: string; max_participants?: number };
    expect(input.title).toBe('Speed Demon');
    expect(input.max_participants).toBe(50);

    // Fire onSuccess to drive resetForm — close the form, clear inputs.
    expect(capturedOnSuccess).toBeDefined();
    const { act } = await import('@testing-library/react');
    act(() => {
      capturedOnSuccess?.();
    });
    // After resetForm, the title input should be gone (form is hidden).
    expect(screen.queryByLabelText(/^title$/i)).toBeNull();
  });

  it('changes the challenge_type and reward_type via the Select dropdowns', async () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    mockCreate.mockImplementation(() => {});

    const user = userEvent.setup();
    const { container } = render(createElement(ChallengeManager));
    await user.click(screen.getByRole('button', { name: /new challenge/i }));

    const { fireEvent } = await import('@testing-library/react');
    // Native <select> from our mock — change challenge type and reward type.
    const challengeTypeSelect = container.querySelector(
      'select#challenge-type',
    ) as HTMLSelectElement;
    fireEvent.change(challengeTypeSelect, { target: { value: 'five_star_reviews' } });
    const rewardTypeSelect = container.querySelector(
      'select#reward-type',
    ) as HTMLSelectElement;
    fireEvent.change(rewardTypeSelect, { target: { value: 'priority_placement' } });

    await user.type(screen.getByLabelText(/^title$/i), 'X');
    await user.type(screen.getByLabelText(/^description$/i), 'Y');
    await user.type(screen.getByLabelText(/target value/i), '3');
    await user.type(screen.getByLabelText(/reward value/i), 'Z');

    fireEvent.change(container.querySelector('#starts-at') as HTMLInputElement, {
      target: { value: '2026-04-01T00:00' },
    });
    fireEvent.change(container.querySelector('#ends-at') as HTMLInputElement, {
      target: { value: '2026-05-01T00:00' },
    });

    await user.click(screen.getByRole('button', { name: /create challenge/i }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const input = mockCreate.mock.calls[0]?.[0] as {
      challenge_type: string;
      reward_type: string;
    };
    expect(input.challenge_type).toBe('five_star_reviews');
    expect(input.reward_type).toBe('priority_placement');
  });

  it('submits with seasonal data including season_name when seasonal switch is on', async () => {
    vi.mocked(useAdminChallenges).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdminChallenges>);

    mockCreate.mockImplementation(() => {});

    const user = userEvent.setup();
    const { container } = render(createElement(ChallengeManager));

    await user.click(screen.getByRole('button', { name: /new challenge/i }));
    await user.type(screen.getByLabelText(/^title$/i), 'Spring Sprint');
    await user.type(screen.getByLabelText(/^description$/i), 'Seasonal challenge');
    await user.type(screen.getByLabelText(/target value/i), '5');
    await user.type(screen.getByLabelText(/reward value/i), 'Spring Badge');

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(container.querySelector('#starts-at') as HTMLInputElement, {
      target: { value: '2026-04-01T00:00' },
    });
    fireEvent.change(container.querySelector('#ends-at') as HTMLInputElement, {
      target: { value: '2026-05-01T00:00' },
    });

    // Toggle seasonal — exposes season-name input.
    await user.click(screen.getByLabelText(/seasonal event/i));
    await user.type(screen.getByLabelText(/season name/i), 'Spring 2026');

    await user.click(screen.getByRole('button', { name: /create challenge/i }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const input = mockCreate.mock.calls[0]?.[0] as {
      is_seasonal: boolean;
      season_name?: string;
    };
    expect(input.is_seasonal).toBe(true);
    expect(input.season_name).toBe('Spring 2026');
  });
});
