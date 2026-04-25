import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProgressiveImage } from '@/components/ui/ProgressiveImage';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: { src: string; alt: string; className?: string }) => (
    <img src={props.src} alt={props.alt} className={props.className} />
  ),
}));

describe('ProgressiveImage', () => {
  it('renders the image with alt text', () => {
    render(<ProgressiveImage src="/p.jpg" alt="Photo" width={100} height={100} />);
    expect(screen.getByAltText('Photo')).toBeDefined();
  });

  it('forwards className', () => {
    const { container } = render(
      <ProgressiveImage src="/p.jpg" alt="x" className="my-img" width={50} height={50} />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-img');
  });

  it('uses fill mode when width or height is missing', () => {
    render(<ProgressiveImage src="/p.jpg" alt="fill" />);
    expect(screen.getByAltText('fill')).toBeDefined();
  });

  it('decodes the average color from a blurHash background', () => {
    const { container } = render(
      <ProgressiveImage src="/p.jpg" alt="bh" blurHash="LEHV6nWB2yk8pyo0adR*.7kCMdnj" />,
    );
    const div = container.firstChild as HTMLElement;
    expect(div.style.backgroundColor).toMatch(/rgb/);
  });
});
