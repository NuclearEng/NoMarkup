'use client';

import { useEffect } from 'react';

import { useTerminalLayoutStore } from '@/stores/terminal-layout-store';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[role="textbox"], [contenteditable="true"]'));
}

export interface ReplayHotkeyHandlers {
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  restart?: () => void;
  setSpeed?: (speed: number) => void;
  scrubBy?: (deltaEvents: number) => void;
  speeds?: readonly number[];
}

export interface LiveHotkeyHandlers {
  /** When true, `B` focuses the live bid amount field. */
  canBid?: boolean;
  bidInputId?: string;
}

/**
 * Terminal keyboard layer — Bloomberg-style chords without capturing form fields.
 *
 * Live: `E` edit layout · `?` / `/` focus jump palette · `B` bid field
 * Replay: Space play/pause · `R` restart · `1`–`4` speeds · ←/→ scrub
 */
export function useTerminalHotkeys(options: {
  enabled?: boolean;
  mode: 'live' | 'replay' | 'spectate';
  live?: LiveHotkeyHandlers;
  replay?: ReplayHotkeyHandlers;
}): void {
  const enabled = options.enabled !== false;
  const toggleEditing = useTerminalLayoutStore((s) => s.toggleEditing);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      // Leave global ⌘K to the command palette.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      if (options.mode === 'replay' && options.replay) {
        const r = options.replay;
        if (key === ' ' || key === 'Spacebar') {
          e.preventDefault();
          if (r.isPlaying) r.pause();
          else r.play();
          return;
        }
        if (key === 'r' || key === 'R') {
          e.preventDefault();
          r.restart?.();
          return;
        }
        if (key === 'ArrowLeft') {
          e.preventDefault();
          r.scrubBy?.(-1);
          return;
        }
        if (key === 'ArrowRight') {
          e.preventDefault();
          r.scrubBy?.(1);
          return;
        }
        const speeds = r.speeds ?? [0.5, 1, 2, 4];
        const speedIdx = ['1', '2', '3', '4'].indexOf(key);
        if (speedIdx >= 0 && speeds[speedIdx] !== undefined) {
          e.preventDefault();
          r.setSpeed?.(speeds[speedIdx]!);
          return;
        }
      }

      if (options.mode === 'live' || options.mode === 'spectate') {
        if (key === 'e' || key === 'E') {
          e.preventDefault();
          toggleEditing();
          return;
        }
        if (options.mode === 'live' && options.live?.canBid && (key === 'b' || key === 'B')) {
          e.preventDefault();
          const id = options.live.bidInputId ?? 'live-bid-amount';
          const el = document.getElementById(id);
          if (el instanceof HTMLElement) {
            el.focus();
            if (el instanceof HTMLInputElement) el.select();
          }
        }
      }

      if (key === '?' || key === '/') {
        // Open global jump palette (same event as header trigger).
        e.preventDefault();
        window.dispatchEvent(new Event('nomarkup:open-command-palette'));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, options.mode, options.live, options.replay, toggleEditing]);
}
