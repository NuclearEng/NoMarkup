import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;

  // Radix Select uses scrollIntoView which jsdom doesn't implement
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* noop in jsdom */
  };

  // hasPointerCapture is required by Radix Select on jsdom
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false;
  };
});

describe('Select', () => {
  it('renders the trigger', () => {
    render(
      <Select>
        <SelectTrigger aria-label="fruit">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'fruit' })).toBeDefined();
  });

  it('shows placeholder while no value selected', () => {
    render(
      <Select>
        <SelectTrigger aria-label="fruit">
          <SelectValue placeholder="Choose me" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText('Choose me')).toBeDefined();
  });

  it('reflects controlled value in the trigger', () => {
    render(
      <Select value="banana">
        <SelectTrigger aria-label="fruit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText('Banana')).toBeDefined();
  });
});
