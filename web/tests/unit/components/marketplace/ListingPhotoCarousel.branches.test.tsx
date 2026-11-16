// ListingPhotoCarousel — Previous wrap-around, lightbox hand-off, and image
// loading hints. Complements ListingPhotoCarousel.test.tsx (Next / thumbnails).
// MOCKED: PhotoLightbox and ProgressiveImage, as stubs exposing their props.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListingPhoto } from '@/types';

interface LightboxProps {
  photos: ListingPhoto[];
  alt: string;
  initialIndex: number;
  open: boolean;
  onClose: () => void;
}

let lightbox: LightboxProps | null = null;
vi.mock('@/components/marketplace/PhotoLightbox', () => ({
  PhotoLightbox: (props: LightboxProps) => {
    lightbox = props;
    return props.open
      ? createElement('div', { role: 'dialog', 'aria-label': 'Photo viewer' })
      : null;
  },
}));

vi.mock('@/components/ui/ProgressiveImage', () => ({
  ProgressiveImage: ({
    src,
    alt,
    blurHash,
    priority,
    sizes,
  }: {
    src: string;
    alt: string;
    blurHash?: string | null;
    priority?: boolean;
    sizes?: string;
  }) =>
    createElement('img', {
      src,
      alt,
      'data-blur': blurHash ?? '',
      'data-priority': String(Boolean(priority)),
      'data-sizes': sizes ?? '',
    }),
}));

import { ListingPhotoCarousel } from '@/components/marketplace/ListingPhotoCarousel';

const PHOTOS: ListingPhoto[] = [
  { id: 'p1', url: 'https://cdn.test/1.jpg', blur_hash: 'hash-1', sort_order: 0 },
  { id: 'p2', url: 'https://cdn.test/2.jpg', blur_hash: null, sort_order: 1 },
  { id: 'p3', url: 'https://cdn.test/3.jpg', blur_hash: null, sort_order: 2 },
];

function hero(): HTMLElement {
  return screen.getByRole('img', { name: /Oak table \(photo/ });
}

function currentLightbox(): LightboxProps {
  if (!lightbox) throw new Error('lightbox was not rendered');
  return lightbox;
}

function selectedTabs(): (string | null)[] {
  return screen.getAllByRole('tab').map((t) => t.getAttribute('aria-selected'));
}

beforeEach(() => {
  lightbox = null;
});

describe('ListingPhotoCarousel — navigation', () => {
  it('Previous on the first photo wraps to the last', () => {
    render(<ListingPhotoCarousel photos={PHOTOS} alt="Oak table" />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(hero()).toHaveAttribute('src', 'https://cdn.test/3.jpg');
    expect(hero()).toHaveAccessibleName('Oak table (photo 3 of 3)');
    expect(selectedTabs()).toEqual(['false', 'false', 'true']);
  });

  it('Previous steps back one photo from the middle', () => {
    render(<ListingPhotoCarousel photos={PHOTOS} alt="Oak table" />);
    fireEvent.click(screen.getByRole('tab', { name: 'View photo 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(hero()).toHaveAccessibleName('Oak table (photo 2 of 3)');
  });

  it('a single photo has no arrows and no thumbnail strip', () => {
    const only = PHOTOS.slice(0, 1);
    render(<ListingPhotoCarousel photos={only} alt="Oak table" />);
    expect(hero()).toHaveAccessibleName('Oak table (photo 1 of 1)');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous photo' })).toBeNull();
  });

  it('falls back to the first photo if the list shrinks below the active index', () => {
    const { rerender } = render(<ListingPhotoCarousel photos={PHOTOS} alt="Oak table" />);
    fireEvent.click(screen.getByRole('tab', { name: 'View photo 3' }));
    rerender(<ListingPhotoCarousel photos={PHOTOS.slice(0, 1)} alt="Oak table" />);
    expect(hero()).toHaveAttribute('src', 'https://cdn.test/1.jpg');
  });

  it('shows a labelled placeholder, and no lightbox, when there are no photos', () => {
    render(<ListingPhotoCarousel photos={[]} alt="Oak table" className="mt-4" />);
    const placeholder = screen.getByRole('img', { name: 'No photos available' });
    expect(placeholder).toHaveClass('mt-4');
    expect(screen.queryByRole('button')).toBeNull();
    expect(lightbox).toBeNull();
  });
});

describe('ListingPhotoCarousel — image loading hints', () => {
  it('marks only the hero image as priority and sizes thumbnails at 85px', () => {
    render(<ListingPhotoCarousel photos={PHOTOS} alt="Oak table" />);
    expect(hero()).toHaveAttribute('data-priority', 'true');
    expect(hero()).toHaveAttribute('data-sizes', '(min-width: 1024px) 60vw, 100vw');
    expect(hero()).toHaveAttribute('data-blur', 'hash-1');
    const thumbs = within(screen.getByRole('tablist', { name: 'Listing photo thumbnails' }))
      .getAllByRole('tab')
      .map((tab) => tab.querySelector('img'));
    expect(thumbs).toHaveLength(3);
    for (const thumb of thumbs) {
      expect(thumb).toHaveAttribute('data-priority', 'false');
      expect(thumb).toHaveAttribute('data-sizes', '85px');
      // Decorative: the tab already carries the accessible name.
      expect(thumb).toHaveAttribute('alt', '');
    }
  });
});

describe('ListingPhotoCarousel — lightbox', () => {
  it('keeps the lightbox closed until the hero photo is clicked', () => {
    render(<ListingPhotoCarousel photos={PHOTOS} alt="Oak table" />);
    expect(currentLightbox().open).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the lightbox on the photo currently shown', () => {
    render(<ListingPhotoCarousel photos={PHOTOS} alt="Oak table" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'View photo 2 full screen' }));
    expect(screen.getByRole('dialog', { name: 'Photo viewer' })).toBeInTheDocument();
    expect(currentLightbox()).toMatchObject({
      open: true,
      initialIndex: 1,
      alt: 'Oak table',
      photos: PHOTOS,
    });
  });

  it('closes the lightbox and stays on the same photo', () => {
    render(<ListingPhotoCarousel photos={PHOTOS} alt="Oak table" />);
    fireEvent.click(screen.getByRole('tab', { name: 'View photo 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'View photo 3 full screen' }));
    act(() => {
      currentLightbox().onClose();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(hero()).toHaveAccessibleName('Oak table (photo 3 of 3)');
  });
});
