import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
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

  it('exposes a min 44px hit target on the trigger (FE-07)', () => {
    render(
      <Select>
        <SelectTrigger aria-label="fruit">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'fruit' }).className).toMatch(/min-h-11/);
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

  it('renders SelectGroup, SelectLabel, and SelectSeparator inside an open menu', async () => {
    const user = userEvent.setup();
    render(
      <Select>
        <SelectTrigger aria-label="fruit">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel className="custom-label">Fruits</SelectLabel>
            <SelectItem value="apple">Apple</SelectItem>
          </SelectGroup>
          <SelectSeparator className="custom-sep" />
          <SelectGroup>
            <SelectLabel>Veggies</SelectLabel>
            <SelectItem value="carrot">Carrot</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    // Open the menu via keyboard
    const trigger = screen.getByRole('combobox', { name: 'fruit' });
    trigger.focus();
    await user.keyboard('{Enter}');
    // Both group labels should be visible
    const fruitsLabel = await screen.findByText('Fruits');
    expect(fruitsLabel).toBeDefined();
    expect(fruitsLabel.className).toContain('custom-label');
    expect(screen.getByText('Veggies')).toBeDefined();
    // Separator: rendered via Radix as role=none with our custom class
    const sep = document.querySelector('.custom-sep');
    expect(sep).not.toBeNull();
  });

  it('exports the scroll button primitives', () => {
    // SelectContent already mounts SelectScrollUpButton and SelectScrollDownButton,
    // so their forwardRef wrappers execute on every Select render. Verify they
    // are exported for downstream consumers.
    expect(typeof SelectScrollUpButton).toBe('object');
    expect(typeof SelectScrollDownButton).toBe('object');
  });
});
