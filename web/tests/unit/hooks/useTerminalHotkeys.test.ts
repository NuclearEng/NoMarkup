// useTerminalHotkeys — the terminal keyboard layer. Pins which key fires which
// handler in each mode, that keys are swallowed (preventDefault) only when they
// are handled, and that nothing fires from form fields, with modifier chords,
// or while the layer is disabled.
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useTerminalHotkeys,
  type LiveHotkeyHandlers,
  type ReplayHotkeyHandlers,
} from '@/hooks/useTerminalHotkeys';

const toggleEditing = vi.fn();

vi.mock('@/stores/terminal-layout-store', () => ({
  useTerminalLayoutStore: (selector: (state: { toggleEditing: () => void }) => unknown) =>
    selector({ toggleEditing }),
}));

const PALETTE_EVENT = 'nomarkup:open-command-palette';

type HotkeyOptions = Parameters<typeof useTerminalHotkeys>[0];

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.body,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function replayHandlers(overrides: Partial<ReplayHotkeyHandlers> = {}) {
  const handlers = {
    isPlaying: false,
    play: vi.fn(),
    pause: vi.fn(),
    restart: vi.fn(),
    setSpeed: vi.fn(),
    scrubBy: vi.fn(),
  };
  return { ...handlers, ...overrides };
}

describe('useTerminalHotkeys', () => {
  const paletteListener = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.addEventListener(PALETTE_EVENT, paletteListener);
  });

  afterEach(() => {
    window.removeEventListener(PALETTE_EVENT, paletteListener);
    document.body.replaceChildren();
  });

  describe('replay mode', () => {
    it.each([' ', 'Spacebar'])('%j starts playback when paused', (key) => {
      const replay = replayHandlers({ isPlaying: false });
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay', replay });
      });

      const event = press(key);

      expect(replay.play).toHaveBeenCalledTimes(1);
      expect(replay.pause).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('space pauses when already playing', () => {
      const replay = replayHandlers({ isPlaying: true });
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay', replay });
      });

      press(' ');

      expect(replay.pause).toHaveBeenCalledTimes(1);
      expect(replay.play).not.toHaveBeenCalled();
    });

    it.each(['r', 'R'])('%s restarts', (key) => {
      const replay = replayHandlers();
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay', replay });
      });

      const event = press(key);

      expect(replay.restart).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it.each([
      ['ArrowLeft', -1],
      ['ArrowRight', 1],
    ])('%s scrubs by %d event', (key, delta) => {
      const replay = replayHandlers();
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay', replay });
      });

      const event = press(key);

      expect(replay.scrubBy).toHaveBeenCalledTimes(1);
      expect(replay.scrubBy).toHaveBeenCalledWith(delta);
      expect(event.defaultPrevented).toBe(true);
    });

    it.each([
      ['1', 0.5],
      ['2', 1],
      ['3', 2],
      ['4', 4],
    ])('%s selects the default speed %d', (key, speed) => {
      const replay = replayHandlers();
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay', replay });
      });

      const event = press(key);

      expect(replay.setSpeed).toHaveBeenCalledTimes(1);
      expect(replay.setSpeed).toHaveBeenCalledWith(speed);
      expect(event.defaultPrevented).toBe(true);
    });

    it('maps digits onto a custom speed list and ignores digits past its end', () => {
      const replay = replayHandlers({ speeds: [1, 8] });
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay', replay });
      });

      press('2');
      expect(replay.setSpeed).toHaveBeenCalledWith(8);

      // Only two speeds are configured, so `3` is not a hotkey here and the
      // browser keeps its default behaviour.
      const unhandled = press('3');
      expect(replay.setSpeed).toHaveBeenCalledTimes(1);
      expect(unhandled.defaultPrevented).toBe(false);
    });

    it('still swallows restart / scrub / speed keys when the optional handlers are absent', () => {
      const play = vi.fn();
      const pause = vi.fn();
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay', replay: { isPlaying: false, play, pause } });
      });

      const events = ['r', 'ArrowLeft', 'ArrowRight', '1'].map((key) => press(key));

      expect(events.map((e) => e.defaultPrevented)).toEqual([true, true, true, true]);
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
    });

    it('does not toggle layout editing or the bid field', () => {
      const replay = replayHandlers();
      const input = document.createElement('input');
      input.id = 'live-bid-amount';
      document.body.append(input);
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay', replay, live: { canBid: true } });
      });

      const e = press('e');
      const b = press('b');

      expect(toggleEditing).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(input);
      expect(e.defaultPrevented).toBe(false);
      expect(b.defaultPrevented).toBe(false);
    });

    it('falls through to the jump palette for ? and /', () => {
      const replay = replayHandlers();
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay', replay });
      });

      const question = press('?');
      const slash = press('/');

      expect(paletteListener).toHaveBeenCalledTimes(2);
      expect(question.defaultPrevented).toBe(true);
      expect(slash.defaultPrevented).toBe(true);
    });

    it('ignores transport keys when no replay handlers are supplied', () => {
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay' });
      });

      const space = press(' ');
      press('/');

      expect(space.defaultPrevented).toBe(false);
      expect(paletteListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('live and spectate modes', () => {
    it.each<[HotkeyOptions['mode'], string]>([
      ['live', 'e'],
      ['live', 'E'],
      ['spectate', 'e'],
      ['spectate', 'E'],
    ])('%s: %s toggles layout editing', (mode, key) => {
      renderHook(() => {
        useTerminalHotkeys({ mode });
      });

      const event = press(key);

      expect(toggleEditing).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      expect(paletteListener).not.toHaveBeenCalled();
    });

    it.each(['b', 'B'])('live: %s focuses and selects the default bid field', (key) => {
      const input = document.createElement('input');
      input.id = 'live-bid-amount';
      input.value = '125';
      document.body.append(input);
      const select = vi.spyOn(input, 'select');
      renderHook(() => {
        useTerminalHotkeys({ mode: 'live', live: { canBid: true } });
      });

      const event = press(key);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(select).toHaveBeenCalledTimes(1);
    });

    it('live: B focuses a custom bid element without selecting when it is not an input', () => {
      const button = document.createElement('button');
      button.id = 'custom-bid';
      document.body.append(button);
      const fallback = document.createElement('input');
      fallback.id = 'live-bid-amount';
      document.body.append(fallback);
      const live: LiveHotkeyHandlers = { canBid: true, bidInputId: 'custom-bid' };
      renderHook(() => {
        useTerminalHotkeys({ mode: 'live', live });
      });

      press('b');

      expect(document.activeElement).toBe(button);
    });

    it('live: B is swallowed but harmless when the bid field is not in the DOM', () => {
      renderHook(() => {
        useTerminalHotkeys({ mode: 'live', live: { canBid: true } });
      });

      const event = press('b');

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(document.body);
    });

    it.each<[string, HotkeyOptions]>([
      ['canBid is false', { mode: 'live', live: { canBid: false } }],
      ['no live handlers are given', { mode: 'live' }],
      ['the terminal is spectate-only', { mode: 'spectate', live: { canBid: true } }],
    ])('B does nothing when %s', (_label, options) => {
      const input = document.createElement('input');
      input.id = 'live-bid-amount';
      document.body.append(input);
      renderHook(() => {
        useTerminalHotkeys(options);
      });

      const event = press('b');

      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).not.toBe(input);
    });

    it('does not run replay transport keys even if replay handlers are passed', () => {
      const replay = replayHandlers();
      renderHook(() => {
        useTerminalHotkeys({ mode: 'live', replay });
      });

      const space = press(' ');
      press('r');
      press('1');

      expect(replay.play).not.toHaveBeenCalled();
      expect(replay.restart).not.toHaveBeenCalled();
      expect(replay.setSpeed).not.toHaveBeenCalled();
      expect(space.defaultPrevented).toBe(false);
    });

    it.each(['?', '/'])('%s opens the jump palette', (key) => {
      renderHook(() => {
        useTerminalHotkeys({ mode: 'spectate' });
      });

      const event = press(key);

      expect(paletteListener).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves unrelated keys alone', () => {
      renderHook(() => {
        useTerminalHotkeys({ mode: 'live', live: { canBid: true } });
      });

      const event = press('x');

      expect(event.defaultPrevented).toBe(false);
      expect(toggleEditing).not.toHaveBeenCalled();
      expect(paletteListener).not.toHaveBeenCalled();
    });
  });

  describe('guards', () => {
    function mount(tag: string, attrs: Record<string, string> = {}): HTMLElement {
      const el = document.createElement(tag);
      for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
      document.body.append(el);
      return el;
    }

    it.each([
      ['an input', () => mount('input')],
      ['a textarea', () => mount('textarea')],
      ['a select', () => mount('select')],
      ['an ARIA textbox', () => mount('div', { role: 'textbox' })],
      [
        'a child of a contenteditable region',
        () => {
          const host = mount('div', { contenteditable: 'true' });
          const child = document.createElement('span');
          host.append(child);
          return child;
        },
      ],
      [
        'an element the browser reports as content-editable',
        () => {
          const el = mount('div');
          Object.defineProperty(el, 'isContentEditable', { value: true });
          return el;
        },
      ],
    ])('ignores keys typed into %s', (_label, makeTarget) => {
      const replay = replayHandlers();
      renderHook(() => {
        useTerminalHotkeys({ mode: 'replay', replay });
      });

      const target = makeTarget();
      const space = press(' ', {}, target);
      press('/', {}, target);

      expect(replay.play).not.toHaveBeenCalled();
      expect(paletteListener).not.toHaveBeenCalled();
      expect(space.defaultPrevented).toBe(false);
    });

    it('handles keys from a plain element and from a non-element target', () => {
      renderHook(() => {
        useTerminalHotkeys({ mode: 'spectate' });
      });

      press('e', {}, mount('div'));
      // Dispatched on window: the target is not an HTMLElement at all.
      press('e', {}, window);

      expect(toggleEditing).toHaveBeenCalledTimes(2);
    });

    it.each<[string, KeyboardEventInit]>([
      ['meta', { metaKey: true }],
      ['ctrl', { ctrlKey: true }],
      ['alt', { altKey: true }],
    ])('leaves %s chords to the browser / command palette', (_label, modifiers) => {
      const replay = replayHandlers();
      const { rerender } = renderHook(
        (options: HotkeyOptions) => {
          useTerminalHotkeys(options);
        },
        { initialProps: { mode: 'replay', replay } as HotkeyOptions },
      );

      const space = press(' ', modifiers);
      const slash = press('/', modifiers);
      rerender({ mode: 'live' });
      const edit = press('e', modifiers);

      expect(replay.play).not.toHaveBeenCalled();
      expect(toggleEditing).not.toHaveBeenCalled();
      expect(paletteListener).not.toHaveBeenCalled();
      expect([space, slash, edit].map((e) => e.defaultPrevented)).toEqual([false, false, false]);
    });

    it('shift alone is not treated as a modifier chord', () => {
      renderHook(() => {
        useTerminalHotkeys({ mode: 'live' });
      });

      press('?', { shiftKey: true });

      expect(paletteListener).toHaveBeenCalledTimes(1);
    });

    it('registers nothing while disabled, and attaches once re-enabled', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const { rerender } = renderHook(
        (enabled: boolean) => {
          useTerminalHotkeys({ enabled, mode: 'live' });
        },
        { initialProps: false },
      );

      press('e');
      press('/');
      expect(toggleEditing).not.toHaveBeenCalled();
      expect(paletteListener).not.toHaveBeenCalled();
      expect(addSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);

      rerender(true);
      press('e');
      expect(toggleEditing).toHaveBeenCalledTimes(1);
    });

    it('removes its listener on unmount', () => {
      const { unmount } = renderHook(() => {
        useTerminalHotkeys({ mode: 'live' });
      });

      unmount();
      const event = press('e');

      expect(toggleEditing).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
