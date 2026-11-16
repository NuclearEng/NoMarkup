import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

describe('Avatar', () => {
  it('renders fallback content when image is not loaded', () => {
    render(
      <Avatar>
        <AvatarImage src="/missing.png" alt="user" />
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('JD')).toBeDefined();
  });

  it('forwards className on Avatar root', () => {
    const { container } = render(
      <Avatar className="my-avatar">
        <AvatarFallback>X</AvatarFallback>
      </Avatar>,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-avatar');
  });

  it('forwards className on AvatarFallback', () => {
    render(
      <Avatar>
        <AvatarFallback className="fb">FB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('FB').className).toContain('fb');
  });
});
