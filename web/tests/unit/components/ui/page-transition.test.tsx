import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageTransition } from '@/components/ui/page-transition';

describe('PageTransition', () => {
  it('renders children', () => {
    render(
      <PageTransition>
        <p>Hello</p>
      </PageTransition>,
    );
    expect(screen.getByText('Hello')).toBeDefined();
  });

  it('forwards className', () => {
    const { container } = render(
      <PageTransition className="my-transition">
        <p>x</p>
      </PageTransition>,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-transition');
  });
});
