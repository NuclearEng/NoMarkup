import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Separator } from '@/components/ui/separator';

describe('Separator', () => {
  it('renders without crashing', () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).not.toBeNull();
  });

  it('forwards className', () => {
    const { container } = render(<Separator className="my-sep" />);
    expect((container.firstChild as HTMLElement).className).toContain('my-sep');
  });

  it('uses vertical orientation when requested', () => {
    const { container } = render(<Separator orientation="vertical" />);
    expect((container.firstChild as HTMLElement).getAttribute('data-orientation')).toBe('vertical');
  });
});
