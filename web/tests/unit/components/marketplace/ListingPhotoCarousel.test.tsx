import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: ({ alt, src, ...rest }: { alt: string; src: string }) =>
    createElement('img', { alt, src, ...rest }),
}));

import { ListingPhotoCarousel } from '@/components/marketplace/ListingPhotoCarousel';
import type { ListingPhoto } from '@/types';

const photos: ListingPhoto[] = [
  { id: 'p1', url: 'https://e.com/1.jpg', blur_hash: null, sort_order: 0 },
  { id: 'p2', url: 'https://e.com/2.jpg', blur_hash: null, sort_order: 1 },
  { id: 'p3', url: 'https://e.com/3.jpg', blur_hash: null, sort_order: 2 },
];

describe('ListingPhotoCarousel', () => {
  it('renders the first photo by default', () => {
    render(<ListingPhotoCarousel photos={photos} alt="Hero" />);
    const img = screen.getAllByRole('img').find((el) => el.getAttribute('alt')?.includes('photo 1'));
    expect(img).toBeDefined();
  });

  it('renders previous/next buttons when there are multiple photos', () => {
    render(<ListingPhotoCarousel photos={photos} alt="Hero" />);
    expect(screen.getByLabelText(/Previous photo/i)).toBeDefined();
    expect(screen.getByLabelText(/Next photo/i)).toBeDefined();
  });

  it('hides nav buttons when only one photo', () => {
    const first = photos[0];
    if (!first) throw new Error('expected at least one photo fixture');
    render(<ListingPhotoCarousel photos={[first]} alt="Hero" />);
    expect(screen.queryByLabelText(/Previous photo/i)).toBeNull();
    expect(screen.queryByLabelText(/Next photo/i)).toBeNull();
  });

  it('advances to the next photo when Next is clicked', () => {
    render(<ListingPhotoCarousel photos={photos} alt="Hero" />);
    fireEvent.click(screen.getByLabelText(/Next photo/i));
    const img = screen
      .getAllByRole('img')
      .find((el) => el.getAttribute('alt')?.includes('photo 2'));
    expect(img).toBeDefined();
  });

  it('wraps around when Next is clicked on last photo', () => {
    render(<ListingPhotoCarousel photos={photos} alt="Hero" />);
    fireEvent.click(screen.getByLabelText(/Next photo/i));
    fireEvent.click(screen.getByLabelText(/Next photo/i));
    fireEvent.click(screen.getByLabelText(/Next photo/i));
    const img = screen
      .getAllByRole('img')
      .find((el) => el.getAttribute('alt')?.includes('photo 1'));
    expect(img).toBeDefined();
  });

  it('jumps to a thumbnail when clicked', () => {
    render(<ListingPhotoCarousel photos={photos} alt="Hero" />);
    fireEvent.click(screen.getByLabelText(/View photo 3/i));
    const img = screen
      .getAllByRole('img')
      .find((el) => el.getAttribute('alt')?.includes('photo 3'));
    expect(img).toBeDefined();
  });

  it('renders empty state when there are no photos', () => {
    render(<ListingPhotoCarousel photos={[]} alt="Hero" />);
    expect(screen.getByLabelText(/No photos available/i)).toBeDefined();
  });

  it('exposes thumbnail buttons as a tablist for keyboard nav', () => {
    render(<ListingPhotoCarousel photos={photos} alt="Hero" />);
    expect(screen.getByRole('tablist')).toBeDefined();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
});
