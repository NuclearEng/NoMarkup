import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Label } from '@/components/ui/label';

describe('Label', () => {
  it('renders the label text', () => {
    render(<Label>Email</Label>);
    expect(screen.getByText('Email')).toBeDefined();
  });

  it('forwards className', () => {
    render(<Label className="my-label">Name</Label>);
    expect(screen.getByText('Name').className).toContain('my-label');
  });

  it('associates with an input via htmlFor', () => {
    render(<Label htmlFor="email-field">Email</Label>);
    expect(screen.getByText('Email').getAttribute('for')).toBe('email-field');
  });
});
