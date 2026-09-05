import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProgressiveImage } from '@/components/ui/ProgressiveImage';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: {
    src: string;
    alt: string;
    className?: string;
    onLoad?: () => void;
    fill?: boolean;
    width?: number;
    height?: number;
    sizes?: string;
    priority?: boolean;
  }) => (
    <img
      src={props.src}
      alt={props.alt}
      className={props.className}
      onLoad={props.onLoad}
      data-fill={props.fill ? 'true' : 'false'}
      data-priority={props.priority ? 'true' : 'false'}
      data-sizes={props.sizes ?? ''}
      width={props.width}
      height={props.height}
    />
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
    const img = screen.getByAltText('fill');
    expect(img.getAttribute('data-fill')).toBe('true');
    expect(img.getAttribute('data-sizes')).toBe('100vw');
  });

  it('uses fixed-size mode (no fill) when both width and height are provided', () => {
    render(<ProgressiveImage src="/p.jpg" alt="fixed" width={120} height={80} />);
    const img = screen.getByAltText('fixed');
    expect(img.getAttribute('data-fill')).toBe('false');
    expect(img.getAttribute('width')).toBe('120');
    expect(img.getAttribute('height')).toBe('80');
  });

  it('decodes the average color from a blurHash background', () => {
    const { container } = render(
      <ProgressiveImage src="/p.jpg" alt="bh" blurHash="LEHV6nWB2yk8pyo0adR*.7kCMdnj" />,
    );
    const div = container.firstChild as HTMLElement;
    expect(div.style.backgroundColor).toMatch(/rgb/);
  });

  it('falls back to placeholder color when blurHash is too short', () => {
    const { container } = render(
      <ProgressiveImage src="/p.jpg" alt="short" blurHash="abc" width={50} height={50} />,
    );
    const div = container.firstChild as HTMLElement;
    // Browsers normalize "rgb(229, 231, 235)" to that exact form
    expect(div.style.backgroundColor).toBe('rgb(229, 231, 235)');
  });

  it('falls back to placeholder color when blurHash contains an invalid base83 character', () => {
    // A '"' character is NOT in the BASE83 alphabet, so base83Decode returns 0,
    // exercising the early-return branch on line 35.
    const { container } = render(
      <ProgressiveImage src="/p.jpg" alt="invalid" blurHash={'AB"DEF'} width={10} height={10} />,
    );
    const div = container.firstChild as HTMLElement;
    // dcValue == 0 → linearToSrgb(0) → ~1 (rounding), so rgb is near-black
    expect(div.style.backgroundColor).toMatch(/rgb\(\s*1,\s*1,\s*1\s*\)/);
  });

  it('renders priority flag through to next/image', () => {
    render(<ProgressiveImage src="/p.jpg" alt="prio" priority width={20} height={20} />);
    const img = screen.getByAltText('prio');
    expect(img.getAttribute('data-priority')).toBe('true');
  });

  it('switches to opacity-100 after the underlying image fires onLoad', () => {
    render(<ProgressiveImage src="/p.jpg" alt="loadtest" width={50} height={50} />);
    const img = screen.getByAltText('loadtest');
    expect(img.className).toContain('opacity-0');
    fireEvent.load(img);
    expect(img.className).toContain('opacity-100');
  });

  it('also fires onLoad in fill mode (covers fill-branch handleLoad path)', () => {
    render(<ProgressiveImage src="/p.jpg" alt="fillload" />);
    const img = screen.getByAltText('fillload');
    expect(img.className).toContain('opacity-0');
    fireEvent.load(img);
    expect(img.className).toContain('opacity-100');
  });

  it('decodes a blurHash whose linear-space color produces values below the sRGB curve threshold', () => {
    // BlurHash with very small DC components (close to 0) exercises the
    // "clamped <= 0.0031308" branch in linearToSrgb (line 49).
    // "L00000000000" → DC slice "0000" → dcValue = 0 → all RGB linear = 0,
    // forcing the low-luminance branch in linearToSrgb.
    const { container } = render(
      <ProgressiveImage src="/p.jpg" alt="dark" blurHash="L00000000000" width={10} height={10} />,
    );
    const div = container.firstChild as HTMLElement;
    expect(div.style.backgroundColor).toMatch(/rgb\(\s*1,\s*1,\s*1\s*\)/);
  });
});
