import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

describe('Popover', () => {
  it('renders the trigger', () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText('Open')).toBeDefined();
  });

  it('does not show content while closed', () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Hidden Body</PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText('Hidden Body')).toBeNull();
  });

  it('renders content when controlled open prop is true', () => {
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Visible Body</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText('Visible Body')).toBeDefined();
  });

  it('opens on trigger click', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Click Body</PopoverContent>
      </Popover>,
    );
    await user.click(screen.getByText('Open'));
    expect(screen.getByText('Click Body')).toBeDefined();
  });
});
