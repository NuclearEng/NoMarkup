// ListingPostingForm — the six-step "Sell something" wizard, driven end to end.
// Order: Photos → Category → Details → Pickup → Auction → Review. Photos come
// first so the analysis of the first photo can prefill the steps after it.
//
// MOCKED: the create-listing mutation, the storage upload hook, photo-quality
// scoring, the AI analyze route (global fetch), and three heavy UI leaves
// (Radix Select → native <select>, SortablePhotoGrid and PhotoCropper → small
// stubs that expose the same callbacks).
// PROVEN: per-step validation messages, the review summary, the exact payload
// sent to the mutation (cents, null condition, confirmed photo URLs in grid
// order), publish failure modes, the low-quality gate, and AI auto-fill
// notices and request shape.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { Fragment, createElement, type ChangeEvent, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PhotoCropperProps } from '@/components/ui/PhotoCropper';
import type { SortablePhotoGridProps } from '@/components/ui/SortablePhotoGrid';
import type { UploadOutcome } from '@/hooks/useImageUpload';
import type { CreateListingInput } from '@/types';

const mocks = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  mutateAsync: vi.fn<(input: CreateListingInput) => Promise<{ id: string }>>(),
  upload: vi.fn<(file: File) => Promise<UploadOutcome>>(),
  score: vi.fn<(file: File) => Promise<{ score: number; hints: string[] }>>(),
  getAccessToken: vi.fn<() => string | null>(),
  uploadContexts: [] as string[],
  createState: { isPending: false },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));

vi.mock('@/hooks/useListings', () => ({
  useCreateListing: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: mocks.createState.isPending,
  }),
}));

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: (options: { context: string }) => {
    mocks.uploadContexts.push(options.context);
    return { upload: mocks.upload, status: 'idle', progress: 0, error: null, reset: vi.fn() };
  },
}));

vi.mock('@/lib/photo-quality', () => ({
  scorePhotoQuality: mocks.score,
}));

vi.mock('@/lib/auth', () => ({
  getAccessToken: mocks.getAccessToken,
}));

vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: () => ({ data: [], isLoading: false, isError: false }),
  useGoodsCategoryTree: () => ({
    data: [
      {
        id: 'goods-furniture',
        parentId: 'goods',
        name: 'Furniture',
        slug: 'furniture',
        level: 2,
        description: null,
        icon: null,
        sortOrder: 0,
        children: [],
      },
      {
        id: 'cat-electronics',
        parentId: 'goods',
        name: 'Electronics',
        slug: 'goods-electronics',
        level: 2,
        description: null,
        icon: null,
        sortOrder: 1,
        children: [
          {
            id: 'cat-audio',
            parentId: 'cat-electronics',
            name: 'Audio',
            slug: 'goods-electronics-audio',
            level: 3,
            description: null,
            icon: null,
            sortOrder: 0,
            children: [],
          },
        ],
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

// Radix Select needs pointer-capture + layout APIs jsdom lacks. A native
// <select> keeps the same value / onValueChange contract.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
    ...rest
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) =>
    createElement(
      'select',
      {
        ...rest,
        value,
        onChange: (e: ChangeEvent<HTMLSelectElement>) => {
          onValueChange(e.target.value);
        },
      },
      children,
    ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement('option', { value }, children),
}));

vi.mock('@/components/ui/SortablePhotoGrid', () => ({
  SortablePhotoGrid: ({
    photos,
    onReorder,
    onCropEdit,
    onRemove,
    onAdd,
    maxPhotos,
  }: SortablePhotoGridProps) =>
    createElement(
      'div',
      { 'data-testid': 'photo-grid', 'data-max': String(maxPhotos) },
      photos.map((photo, index) =>
        createElement(
          'div',
          { key: photo.id, 'data-testid': 'photo-tile', 'data-url': photo.url },
          createElement(
            'span',
            null,
            photo.quality ? `quality ${String(photo.quality.score)}` : 'scoring',
          ),
          createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                onCropEdit(index);
              },
            },
            `Crop photo ${String(index + 1)}`,
          ),
          createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                onRemove(index);
              },
            },
            `Remove photo ${String(index + 1)}`,
          ),
        ),
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            onReorder([...photos].reverse());
          },
        },
        'Reverse order',
      ),
      createElement('button', { type: 'button', onClick: onAdd }, 'Add photo'),
    ),
}));

vi.mock('@/components/ui/PhotoCropper', () => ({
  PhotoCropper: ({ src, onSave, onCancel }: PhotoCropperProps) =>
    createElement(
      'div',
      { role: 'dialog', 'aria-label': 'Crop photo', 'data-src': src },
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            onSave(new Blob(['cropped'], { type: 'image/jpeg' }));
          },
        },
        'Save crop',
      ),
      createElement('button', { type: 'button', onClick: onCancel }, 'Cancel crop'),
    ),
}));

import { ListingPostingForm } from '@/components/marketplace/ListingPostingForm';

const TITLE = 'Solid oak dining table';
const DESCRIPTION = 'Seats six, light wear on one leg, pickup only.';

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
let objectUrlCount = 0;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function photo(name: string, type = 'image/jpeg', content = 'pixels'): File {
  return new File([content], name, { type });
}

function stepLabel(n: number): string {
  return `Step ${String(n)} of 6`;
}

function expectStep(n: number) {
  expect(screen.getByText(stepLabel(n))).toBeInTheDocument();
}

async function next(user: UserEvent, expectedStep: number) {
  await user.click(screen.getByRole('button', { name: /^Next/ }));
  await screen.findByText(stepLabel(expectedStep));
}

function addPhotos(files: File[]) {
  fireEvent.change(screen.getByLabelText('Upload listing photos'), { target: { files } });
}

function tiles(): HTMLElement[] {
  return screen.queryAllByTestId('photo-tile');
}

function tileUrls(): (string | null)[] {
  return tiles().map((t) => t.getAttribute('data-url'));
}

/** Step 1 (Photos) → step 2 (Category). */
async function toCategory(user: UserEvent, files: File[] = [photo('a.jpg')]) {
  addPhotos(files);
  await screen.findByTestId('photo-grid');
  await next(user, 2);
}

async function toDetails(user: UserEvent, files?: File[]) {
  await toCategory(user, files);
  await user.click(screen.getByRole('button', { name: 'Furniture' }));
  await next(user, 3);
}

async function toPickup(
  user: UserEvent,
  files?: File[],
  details: { title?: string; description?: string } = {},
) {
  await toDetails(user, files);
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: details.title ?? TITLE },
  });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: details.description ?? DESCRIPTION },
  });
  await next(user, 4);
}

async function toAuction(user: UserEvent, files?: File[]) {
  await toPickup(user, files);
  fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
  await next(user, 5);
}

async function toReview(user: UserEvent, files?: File[]) {
  await toAuction(user, files);
  fireEvent.change(screen.getByPlaceholderText('50.00'), { target: { value: '49.99' } });
  await next(user, 6);
}

/** From step 1 with photos already added, fill every later step up to Review. */
async function finishFromPhotos(user: UserEvent) {
  await next(user, 2);
  await user.click(screen.getByRole('button', { name: 'Furniture' }));
  await next(user, 3);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: TITLE } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: DESCRIPTION } });
  await next(user, 4);
  fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
  await next(user, 5);
  fireEvent.change(screen.getByPlaceholderText('50.00'), { target: { value: '5' } });
  await next(user, 6);
}

function aiTags(): HTMLElement[] {
  return screen.queryAllByTestId('ai-suggested-tag');
}

function publishButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Publish listing' });
}

function reviewRow(label: string): HTMLElement {
  const row = screen.getByText(label).parentElement;
  if (!row) throw new Error(`no review row for ${label}`);
  return row;
}

function publishedInput(): CreateListingInput {
  const call = mocks.mutateAsync.mock.calls[0];
  if (!call) throw new Error('create listing was not called');
  return call[0];
}

function analyzeRequest(): { url: string; init: RequestInit; body: unknown } {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error('analyze route was not called');
  const init = call[1] ?? {};
  if (typeof init.body !== 'string') throw new Error('analyze body was not a JSON string');
  const body: unknown = JSON.parse(init.body);
  return { url: call[0], init, body };
}

beforeEach(() => {
  objectUrlCount = 0;
  mocks.push.mockReset();
  mocks.mutateAsync.mockReset();
  mocks.mutateAsync.mockResolvedValue({ id: 'listing-9' });
  mocks.upload.mockReset();
  mocks.upload.mockImplementation((file) =>
    Promise.resolve({
      ok: true,
      result: { objectKey: file.name, confirmedUrl: `https://cdn.test/${file.name}` },
    }),
  );
  mocks.score.mockReset();
  mocks.score.mockResolvedValue({ score: 80, hints: [] });
  mocks.getAccessToken.mockReset();
  mocks.getAccessToken.mockReturnValue(null);
  mocks.uploadContexts.length = 0;
  mocks.createState.isPending = false;

  // Default: the AI route is "not configured" — a soft notice, nothing filled.
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({}, 503)));
  vi.stubGlobal('fetch', fetchMock);

  URL.createObjectURL = vi.fn(() => {
    objectUrlCount += 1;
    return `blob:http://localhost/${String(objectUrlCount)}`;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ListingPostingForm — step validation', () => {
  it('starts on Photos and requires at least one photo before leaving step 1', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    expect(screen.getByText('Photos — Start with 1–10 photos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^Next/ }));
    expect(await screen.findByText('At least one photo is required')).toBeInTheDocument();
    expectStep(1);
  });

  it('requires a category before leaving step 2', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toCategory(user);
    expect(screen.getByText('Category — What are you selling?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Next/ }));
    expect(await screen.findByText('Category is required')).toBeInTheDocument();
    expectStep(2);
  });

  it('advances to Details once a category is picked, and Back walks to Category then Photos', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toDetails(user);
    expect(screen.getByText('Details — Title and description')).toBeInTheDocument();
    const back = screen.getByRole('button', { name: /Back/ });
    expect(back).toBeEnabled();
    await user.click(back);
    expectStep(2);
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expectStep(1);
    expect(screen.getByRole('button', { name: /Back/ })).toBeDisabled();
  });

  it('shows the title and description length rules on Details', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toDetails(user);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sofa' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Too short' } });
    await user.click(screen.getByRole('button', { name: /^Next/ }));
    expect(await screen.findByText('Title must be at least 5 characters')).toBeInTheDocument();
    expect(screen.getByText('Description must be at least 20 characters')).toBeInTheDocument();
    expectStep(3);
  });

  it('names each step in the new order next to the progress bar', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    expect(screen.getByLabelText('Listing creation progress')).toBeInTheDocument();
    const seen: string[] = [];
    const heading = () =>
      screen.getByText(/^Step \d of 6$/).nextElementSibling?.textContent ?? '';
    seen.push(heading());
    await toCategory(user);
    seen.push(heading());
    await user.click(screen.getByRole('button', { name: 'Furniture' }));
    await next(user, 3);
    seen.push(heading());
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: TITLE } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: DESCRIPTION } });
    await next(user, 4);
    seen.push(heading());
    fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
    await next(user, 5);
    seen.push(heading());
    fireEvent.change(screen.getByPlaceholderText('50.00'), { target: { value: '5' } });
    await next(user, 6);
    seen.push(heading());
    expect(seen).toEqual([
      'Photos — Start with 1–10 photos',
      'Category — What are you selling?',
      'Details — Title and description',
      'Pickup — Where to pick up',
      'Auction — Starting price + duration',
      'Review — Confirm and publish',
    ]);
  });

  it('rejects a malformed pickup zip', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toPickup(user);
    fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '9411' } });
    await user.click(screen.getByRole('button', { name: /^Next/ }));
    expect(
      await screen.findByText('Pickup zip must be a valid 5-digit zip code'),
    ).toBeInTheDocument();
    expectStep(4);
  });

  it('accepts a ZIP+4 pickup zip', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toPickup(user);
    fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110-1234' } });
    await next(user, 5);
    expect(screen.getByText('Auction — Starting price + duration')).toBeInTheDocument();
  });

  it('requires a starting price above $0', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toAuction(user);
    await user.click(screen.getByRole('button', { name: /^Next/ }));
    expect(
      await screen.findByText('Starting price must be greater than $0'),
    ).toBeInTheDocument();
    expectStep(5);
  });

  it('rejects a buy-now price below the starting price', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toAuction(user);
    fireEvent.change(screen.getByPlaceholderText('50.00'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Buy now price in dollars'), {
      target: { value: '49.99' },
    });
    await user.click(screen.getByRole('button', { name: /^Next/ }));
    expect(
      await screen.findByText('Buy now must be at least the starting price.'),
    ).toBeInTheDocument();
    expectStep(5);
  });

  it('marks only the chosen auction duration as pressed, defaulting to 48 hours', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toAuction(user);
    const pressed = () =>
      ['24 hours', '48 hours', '7 days'].map((label) =>
        screen.getByRole('button', { name: new RegExp(label) }).getAttribute('aria-pressed'),
      );
    expect(pressed()).toEqual(['false', 'true', 'false']);
    await user.click(screen.getByRole('button', { name: /7 days/ }));
    expect(pressed()).toEqual(['false', 'false', 'true']);
  });
});

describe('ListingPostingForm — review summary', () => {
  it('summarises a minimal listing without a buy-now row or address', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toReview(user);
    expect(reviewRow('Category')).toHaveTextContent('Furniture');
    expect(reviewRow('Title')).toHaveTextContent(TITLE);
    expect(reviewRow('Description')).toHaveTextContent(DESCRIPTION);
    expect(reviewRow('Photos')).toHaveTextContent('1 attached');
    expect(within(reviewRow('Pickup')).getByText('94110')).toBeInTheDocument();
    expect(reviewRow('Starting price')).toHaveTextContent('$49.99');
    expect(reviewRow('Duration')).toHaveTextContent('48 hours');
    expect(screen.queryByText('Buy now')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Next/ })).toBeNull();
  });

  it('includes the private address, buy-now price and chosen duration', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toPickup(user, [photo('a.jpg'), photo('b.png', 'image/png')]);
    fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
    fireEvent.change(screen.getByLabelText('Pickup address (private)'), {
      target: { value: '123 Main St' },
    });
    await next(user, 5);
    fireEvent.change(screen.getByPlaceholderText('50.00'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Buy now price in dollars'), {
      target: { value: '80.5' },
    });
    await user.click(screen.getByRole('button', { name: /7 days/ }));
    await next(user, 6);

    expect(reviewRow('Photos')).toHaveTextContent('2 attached');
    expect(reviewRow('Pickup')).toHaveTextContent('94110 · 123 Main St');
    expect(reviewRow('Starting price')).toHaveTextContent('$50.00');
    expect(reviewRow('Buy now')).toHaveTextContent('$80.50');
    expect(reviewRow('Duration')).toHaveTextContent('7 days');
  });

  it('drops the buy-now row again when the seller clears the field', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toAuction(user);
    fireEvent.change(screen.getByPlaceholderText('50.00'), { target: { value: '50' } });
    const buyNow = screen.getByLabelText('Buy now price in dollars');
    fireEvent.change(buyNow, { target: { value: '80' } });
    fireEvent.change(buyNow, { target: { value: '' } });
    await next(user, 6);
    expect(screen.queryByText('Buy now')).toBeNull();
  });
});

describe('ListingPostingForm — publish', () => {
  it('uploads the photo, sends cents + confirmed URLs, and goes to My listings', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toReview(user);
    await user.click(publishButton());

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/sell/mine');
    });
    expect(mocks.uploadContexts).toContain('listing');
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload.mock.calls[0]?.[0].name).toBe('a.jpg');
    expect(publishedInput()).toEqual({
      category_id: 'goods-furniture',
      title: TITLE,
      description: DESCRIPTION,
      // The confirmed storage URL — never the local blob: preview.
      photo_urls: ['https://cdn.test/a.jpg'],
      pickup_zip: '94110',
      pickup_address: undefined,
      starting_price_cents: 4999,
      buy_now_price_cents: undefined,
      auction_duration_hours: 48,
      condition: null,
      publish: true,
    });
  });

  it('hands the new listing id to onPublishSuccess instead of navigating', async () => {
    const user = userEvent.setup();
    const onPublishSuccess = vi.fn<(listingId: string) => void>();
    render(<ListingPostingForm onPublishSuccess={onPublishSuccess} />);
    await toReview(user);
    await user.click(publishButton());
    await waitFor(() => {
      expect(onPublishSuccess).toHaveBeenCalledWith('listing-9');
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('sends condition, address, buy-now cents and duration when the seller sets them', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toDetails(user);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: TITLE } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: DESCRIPTION } });
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'like_new' } });
    await next(user, 4);
    fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
    fireEvent.change(screen.getByLabelText('Pickup address (private)'), {
      target: { value: '123 Main St' },
    });
    await next(user, 5);
    fireEvent.change(screen.getByPlaceholderText('50.00'), { target: { value: '19.99' } });
    fireEvent.change(screen.getByLabelText('Buy now price in dollars'), {
      target: { value: '120' },
    });
    await user.click(screen.getByRole('button', { name: /24 hours/ }));
    await next(user, 6);
    await user.click(publishButton());

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(publishedInput()).toMatchObject({
      condition: 'like_new',
      pickup_address: '123 Main St',
      starting_price_cents: 1999,
      buy_now_price_cents: 12000,
      auction_duration_hours: 24,
    });
  });

  it('offers every condition grade and sends null after switching back to "Don\'t say"', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    await toDetails(user);
    const condition = screen.getByLabelText('Condition');
    expect(within(condition).getAllByRole('option').map((o) => o.textContent)).toEqual([
      "Don't say",
      'New (sealed/in box)',
      'Like new (used once or twice)',
      'Very good (light wear)',
      'Good (visible wear, fully functional)',
      'Acceptable (well-loved, works)',
      'For parts (broken / not working)',
    ]);
    expect(condition).toHaveValue('unspecified');
    fireEvent.change(condition, { target: { value: 'for_parts' } });
    expect(condition).toHaveValue('for_parts');
    fireEvent.change(condition, { target: { value: 'unspecified' } });
    expect(condition).toHaveValue('unspecified');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: TITLE } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: DESCRIPTION } });
    await next(user, 4);
    fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
    await next(user, 5);
    fireEvent.change(screen.getByPlaceholderText('50.00'), { target: { value: '5' } });
    await next(user, 6);
    await user.click(publishButton());
    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(publishedInput().condition).toBeNull();
  });

  it('publishes photos in the order shown in the grid', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg'), photo('b.jpg')]);
    await screen.findByTestId('photo-grid');
    await user.click(screen.getByRole('button', { name: 'Reverse order' }));
    await finishFromPhotos(user);
    await user.click(publishButton());
    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(publishedInput().photo_urls).toEqual([
      'https://cdn.test/b.jpg',
      'https://cdn.test/a.jpg',
    ]);
  });

  it('shows the upload failure reason and does not create the listing', async () => {
    const user = userEvent.setup();
    mocks.upload.mockResolvedValue({ ok: false, error: 'Max 10 MB' });
    render(<ListingPostingForm />);
    await toReview(user);
    await user.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't upload a photo: Max 10 MB",
    );
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(publishButton()).toBeEnabled();
  });

  it('stops at the first failed upload instead of uploading the rest', async () => {
    const user = userEvent.setup();
    mocks.upload.mockResolvedValue({ ok: false, error: 'Use JPEG, PNG, or WEBP' });
    render(<ListingPostingForm />);
    await toReview(user, [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]);
    await user.click(publishButton());
    await screen.findByRole('alert');
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it('shows the server message when creating the listing fails', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockRejectedValue(new Error('Listing limit reached'));
    render(<ListingPostingForm />);
    await toReview(user);
    await user.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Listing limit reached');
    expect(mocks.push).not.toHaveBeenCalled();
    expect(publishButton()).toBeEnabled();
  });

  it('falls back to a specific message when the failure carries none', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockRejectedValue('boom');
    render(<ListingPostingForm />);
    await toReview(user);
    await user.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to publish listing');
  });

  it('disables the button and says "Uploading photos…" while uploads are in flight', async () => {
    const user = userEvent.setup();
    let finishUpload: (outcome: UploadOutcome) => void = () => undefined;
    mocks.upload.mockImplementation(
      () =>
        new Promise<UploadOutcome>((resolve) => {
          finishUpload = resolve;
        }),
    );
    render(<ListingPostingForm />);
    await toReview(user);
    await user.click(publishButton());

    const busy = await screen.findByRole('button', { name: 'Uploading photos…' });
    expect(busy).toBeDisabled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    finishUpload({ ok: true, result: { objectKey: 'k', confirmedUrl: 'https://cdn.test/k.jpg' } });
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/sell/mine');
    });
    expect(publishButton()).toBeEnabled();
  });

  it('disables the button and says "Publishing…" while the mutation is pending', async () => {
    const user = userEvent.setup();
    mocks.createState.isPending = true;
    render(<ListingPostingForm />);
    await toReview(user);
    expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
  });
});

describe('ListingPostingForm — photos', () => {
  it('starts with a dropzone and opens the file picker from "Browse files"', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    render(<ListingPostingForm />);
    expect(screen.getByRole('region', { name: 'Drag and drop photos here' })).toBeInTheDocument();
    expect(screen.getByLabelText('Upload listing photos')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
    await user.click(screen.getByRole('button', { name: 'Browse files' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('accepts dropped photos and replaces the dropzone with the grid', async () => {
    render(<ListingPostingForm />);
    const dropzone = screen.getByRole('region', { name: 'Drag and drop photos here' });
    // dragover must be cancelled or the browser refuses the drop.
    expect(fireEvent.dragOver(dropzone)).toBe(false);
    fireEvent.drop(dropzone, { dataTransfer: { files: [photo('a.jpg'), photo('b.webp', 'image/webp')] } });

    const grid = await screen.findByTestId('photo-grid');
    expect(grid).toHaveAttribute('data-max', '10');
    expect(tileUrls()).toEqual(['blob:http://localhost/1', 'blob:http://localhost/2']);
    expect(screen.queryByRole('region', { name: 'Drag and drop photos here' })).toBeNull();
  });

  it('ignores an empty drop', () => {
    render(<ListingPostingForm />);
    const dropzone = screen.getByRole('region', { name: 'Drag and drop photos here' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [] } });
    expect(screen.queryByTestId('photo-grid')).toBeNull();
    expect(mocks.score).not.toHaveBeenCalled();
  });

  it('ignores files that are not JPEG, PNG or WebP', async () => {
    render(<ListingPostingForm />);
    addPhotos([photo('anim.gif', 'image/gif'), photo('doc.pdf', 'application/pdf')]);
    expect(screen.queryByTestId('photo-grid')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    addPhotos([photo('anim.gif', 'image/gif'), photo('ok.png', 'image/png')]);
    await screen.findByTestId('photo-grid');
    expect(tiles()).toHaveLength(1);
  });

  it('keeps only the first 10 photos', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    addPhotos(Array.from({ length: 12 }, (_, i) => photo(`p${String(i)}.jpg`)));
    await screen.findByTestId('photo-grid');
    expect(tiles()).toHaveLength(10);
    await next(user, 2);
  });

  it('shows each photo as scoring until its quality result arrives', async () => {
    let finishScore: (q: { score: number; hints: string[] }) => void = () => undefined;
    mocks.score.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishScore = resolve;
        }),
    );
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await screen.findByTestId('photo-grid');
    expect(screen.getByText('scoring')).toBeInTheDocument();
    finishScore({ score: 72, hints: [] });
    expect(await screen.findByText('quality 72')).toBeInTheDocument();
  });

  it('removing the only photo brings back the dropzone and the required error', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await screen.findByTestId('photo-grid');
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(
      await screen.findByRole('region', { name: 'Drag and drop photos here' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('At least one photo is required')).toBeInTheDocument();
  });

  it('removes the chosen photo and keeps the others in order', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]);
    await screen.findByTestId('photo-grid');
    await user.click(screen.getByRole('button', { name: 'Remove photo 2' }));
    expect(tileUrls()).toEqual(['blob:http://localhost/1', 'blob:http://localhost/3']);
  });

  it('opens the file picker from the grid\'s add tile and appends to existing photos', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await screen.findByTestId('photo-grid');
    await user.click(screen.getByRole('button', { name: 'Add photo' }));
    expect(click).toHaveBeenCalledTimes(1);
    addPhotos([photo('b.jpg')]);
    await waitFor(() => {
      expect(tiles()).toHaveLength(2);
    });
  });

  it('replaces a photo with its cropped version, re-scores it, and uploads the crop', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg'), photo('b.jpg')]);
    await screen.findByTestId('photo-grid');
    await screen.findAllByText('quality 80');
    mocks.score.mockResolvedValue({ score: 91, hints: [] });

    await user.click(screen.getByRole('button', { name: 'Crop photo 2' }));
    expect(screen.getByRole('dialog', { name: 'Crop photo' })).toHaveAttribute(
      'data-src',
      'blob:http://localhost/2',
    );
    await user.click(screen.getByRole('button', { name: 'Save crop' }));

    expect(screen.queryByRole('dialog', { name: 'Crop photo' })).toBeNull();
    expect(tileUrls()).toEqual(['blob:http://localhost/1', 'blob:http://localhost/3']);
    expect(await screen.findByText('quality 91')).toBeInTheDocument();
    const rescored = mocks.score.mock.calls.at(-1)?.[0];
    expect(rescored?.name).toBe('cropped-photo-2.jpg');
    expect(rescored?.type).toBe('image/jpeg');

    await finishFromPhotos(user);
    await user.click(publishButton());
    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(publishedInput().photo_urls).toEqual([
      'https://cdn.test/a.jpg',
      'https://cdn.test/cropped-photo-2.jpg',
    ]);
  });

  it('leaves the photo untouched when the crop is cancelled', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await screen.findByTestId('photo-grid');
    await user.click(screen.getByRole('button', { name: 'Crop photo 1' }));
    await user.click(screen.getByRole('button', { name: 'Cancel crop' }));
    expect(screen.queryByRole('dialog', { name: 'Crop photo' })).toBeNull();
    expect(tileUrls()).toEqual(['blob:http://localhost/1']);
  });
});

describe('ListingPostingForm — low-quality photo gate', () => {
  it('warns on the photos step with a singular message for one bad photo', async () => {
    mocks.score.mockImplementation((file) =>
      Promise.resolve({ score: file.name === 'blurry.jpg' ? 12 : 80, hints: [] }),
    );
    render(<ListingPostingForm />);
    addPhotos([photo('good.jpg'), photo('blurry.jpg')]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Replace 1 low-quality photo before publishing.',
    );
  });

  it('pluralises the warning and clears it when the bad photos are removed', async () => {
    const user = userEvent.setup();
    mocks.score.mockImplementation((file) =>
      Promise.resolve({ score: file.name.startsWith('blurry') ? 29 : 30, hints: [] }),
    );
    render(<ListingPostingForm />);
    // A score of exactly 30 is publishable; 29 is not.
    addPhotos([photo('edge.jpg'), photo('blurry-1.jpg'), photo('blurry-2.jpg')]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Replace 2 low-quality photos before publishing.',
    );
    await user.click(screen.getByRole('button', { name: 'Remove photo 3' }));
    await user.click(screen.getByRole('button', { name: 'Remove photo 2' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('refuses to publish, without uploading anything, while a low-quality photo remains', async () => {
    const user = userEvent.setup();
    mocks.score.mockResolvedValue({ score: 5, hints: ['Too dark'] });
    render(<ListingPostingForm />);
    await toReview(user);
    await user.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Replace 1 low-quality photo before publishing.',
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('ListingPostingForm — AI auto-fill from the first photo', () => {
  const ANALYSIS = {
    categorySlug: 'goods-electronics',
    title: 'Vintage receiver',
    description: 'A well kept stereo receiver from the seventies.',
    suggestedStartingPriceCents: 4500,
    condition: 'good',
    confidence: 'high',
  };

  /** A fetch that stays pending until the test answers it. */
  function deferredFetch(): (res: Response) => void {
    let respond: (res: Response) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    return (res) => {
      respond(res);
    };
  }

  function selectedCategoryBox(): HTMLElement | null {
    return screen.queryByText('Electronics', { selector: 'span.font-medium' });
  }

  it('shows an analyzing notice until the analysis returns, then says what it filled', async () => {
    const respond = deferredFetch();
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    expect(
      await screen.findByText(
        /Analyzing your first photo to suggest a category, title, description, and starting price/,
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    respond(jsonResponse(ANALYSIS));
    const notice = await screen.findByTestId('ai-autofill-notice');
    expect(notice).toHaveTextContent(
      'AI filled in a category, title, description, and starting price from your first photo ($45.00).',
    );
    expect(screen.queryByText(/Analyzing your first photo/)).toBeNull();
  });

  it('posts the base64 photo with the bearer token to the analyze route', async () => {
    mocks.getAccessToken.mockReturnValue('tok-123');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(ANALYSIS)));
    render(<ListingPostingForm />);
    addPhotos([photo('a.png', 'image/png', 'pixels')]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const { url, init, body } = analyzeRequest();
    expect(url).toBe('/api/analyze-listing-image');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-123',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(body).toEqual({
      imageBase64: btoa('pixels'),
      mimeType: 'image/png',
    });
  });

  it('sends no Authorization header when there is no access token', async () => {
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(analyzeRequest().init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('prefills category, title, description and starting price, each marked "AI suggested", and publishes them', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(ANALYSIS)));
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await screen.findByTestId('ai-autofill-notice');

    // Category: the suggestion is already selected, so Next needs no pick.
    await next(user, 2);
    expect(selectedCategoryBox()).toBeInTheDocument();
    expect(aiTags()).toHaveLength(1);
    expect(screen.getByText(/Suggested from your photo/)).toBeInTheDocument();

    await next(user, 3);
    expect(screen.getByLabelText('Title')).toHaveValue('Vintage receiver');
    expect(screen.getByLabelText('Description')).toHaveValue(ANALYSIS.description);
    expect(aiTags()).toHaveLength(2);

    await next(user, 4);
    expect(aiTags()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
    await next(user, 5);
    expect(screen.getByPlaceholderText('50.00')).toHaveValue(45);
    expect(aiTags()).toHaveLength(1);

    await next(user, 6);
    expect(reviewRow('Category')).toHaveTextContent('Electronics');
    await user.click(publishButton());
    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });
    // Same payload shape as a hand-filled listing; the category is the DB id
    // the slug resolved to, not the slug.
    expect(publishedInput()).toEqual({
      category_id: 'cat-electronics',
      title: 'Vintage receiver',
      description: ANALYSIS.description,
      photo_urls: ['https://cdn.test/a.jpg'],
      pickup_zip: '94110',
      pickup_address: undefined,
      starting_price_cents: 4500,
      buy_now_price_cents: undefined,
      auction_duration_hours: 48,
      condition: null,
      publish: true,
    });
  });

  it('resolves a suggested subcategory slug anywhere in the tree', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ ...ANALYSIS, categorySlug: 'goods-electronics-audio' })),
    );
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await screen.findByTestId('ai-autofill-notice');
    await next(user, 2);
    expect(screen.getByText('Audio', { selector: 'span.font-medium' })).toBeInTheDocument();
  });

  it('leaves the category to the seller when the suggested slug is not a known category', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ ...ANALYSIS, categorySlug: 'goods-spaceships' })),
    );
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    expect(await screen.findByTestId('ai-autofill-notice')).toHaveTextContent(
      'AI filled in a title, description, and starting price from your first photo',
    );
    await next(user, 2);
    expect(aiTags()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /^Next/ }));
    expect(await screen.findByText('Category is required')).toBeInTheDocument();
    expectStep(2);
  });

  it('drops the "AI suggested" mark once the seller edits a field, and publishes the edit', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(ANALYSIS)));
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await screen.findByTestId('ai-autofill-notice');

    await next(user, 2);
    await user.click(screen.getByRole('button', { name: 'Furniture' }));
    expect(aiTags()).toHaveLength(0);
    expect(screen.getByText(/Search or browse all categories/)).toBeInTheDocument();

    await next(user, 3);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Marantz 2270 receiver' } });
    // Only the edited field loses its mark.
    expect(aiTags()).toHaveLength(1);

    await next(user, 4);
    fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
    await next(user, 5);
    fireEvent.change(screen.getByPlaceholderText('50.00'), { target: { value: '60' } });
    expect(aiTags()).toHaveLength(0);
    await next(user, 6);
    await user.click(publishButton());
    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(publishedInput()).toMatchObject({
      category_id: 'goods-furniture',
      title: 'Marantz 2270 receiver',
      description: ANALYSIS.description,
      starting_price_cents: 6000,
    });
  });

  it('never overwrites what the seller typed while a slow analysis was still running', async () => {
    const user = userEvent.setup();
    const respond = deferredFetch();
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await screen.findByText(/Analyzing your first photo/);

    // The seller does not wait: the wizard is not blocked by the analysis.
    await next(user, 2);
    expect(screen.getByText(/Analyzing your first photo/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Furniture' }));
    await next(user, 3);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: TITLE } });

    respond(jsonResponse(ANALYSIS));
    expect(await screen.findByTestId('ai-autofill-notice')).toHaveTextContent(
      'AI filled in a description and starting price from your first photo ($45.00).',
    );
    expect(screen.getByLabelText('Title')).toHaveValue(TITLE);
    expect(screen.getByLabelText('Description')).toHaveValue(ANALYSIS.description);
    expect(aiTags()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText('Furniture', { selector: 'span.font-medium' })).toBeInTheDocument();
    expect(aiTags()).toHaveLength(0);
  });

  it('says it filled nothing when the seller had already entered everything', async () => {
    const user = userEvent.setup();
    const respond = deferredFetch();
    render(<ListingPostingForm />);
    await toAuction(user);
    fireEvent.change(screen.getByPlaceholderText('50.00'), { target: { value: '49.99' } });
    respond(jsonResponse(ANALYSIS));
    expect(await screen.findByTestId('ai-autofill-notice')).toHaveTextContent(
      'AI filled in nothing: your own entries were kept.',
    );
    expect(screen.getByPlaceholderText('50.00')).toHaveValue(49.99);
    expect(aiTags()).toHaveLength(0);
  });

  it('caps a suggested title at 120 characters', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ ...ANALYSIS, title: 'T'.repeat(150) })),
    );
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await screen.findByTestId('ai-autofill-notice');
    await next(user, 2);
    await next(user, 3);
    expect(screen.getByLabelText('Title')).toHaveValue('T'.repeat(120));
  });

  it('suggests at least $1 and omits the price from the notice when the model returns 0', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ ...ANALYSIS, suggestedStartingPriceCents: 0 })),
    );
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    const notice = await screen.findByTestId('ai-autofill-notice');
    expect(notice).not.toHaveTextContent('$');
    await next(user, 2);
    await next(user, 3);
    await next(user, 4);
    fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
    await next(user, 5);
    expect(screen.getByPlaceholderText('50.00')).toHaveValue(1);
  });

  it('keeps photos, suggestions and typed values when going back and forward', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(ANALYSIS)));
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg'), photo('b.jpg')]);
    await screen.findByTestId('ai-autofill-notice');
    await next(user, 2);
    await next(user, 3);
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'good' } });
    await next(user, 4);
    fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
    fireEvent.change(screen.getByLabelText('Pickup address (private)'), {
      target: { value: '123 Main St' },
    });
    await next(user, 5);
    fireEvent.change(screen.getByLabelText('Buy now price in dollars'), {
      target: { value: '90' },
    });

    // All the way back to Photos…
    for (const step of [4, 3, 2, 1]) {
      await user.click(screen.getByRole('button', { name: /Back/ }));
      await screen.findByText(stepLabel(step));
    }
    expect(tileUrls()).toEqual(['blob:http://localhost/1', 'blob:http://localhost/2']);
    expect(screen.getByTestId('ai-autofill-notice')).toBeInTheDocument();
    // …and the analysis is not run a second time.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // …and forward again: nothing was lost.
    await next(user, 2);
    expect(selectedCategoryBox()).toBeInTheDocument();
    await next(user, 3);
    expect(screen.getByLabelText('Title')).toHaveValue('Vintage receiver');
    expect(screen.getByLabelText('Description')).toHaveValue(ANALYSIS.description);
    expect(screen.getByLabelText('Condition')).toHaveValue('good');
    await next(user, 4);
    expect(screen.getByLabelText('Pickup zip')).toHaveValue('94110');
    expect(screen.getByLabelText('Pickup address (private)')).toHaveValue('123 Main St');
    await next(user, 5);
    expect(screen.getByPlaceholderText('50.00')).toHaveValue(45);
    expect(screen.getByLabelText('Buy now price in dollars')).toHaveValue(90);
    await next(user, 6);
    expect(reviewRow('Photos')).toHaveTextContent('2 attached');
    expect(reviewRow('Buy now')).toHaveTextContent('$90.00');
  });

  it.each([
    ['the route answers 503', () => Promise.resolve(jsonResponse({}, 503))],
    [
      'the route flags aiUnavailable',
      () => Promise.resolve(jsonResponse({ aiUnavailable: true }, 500)),
    ],
    ['the route fails with a JSON error body', () => Promise.resolve(jsonResponse({ error: 'x' }, 500))],
    [
      'the route fails with a non-JSON body',
      () => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 })),
    ],
    [
      'the route returns a payload of the wrong shape',
      () => Promise.resolve(jsonResponse({ title: 'only a title' })),
    ],
    ['the route returns null', () => Promise.resolve(jsonResponse(null))],
    ['the network request fails', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] satisfies [string, () => Promise<Response>][])(
    'shows a soft "fill it in yourself" notice, fills nothing, and the wizard works by hand when %s',
    async (_label, respond) => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(respond);
      render(<ListingPostingForm />);
      addPhotos([photo('a.jpg')]);
      expect(await screen.findByText(/Couldn.t auto-analyze the photo/)).toBeInTheDocument();
      expect(screen.queryByTestId('ai-autofill-notice')).toBeNull();
      // Non-blocking: the photo is attached and every later step starts empty.
      await next(user, 2);
      expect(selectedCategoryBox()).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Furniture' }));
      await next(user, 3);
      expect(screen.getByLabelText('Title')).toHaveValue('');
      expect(screen.getByLabelText('Description')).toHaveValue('');
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: TITLE } });
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: DESCRIPTION } });
      await next(user, 4);
      fireEvent.change(screen.getByLabelText('Pickup zip'), { target: { value: '94110' } });
      await next(user, 5);
      expect(screen.getByPlaceholderText('50.00')).toHaveValue(null);
      expect(aiTags()).toHaveLength(0);
    },
  );

  it('gives up on an analysis that never answers and shows the soft notice', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg')]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/Analyzing your first photo/)).toBeInTheDocument();

    // Fire the 20 s give-up timer by hand instead of waiting for it.
    const giveUp = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 20_000)?.[0];
    if (typeof giveUp !== 'function') throw new Error('no 20 s analysis timeout was armed');
    giveUp();

    expect(await screen.findByText(/Couldn.t auto-analyze the photo/)).toBeInTheDocument();
    expect(screen.queryByText(/Analyzing your first photo/)).toBeNull();
  });

  it('shows the soft notice without calling the route when the photo cannot be read', async () => {
    render(<ListingPostingForm />);
    // An empty file yields a data: URL with no base64 payload.
    addPhotos([photo('empty.jpg', 'image/jpeg', '')]);
    expect(await screen.findByText(/Couldn.t auto-analyze the photo/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('analyzes only the first photo of the session, even after it is removed and replaced', async () => {
    const user = userEvent.setup();
    render(<ListingPostingForm />);
    addPhotos([photo('a.jpg'), photo('b.jpg')]);
    await screen.findByText(/Couldn.t auto-analyze the photo/);
    await user.click(screen.getByRole('button', { name: 'Remove photo 2' }));
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    await screen.findByRole('region', { name: 'Drag and drop photos here' });
    addPhotos([photo('c.jpg')]);
    await screen.findByTestId('photo-grid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
