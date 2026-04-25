import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QueryProvider } from '@/components/providers/QueryProvider';

describe('QueryProvider', () => {
  it('renders its children', () => {
    render(
      <QueryProvider>
        <div data-testid="child">child content</div>
      </QueryProvider>,
    );
    expect(screen.getByTestId('child').textContent).toBe('child content');
  });
});
