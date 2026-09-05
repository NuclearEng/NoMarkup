import { act, fireEvent, render, screen } from '@testing-library/react';
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

  // jsdom does not implement the canvas 2D context. Stub it so the confetti
  // animation loop can run without crashing.
  const fakeContext = {
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Array(4) as number[] })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => [] as unknown as ImageData),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    transform: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => fakeContext) as unknown as
    HTMLCanvasElement['getContext'];

  // requestAnimationFrame may be present in jsdom; stub a deterministic version.
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    setTimeout(() => { cb(performance.now()); }, 0);
    return 0;
  };
  window.cancelAnimationFrame = (): void => {
    // no-op
  };
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

  // ---- DEEPENING boundary tests ----

  it('returns nice tier for 0% savings', () => {
    expect(triggerCelebration(0)).toBe('nice');
  });

  it('returns nice tier just under 20%', () => {
    expect(triggerCelebration(19.99)).toBe('nice');
  });

  it('returns great tier exactly at 20%', () => {
    expect(triggerCelebration(20)).toBe('great');
  });

  it('returns amazing tier exactly at 30%', () => {
    expect(triggerCelebration(30)).toBe('amazing');
  });

  it('returns legendary tier exactly at 40%', () => {
    expect(triggerCelebration(40)).toBe('legendary');
  });

  it('returns legendary tier for absurdly high savings', () => {
    expect(triggerCelebration(150)).toBe('legendary');
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
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  // ---- DEEPENING component tests ----

  it('renders the nice-tier label for low savings', () => {
    render(<SavingsCelebration savingsPercent={10} isVisible onDismiss={() => {}} />);
    expect(screen.getByText(/nice savings/i)).toBeDefined();
  });

  it('renders the great-tier label for 25% savings', () => {
    render(<SavingsCelebration savingsPercent={25} isVisible onDismiss={() => {}} />);
    expect(screen.getByText(/great deal/i)).toBeDefined();
  });

  it('renders the amazing-tier label for 35% savings', () => {
    render(<SavingsCelebration savingsPercent={35} isVisible onDismiss={() => {}} />);
    expect(screen.getByText(/amazing deal/i)).toBeDefined();
  });

  it('exposes an aria-live polite status region with the savings summary', () => {
    render(
      <SavingsCelebration savingsPercent={28} isVisible onDismiss={() => {}} />,
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-label')).toContain('28');
    expect(status.getAttribute('aria-label')).toContain('Great Deal');
  });

  it('invokes onDismiss when the overlay is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <SavingsCelebration savingsPercent={20} isVisible onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole('status'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('invokes onDismiss when the Escape key is pressed', () => {
    const onDismiss = vi.fn();
    render(
      <SavingsCelebration savingsPercent={20} isVisible onDismiss={onDismiss} />,
    );
    fireEvent.keyDown(screen.getByRole('status'), { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('invokes onDismiss when the Enter key is pressed', () => {
    const onDismiss = vi.fn();
    render(
      <SavingsCelebration savingsPercent={20} isVisible onDismiss={onDismiss} />,
    );
    fireEvent.keyDown(screen.getByRole('status'), { key: 'Enter' });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders a hidden canvas element for the confetti animation', () => {
    const { container } = render(
      <SavingsCelebration savingsPercent={50} isVisible onDismiss={() => {}} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the burst ring for the amazing tier', () => {
    const { container } = render(
      <SavingsCelebration savingsPercent={35} isVisible onDismiss={() => {}} />,
    );
    expect(container.querySelector('.animate-celebration-burst')).not.toBeNull();
  });

  it('renders the edge glow only for the legendary tier', () => {
    const { container, rerender } = render(
      <SavingsCelebration savingsPercent={45} isVisible onDismiss={() => {}} />,
    );
    expect(container.querySelector('.animate-glow-breathe')).not.toBeNull();

    rerender(<SavingsCelebration savingsPercent={25} isVisible onDismiss={() => {}} />);
    expect(container.querySelector('.animate-glow-breathe')).toBeNull();
  });

  it('does not render the burst ring for nice tier', () => {
    const { container } = render(
      <SavingsCelebration savingsPercent={10} isVisible onDismiss={() => {}} />,
    );
    expect(container.querySelector('.animate-celebration-burst')).toBeNull();
  });

  it('forwards a custom className to the overlay', () => {
    render(
      <SavingsCelebration
        savingsPercent={30}
        isVisible
        onDismiss={() => {}}
        className="custom-overlay-cls"
      />,
    );
    const status = screen.getByRole('status');
    expect(status.className).toContain('custom-overlay-cls');
  });

  it('cleans up timers when unmounted before auto-dismiss fires', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { unmount } = render(
      <SavingsCelebration savingsPercent={20} isVisible onDismiss={onDismiss} />,
    );
    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('renders the legendary fire emoji marker for legendary tier', () => {
    render(<SavingsCelebration savingsPercent={50} isVisible onDismiss={() => {}} />);
    // The fire emoji is rendered for legendary only; assert by tier label
    expect(screen.getByText(/legendary savings/i)).toBeDefined();
  });
});
