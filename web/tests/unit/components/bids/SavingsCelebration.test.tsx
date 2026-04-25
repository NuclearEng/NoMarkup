import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SavingsCelebration, triggerCelebration } from '@/components/bids/SavingsCelebration';

beforeAll(() => {
  // jsdom does not implement matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('triggerCelebration tier helper', () => {
  it('returns nice tier for low savings', () => {
    expect(triggerCelebration(10)).toBe('nice');
  });

  it('returns great tier for 20%+ savings', () => {
    expect(triggerCelebration(25)).toBe('great');
  });

  it('returns amazing tier for 30%+ savings', () => {
    expect(triggerCelebration(35)).toBe('amazing');
  });

  it('returns legendary tier for 40%+ savings', () => {
    expect(triggerCelebration(50)).toBe('legendary');
  });
});

describe('SavingsCelebration', () => {
  it('renders nothing when isVisible is false', () => {
    const { container } = render(
      <SavingsCelebration savingsPercent={20} isVisible={false} onDismiss={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the tier label when visible', () => {
    render(
      <SavingsCelebration savingsPercent={50} isVisible onDismiss={() => {}} />,
    );
    expect(screen.getByText(/legendary savings/i)).toBeDefined();
  });

  it('shows the rounded savings percent in the message', () => {
    render(
      <SavingsCelebration savingsPercent={35.4} isVisible onDismiss={() => {}} />,
    );
    expect(screen.getByText(/35% below budget/i)).toBeDefined();
  });

  it('calls onPlaySound with the resolved tier when shown', () => {
    const onPlaySound = vi.fn();
    render(
      <SavingsCelebration
        savingsPercent={25}
        isVisible
        onDismiss={() => {}}
        onPlaySound={onPlaySound}
      />,
    );
    expect(onPlaySound).toHaveBeenCalledWith('great');
  });

  it('auto-dismisses after 3 seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <SavingsCelebration savingsPercent={25} isVisible onDismiss={onDismiss} />,
    );
    vi.advanceTimersByTime(3100);
    expect(onDismiss).toHaveBeenCalled();
  });
});
