import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Radix relies on a number of DOM APIs that jsdom does not implement.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
  } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture = function (): boolean { return false; };
  Element.prototype.scrollIntoView = function (): void { /* noop */ };
});

describe('DropdownMenu', () => {
  it('renders the trigger', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Menu')).toBeDefined();
  });

  it('does not show items while closed', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Hidden Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.queryByText('Hidden Item')).toBeNull();
  });

  it('opens on trigger click', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Section</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Click Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Menu'));
    expect(screen.getByText('Click Item')).toBeDefined();
    expect(screen.getByText('Section')).toBeDefined();
  });

  it('fires onSelect on item activation', async () => {
    const user = userEvent.setup();
    let handlerCalls = 0;
    function handler(): void { handlerCalls += 1; }
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>M</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handler}>Activate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('M'));
    await user.click(screen.getByText('Activate'));
    expect(handlerCalls).toBe(1);
  });

  it('renders inset items with extra padding', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem inset>Inset Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Open'));
    const item = screen.getByText('Inset Item');
    expect(item.className).toMatch(/pl-8/);
  });

  it('renders inset label with extra padding', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel inset>Inset Label</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Open'));
    const lbl = screen.getByText('Inset Label');
    expect(lbl.className).toMatch(/pl-8/);
  });

  it('renders a checkbox item with checked state', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked>Show Hidden</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={false}>Auto Save</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Open'));
    expect(screen.getByText('Show Hidden')).toBeDefined();
    expect(screen.getByText('Auto Save')).toBeDefined();
  });

  it('renders radio items inside a radio group', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">Alpha</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="b">Beta</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Open'));
    expect(screen.getByText('Alpha')).toBeDefined();
    expect(screen.getByText('Beta')).toBeDefined();
  });

  it('renders a shortcut span with custom className applied', () => {
    const { container } = render(
      <DropdownMenuShortcut className="my-shortcut">Cmd+K</DropdownMenuShortcut>,
    );
    const span = container.querySelector('span.my-shortcut');
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe('Cmd+K');
  });

  it('forwards a ref to the trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger ref={ref}>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>X</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(ref.current).not.toBeNull();
  });

  it('groups items inside a DropdownMenuGroup', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem>Grouped</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Open'));
    expect(screen.getByText('Grouped')).toBeDefined();
  });

  it('renders a sub-menu trigger', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub Item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Open'));
    expect(screen.getByText('More')).toBeDefined();
  });

  it('renders a sub-menu trigger with inset spacing', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>Indented</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub Item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Open'));
    expect(screen.getByText('Indented').className).toMatch(/pl-8/);
  });

  it('honors a custom className on the menu content', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent className="my-content">
          <DropdownMenuItem>X</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Open'));
    const content = document.querySelector('.my-content');
    expect(content).not.toBeNull();
  });

  it('honors a custom className on the separator', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSeparator className="my-sep" />
          <DropdownMenuItem>X</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Open'));
    expect(document.querySelector('.my-sep')).not.toBeNull();
  });

  it('exposes min 44px hit targets on menu items (FE-07)', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Plain Item</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Check Item</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">Radio Item</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Sub Trigger</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Nested</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByText('Open'));
    expect(screen.getByText('Plain Item').className).toMatch(/min-h-11/);
    expect(screen.getByText('Check Item').className).toMatch(/min-h-11/);
    expect(screen.getByText('Radio Item').className).toMatch(/min-h-11/);
    expect(screen.getByText('Sub Trigger').className).toMatch(/min-h-11/);
  });
});
