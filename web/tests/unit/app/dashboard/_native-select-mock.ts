/**
 * Native <select> stand-in for the Radix-based `@/components/ui/select`.
 *
 * Radix Select relies on pointer capture and portals that jsdom does not
 * implement, so tests swap it for a plain <select> whose `change` event drives
 * `onValueChange` directly:
 *
 *   vi.mock('@/components/ui/select', () => import('./_native-select-mock'));
 */
import { type ChangeEvent, type ReactNode, createElement } from 'react';

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
}

export function Select({ value, onValueChange, children }: SelectProps) {
  return createElement(
    'select',
    {
      value,
      onChange: (e: ChangeEvent<HTMLSelectElement>) => {
        onValueChange?.(e.target.value);
      },
    },
    children,
  );
}

export function SelectTrigger() {
  return null;
}

export function SelectValue() {
  return null;
}

export function SelectContent({ children }: { children?: ReactNode }) {
  return children;
}

export function SelectItem({ value, children }: { value: string; children?: ReactNode }) {
  return createElement('option', { value }, children);
}
