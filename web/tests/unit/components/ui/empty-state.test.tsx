import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from '@/components/ui/empty-state';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No data" />);
    expect(screen.getByText('No data')).toBeDefined();
  });

  it('renders an optional description', () => {
    render(<EmptyState title="No data" description="Try adjusting filters" />);
    expect(screen.getByText('Try adjusting filters')).toBeDefined();
  });

  it('renders an optional action node', () => {
    render(<EmptyState title="X" action={<button type="button">Refresh</button>} />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDefined();
  });

  it('renders an optional icon node', () => {
    render(<EmptyState title="Y" icon={<span data-testid="icon">i</span>} />);
    expect(screen.getByTestId('icon')).toBeDefined();
  });

  it('forwards className', () => {
    const { container } = render(<EmptyState title="X" className="my-empty" />);
    expect((container.firstChild as HTMLElement).className).toContain('my-empty');
  });
});
