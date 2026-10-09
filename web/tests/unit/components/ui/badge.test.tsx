import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('forwards className', () => {
    render(<Badge className="extra-badge">X</Badge>);
    expect(screen.getByText('X').className).toContain('extra-badge');
  });

  it('applies variant styling', () => {
    render(<Badge variant="destructive">Err</Badge>);
    expect(screen.getByText('Err').className).toContain('text-red-400');
  });
});
