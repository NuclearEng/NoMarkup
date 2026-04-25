import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: { src: string; alt: string; className?: string }) => (
    <img src={props.src} alt={props.alt} className={props.className} />
  ),
}));

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({ upload: vi.fn().mockResolvedValue(null) }),
}));

const { ImageUpload } = await import('@/components/ui/ImageUpload');

describe('ImageUpload', () => {
  it('renders the drop zone with default placeholder', () => {
    render(<ImageUpload context="job" onUploadComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Drop an image/ })).toBeDefined();
  });

  it('renders a custom placeholder when provided', () => {
    render(
      <ImageUpload context="job" onUploadComplete={vi.fn()} placeholder="Upload a logo" />,
    );
    expect(screen.getByText('Upload a logo')).toBeDefined();
  });

  it('renders existing image thumbnails', () => {
    render(
      <ImageUpload
        context="job"
        onUploadComplete={vi.fn()}
        existingImages={['https://example.com/a.jpg']}
      />,
    );
    expect(screen.getByAltText('Uploaded image')).toBeDefined();
  });

  it('forwards className', () => {
    const { container } = render(
      <ImageUpload context="job" onUploadComplete={vi.fn()} className="my-upload" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-upload');
  });
});
