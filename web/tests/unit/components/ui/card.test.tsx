import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

describe('Card', () => {
  it('renders all subcomponents together', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(screen.getByText('Title')).toBeDefined();
    expect(screen.getByText('Description')).toBeDefined();
    expect(screen.getByText('Body')).toBeDefined();
    expect(screen.getByText('Footer')).toBeDefined();
  });

  it('forwards className on Card root', () => {
    const { container } = render(<Card className="my-card" />);
    expect((container.firstChild as HTMLElement).className).toContain('my-card');
  });

  it('applies the glass variant', () => {
    const { container } = render(<Card variant="glass" />);
    expect((container.firstChild as HTMLElement).className).toContain('glass');
  });

  it('renders CardTitle as an h3', () => {
    render(<CardTitle>Heading</CardTitle>);
    expect(screen.getByText('Heading').tagName).toBe('H3');
  });
});
