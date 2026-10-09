import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ResponseTimeBadge } from '@/components/providers/ResponseTimeBadge';

describe('ResponseTimeBadge', () => {
  it('renders the provided label', () => {
    render(<ResponseTimeBadge label="Responds in 1 hour" />);
    expect(screen.getByText('Responds in 1 hour')).toBeDefined();
  });

  it('uses label as aria-label for screen readers', () => {
    render(<ResponseTimeBadge label="Responds in 5 minutes" />);
    expect(screen.getByLabelText('Responds in 5 minutes')).toBeDefined();
  });

  it('forwards a custom className', () => {
    const { container } = render(
      <ResponseTimeBadge label="Fast" className="custom-class" />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('custom-class');
  });

  it('renders a clock icon marked aria-hidden', () => {
    const { container } = render(<ResponseTimeBadge label="Quick" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});
