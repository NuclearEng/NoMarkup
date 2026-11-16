// Full-screen photo lightbox. MOCKED: ProgressiveImage (plain <img>, so the
// current photo is observable). PROVEN: open/closed rendering, wrap-around
// navigation by button / keyboard / swipe, zoom bounds and reset, the three
// ways to close, body scroll lock, and focus handling.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListingPhoto } from '@/types';

vi.mock('@/components/ui/ProgressiveImage', () => ({
  ProgressiveImage: ({
    src,
    alt,
    blurHash,
  }: {
    src: string;
    alt: string;
    blurHash?: string | null;
  }) => createElement('img', { src, alt, 'data-blur': blurHash ?? '' }),
}));

import { PhotoLightbox } from '@/components/marketplace/PhotoLightbox';

const PHOTOS: ListingPhoto[] = [
  { id: 'p-1', url: 'https://cdn.test/one.jpg', blur_hash: 'hash-1', sort_order: 0 },
  { id: 'p-2', url: 'https://cdn.test/two.jpg', blur_hash: null, sort_order: 1 },
  { id: 'p-3', url: 'https://cdn.test/three.jpg', blur_hash: null, sort_order: 2 },
];

const onClose = vi.fn();

function renderLightbox(
  props: Partial<{ photos: ListingPhoto[]; initialIndex: number; open: boolean }> = {},
) {
  return render(
    <PhotoLightbox
      photos={props.photos ?? PHOTOS}
      alt="Oak table"
      initialIndex={props.initialIndex ?? 0}
      open={props.open ?? true}
      onClose={onClose}
    />,
  );
}

function dialog() {
  return screen.getByRole('dialog', { name: 'Photo viewer: Oak table' });
}

function currentSrc(): string | null {
  return screen.getByRole('img').getAttribute('src');
}

function counter(): string {
  return dialog().querySelector('[aria-live="polite"]')?.textContent ?? '';
}

function zoomLabel(): string {
  return screen.getByRole('toolbar', { name: 'Zoom controls' }).querySelector('span')
    ?.textContent ?? '';
}

function key(k: string) {
  fireEvent.keyDown(window, { key: k });
}

function swipe(fromX: number, toX: number) {
  fireEvent.touchStart(dialog(), { touches: [{ clientX: fromX }] });
  fireEvent.touchEnd(dialog(), { changedTouches: [{ clientX: toX }] });
}

beforeEach(() => {
  onClose.mockReset();
  document.body.style.overflow = '';
});

describe('PhotoLightbox — rendering', () => {
  it('renders nothing while closed', () => {
    renderLightbox({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders nothing when there are no photos', () => {
    renderLightbox({ photos: [] });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on the requested photo as a labelled modal dialog', () => {
    renderLightbox({ initialIndex: 1 });
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    expect(currentSrc()).toBe('https://cdn.test/two.jpg');
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Oak table — photo 2');
    expect(counter()).toBe('2 / 3');
    expect(zoomLabel()).toBe('100%');
  });

  it('passes the photo blur hash through to the image', () => {
    renderLightbox({ initialIndex: 0 });
    expect(screen.getByRole('img')).toHaveAttribute('data-blur', 'hash-1');
  });

  it('clamps an out-of-range starting index to the last photo', () => {
    renderLightbox({ initialIndex: 99 });
    expect(currentSrc()).toBe('https://cdn.test/three.jpg');
    expect(counter()).toBe('3 / 3');
  });

  it('clamps a negative starting index to the first photo', () => {
    renderLightbox({ initialIndex: -4 });
    expect(currentSrc()).toBe('https://cdn.test/one.jpg');
    expect(counter()).toBe('1 / 3');
  });

  it('hides prev/next when there is only one photo', () => {
    const only = PHOTOS[0];
    if (!only) throw new Error('fixture needs a photo');
    renderLightbox({ photos: [only] });
    expect(screen.queryByRole('button', { name: 'Previous photo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull();
    expect(counter()).toBe('1 / 1');
  });

  it('moves keyboard focus into the dialog when it opens', () => {
    renderLightbox();
    expect(document.activeElement).toBe(dialog());
  });

  it('re-anchors to the new photo and resets zoom when reopened elsewhere', () => {
    const { rerender } = renderLightbox({ initialIndex: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoomLabel()).toBe('150%');

    rerender(
      <PhotoLightbox photos={PHOTOS} alt="Oak table" initialIndex={2} open onClose={onClose} />,
    );
    expect(currentSrc()).toBe('https://cdn.test/three.jpg');
    expect(zoomLabel()).toBe('100%');
  });
});

describe('PhotoLightbox — navigation', () => {
  it('steps forward and wraps from the last photo to the first', () => {
    renderLightbox({ initialIndex: 1 });
    const next = screen.getByRole('button', { name: 'Next photo' });
    fireEvent.click(next);
    expect(counter()).toBe('3 / 3');
    fireEvent.click(next);
    expect(counter()).toBe('1 / 3');
    expect(currentSrc()).toBe('https://cdn.test/one.jpg');
  });

  it('steps backward and wraps from the first photo to the last', () => {
    renderLightbox({ initialIndex: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(counter()).toBe('3 / 3');
    expect(currentSrc()).toBe('https://cdn.test/three.jpg');
  });

  it('navigates with the arrow keys', () => {
    renderLightbox({ initialIndex: 0 });
    key('ArrowRight');
    expect(counter()).toBe('2 / 3');
    key('ArrowLeft');
    key('ArrowLeft');
    expect(counter()).toBe('3 / 3');
  });

  it('ignores keys it does not handle', () => {
    renderLightbox({ initialIndex: 0 });
    key('a');
    key('Enter');
    expect(counter()).toBe('1 / 3');
    expect(zoomLabel()).toBe('100%');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resets zoom when moving to another photo', () => {
    renderLightbox({ initialIndex: 0 });
    key('+');
    key('+');
    expect(zoomLabel()).toBe('200%');
    key('ArrowRight');
    expect(zoomLabel()).toBe('100%');
  });

  it('goes to the next photo on a left swipe past the threshold', () => {
    renderLightbox({ initialIndex: 0 });
    swipe(200, 140);
    expect(counter()).toBe('2 / 3');
  });

  it('goes to the previous photo on a right swipe past the threshold', () => {
    renderLightbox({ initialIndex: 1 });
    swipe(100, 160);
    expect(counter()).toBe('1 / 3');
  });

  it('ignores a swipe shorter than 60px', () => {
    renderLightbox({ initialIndex: 0 });
    swipe(200, 141);
    swipe(200, 259);
    expect(counter()).toBe('1 / 3');
  });

  it('ignores a touch end that had no matching touch start', () => {
    renderLightbox({ initialIndex: 0 });
    fireEvent.touchEnd(dialog(), { changedTouches: [{ clientX: 0 }] });
    expect(counter()).toBe('1 / 3');
  });

  it('ignores a touch sequence that carries no touch points', () => {
    renderLightbox({ initialIndex: 0 });
    fireEvent.touchStart(dialog(), { touches: [] });
    fireEvent.touchEnd(dialog(), { changedTouches: [{ clientX: 0 }] });
    fireEvent.touchStart(dialog(), { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(dialog(), { changedTouches: [] });
    expect(counter()).toBe('1 / 3');
  });
});

describe('PhotoLightbox — zoom', () => {
  it('zooms in 50% per step and scales the photo', () => {
    renderLightbox();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoomLabel()).toBe('150%');
    expect(screen.getByRole('img').parentElement).toHaveStyle({ transform: 'scale(1.5)' });
  });

  it('stops at 400% and disables Zoom in', () => {
    renderLightbox();
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 6; i += 1) fireEvent.click(zoomIn);
    expect(zoomLabel()).toBe('400%');
    expect(zoomIn).toBeDisabled();
    key('=');
    expect(zoomLabel()).toBe('400%');
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
  });

  it('stops at 50% and disables Zoom out', () => {
    renderLightbox();
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    expect(zoomOut).toBeEnabled();
    fireEvent.click(zoomOut);
    expect(zoomLabel()).toBe('50%');
    expect(zoomOut).toBeDisabled();
    key('-');
    expect(zoomLabel()).toBe('50%');
  });

  it.each([
    ['+', '150%'],
    ['=', '150%'],
    ['-', '50%'],
    ['_', '50%'],
  ])('zooms with the %s key', (k, expected) => {
    renderLightbox();
    key(k);
    expect(zoomLabel()).toBe(expected);
  });
});

describe('PhotoLightbox — closing and side effects', () => {
  it('closes on Escape', () => {
    renderLightbox();
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button', () => {
    renderLightbox();
    fireEvent.click(screen.getByRole('button', { name: 'Close photo viewer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', () => {
    renderLightbox();
    fireEvent.click(screen.getByRole('button', { name: 'Close photo viewer (backdrop)' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not react to keys while closed', () => {
    renderLightbox({ open: false });
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening for keys once unmounted', () => {
    const { unmount } = renderLightbox();
    unmount();
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks body scroll while open and restores the previous value on close', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = renderLightbox();
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <PhotoLightbox
        photos={PHOTOS}
        alt="Oak table"
        initialIndex={0}
        open={false}
        onClose={onClose}
      />,
    );
    expect(document.body.style.overflow).toBe('scroll');
  });
});
