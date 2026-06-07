'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft, ChevronRight, ImagePlus, Sparkles } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useForm } from 'react-hook-form';

import type { ListingImageAnalysisResult } from '@/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PhotoCropper } from '@/components/ui/PhotoCropper';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SortablePhotoGrid, type PhotoSlot } from '@/components/ui/SortablePhotoGrid';
import { Textarea } from '@/components/ui/textarea';
import { useCreateListing } from '@/hooks/useListings';
import { scorePhotoQuality } from '@/lib/photo-quality';
import { cn, formatCents } from '@/lib/utils';
import {
  listingPostingSchema,
  type ListingPostingFormValues,
} from '@/lib/validations';
import type { CreateListingInput, ListingDurationHours } from '@/types';

const STEPS = [
  { title: 'Category', description: 'What are you selling?' },
  { title: 'Details', description: 'Title and description' },
  { title: 'Photos', description: '1–10 photos' },
  { title: 'Pickup', description: 'Where to pick up' },
  { title: 'Auction', description: 'Starting price + duration' },
  { title: 'Review', description: 'Confirm and publish' },
] as const;

const MAX_PHOTOS = 10;
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const STEP_FIELDS: Record<number, (keyof ListingPostingFormValues)[]> = {
  0: ['categoryId'],
  1: ['title', 'description', 'condition'],
  2: ['photoUrls'],
  3: ['pickupZip'],
  4: ['startingPriceDollars', 'auctionDurationHours'],
  5: [],
};

// Condition options shown in the dropdown. Empty string = "Don't say"
// (persists as NULL on the listings.condition column). Order matches
// the StockX grade scale: new is the best, for_parts the worst.
const CONDITION_OPTIONS: { value: '' | 'new' | 'like_new' | 'very_good' | 'good' | 'acceptable' | 'for_parts'; label: string }[] = [
  { value: '', label: "Don't say" },
  { value: 'new', label: 'New (sealed/in box)' },
  { value: 'like_new', label: 'Like new (used once or twice)' },
  { value: 'very_good', label: 'Very good (light wear)' },
  { value: 'good', label: 'Good (visible wear, fully functional)' },
  { value: 'acceptable', label: 'Acceptable (well-loved, works)' },
  { value: 'for_parts', label: 'For parts (broken / not working)' },
];

// Radix <Select.Item> forbids an empty-string value, but the form stores ''
// for "unspecified" (→ NULL condition). Render the "Don't say" option with a
// sentinel and map it back to '' on change / display.
const UNSPECIFIED_CONDITION = 'unspecified';

const GOODS_CATEGORIES: { id: string; name: string }[] = [
  { id: 'goods-furniture', name: 'Furniture' },
  { id: 'goods-electronics', name: 'Electronics' },
  { id: 'goods-tools', name: 'Tools' },
  { id: 'goods-sporting', name: 'Sporting Goods' },
  { id: 'goods-vehicles', name: 'Vehicles' },
  { id: 'goods-home-garden', name: 'Home & Garden' },
  { id: 'goods-baby-kids', name: 'Baby & Kids' },
  { id: 'goods-books-media', name: 'Books & Media' },
  { id: 'goods-clothing', name: 'Clothing' },
  { id: 'goods-collectibles', name: 'Collectibles' },
  { id: 'goods-other', name: 'Other' },
];

const KNOWN_GOODS_CATEGORY_IDS = new Set(GOODS_CATEGORIES.map((c) => c.id));

const DURATIONS: { value: ListingDurationHours; label: string; sub: string }[] = [
  { value: 24, label: '24 hours', sub: 'Quick sell' },
  { value: 48, label: '48 hours', sub: 'Most common' },
  { value: 168, label: '7 days', sub: 'Maximum exposure' },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected FileReader result type'));
        return;
      }
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('Could not extract base64 data'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsDataURL(file);
  });
}

function isAnalysisResult(value: unknown): value is ListingImageAnalysisResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['categorySlug'] === 'string' &&
    typeof v['title'] === 'string' &&
    typeof v['description'] === 'string' &&
    typeof v['suggestedStartingPriceCents'] === 'number' &&
    typeof v['condition'] === 'string' &&
    typeof v['confidence'] === 'string'
  );
}

interface ListingPostingFormProps {
  /** Optional callback so tests/wrappers can intercept successful publish */
  onPublishSuccess?: (listingId: string) => void;
}

/**
 * Internal photo state — pairs each visible slot with the underlying File
 * (we still need it for the AI auto-fill upload) and the latest quality
 * result. The grid component cares only about `id`, `url`, and `quality`.
 */
interface PhotoEditorSlot extends PhotoSlot {
  file?: File;
}

const MIN_QUALITY_TO_PUBLISH = 30;

export function ListingPostingForm({ onPublishSuccess }: ListingPostingFormProps = {}) {
  const router = useRouter();
  const createListing = useCreateListing();
  const [step, setStep] = useState(0);
  const [photoSlots, setPhotoSlots] = useState<PhotoEditorSlot[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const slotIdRef = useRef(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [aiState, setAiState] = useState<'idle' | 'analyzing' | 'applied' | 'error'>('idle');
  const [aiSummary, setAiSummary] = useState<ListingImageAnalysisResult | null>(null);
  const aiTriggeredRef = useRef(false);

  function nextSlotId(): string {
    slotIdRef.current += 1;
    return `photo-${String(slotIdRef.current)}`;
  }

  // Mirror slots → form field. Always pass through this so the order of
  // photo URLs in the form matches the visual order in the grid.
  function syncSlotsToForm(slots: PhotoEditorSlot[]) {
    form.setValue(
      'photoUrls',
      slots.map((s) => s.url),
      { shouldValidate: true, shouldDirty: true },
    );
  }

  const form = useForm<ListingPostingFormValues>({
    resolver: zodResolver(listingPostingSchema),
    defaultValues: {
      categoryId: '',
      title: '',
      description: '',
      photoUrls: [],
      pickupZip: '',
      pickupAddress: '',
      startingPriceDollars: 0,
      auctionDurationHours: 48,
      condition: '',
    },
    mode: 'onTouched',
  });

  const progress = ((step + 1) / STEPS.length) * 100;
  const currentStep = STEPS[step];

  const buildInput = useCallback(
    (values: ListingPostingFormValues): CreateListingInput => ({
      category_id: values.categoryId,
      title: values.title,
      description: values.description,
      photo_urls: values.photoUrls,
      pickup_zip: values.pickupZip,
      pickup_address: values.pickupAddress || undefined,
      starting_price_cents: Math.round(values.startingPriceDollars * 100),
      auction_duration_hours: values.auctionDurationHours,
      // Empty string in the form = "Don't say"; serialize as null so the
      // gateway persists NULL rather than rejecting an unknown value.
      // The zod enum permits '' as a sentinel; everything else is a
      // valid grade we forward straight through.
      condition:
        values.condition && (values.condition as string) !== ''
          ? (values.condition as Exclude<NonNullable<typeof values.condition>, ''>)
          : null,
    }),
    [],
  );

  async function validateCurrentStep(): Promise<boolean> {
    const fields = STEP_FIELDS[step];
    if (!fields || fields.length === 0) return true;
    return form.trigger(fields);
  }

  async function goNext() {
    const ok = await validateCurrentStep();
    if (!ok) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  }

  function goPrev() {
    if (step > 0) setStep(step - 1);
  }

  function appendFiles(files: FileList | File[]) {
    const newSlots: PhotoEditorSlot[] = [];
    for (const f of Array.from(files)) {
      if (!ACCEPTED_PHOTO_TYPES.includes(f.type)) continue;
      // Stub: in production, upload via the imaging engine and use the returned URL.
      // For frontend-only build, we use object URLs as placeholder.
      const url = URL.createObjectURL(f);
      newSlots.push({ id: nextSlotId(), url, file: f });
    }
    if (newSlots.length === 0) return;

    const wasEmpty = photoSlots.length === 0;
    const next = [...photoSlots, ...newSlots].slice(0, MAX_PHOTOS);
    setPhotoSlots(next);
    syncSlotsToForm(next);

    // Score newly added photos in the background.
    for (const slot of newSlots) {
      if (!slot.file) continue;
      const slotId = slot.id;
      const fileForScoring = slot.file;
      void scorePhotoQuality(fileForScoring).then((quality) => {
        setPhotoSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, quality } : s)));
      });
    }

    // Fire AI auto-fill on the very first photo upload (only once per session).
    if (wasEmpty && newSlots.length > 0 && !aiTriggeredRef.current) {
      const firstFile = newSlots[0]?.file;
      if (firstFile) {
        aiTriggeredRef.current = true;
        void analyzeFirstPhoto(firstFile);
      }
    }
  }

  async function analyzeFirstPhoto(file: File) {
    setAiState('analyzing');
    try {
      const imageBase64 = await fileToBase64(file);
      const res = await fetch('/api/analyze-listing-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType: file.type }),
      });
      if (!res.ok) {
        setAiState('error');
        return;
      }
      const data: unknown = await res.json();
      if (!isAnalysisResult(data)) {
        setAiState('error');
        return;
      }
      applyAnalysis(data);
      setAiSummary(data);
      setAiState('applied');
    } catch {
      setAiState('error');
    }
  }

  function applyAnalysis(result: ListingImageAnalysisResult) {
    const current = form.getValues();
    // Only fill empty fields — never clobber what the user has already typed.
    if (!current.title.trim()) {
      form.setValue('title', result.title.slice(0, 120), {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
    if (!current.description.trim()) {
      form.setValue('description', result.description, {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
    if (!current.categoryId && KNOWN_GOODS_CATEGORY_IDS.has(result.categorySlug)) {
      form.setValue('categoryId', result.categorySlug, {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
    if (!current.startingPriceDollars || current.startingPriceDollars === 0) {
      const dollars = Math.max(1, Math.round(result.suggestedStartingPriceCents / 100));
      form.setValue('startingPriceDollars', dollars, {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    appendFiles(e.target.files);
    e.target.value = '';
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (e.dataTransfer.files.length === 0) return;
    appendFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  function removePhoto(idx: number) {
    const next = photoSlots.filter((_, i) => i !== idx);
    setPhotoSlots(next);
    syncSlotsToForm(next);
  }

  function reorderPhotos(next: PhotoSlot[]) {
    // Re-attach `file` references from current state so we don't lose them on reorder.
    const merged: PhotoEditorSlot[] = next.map((slot) => {
      const existing = photoSlots.find((s) => s.id === slot.id);
      return { ...slot, file: existing?.file };
    });
    setPhotoSlots(merged);
    syncSlotsToForm(merged);
  }

  function handleCropSave(blob: Blob) {
    if (editingIndex === null) return;
    const target = photoSlots[editingIndex];
    if (!target) {
      setEditingIndex(null);
      return;
    }
    const newFile = new File([blob], `cropped-${target.id}.jpg`, { type: 'image/jpeg' });
    const newUrl = URL.createObjectURL(blob);
    const updated: PhotoEditorSlot = {
      id: target.id,
      url: newUrl,
      file: newFile,
      quality: undefined,
    };
    const next = photoSlots.map((s, i) => (i === editingIndex ? updated : s));
    setPhotoSlots(next);
    syncSlotsToForm(next);
    setEditingIndex(null);
    // Re-score the cropped result in the background.
    void scorePhotoQuality(newFile).then((quality) => {
      setPhotoSlots((prev) => prev.map((s) => (s.id === updated.id ? { ...s, quality } : s)));
    });
  }

  /**
   * Number of photos below the publish threshold. Surfaced to the seller
   * before the final publish step so they can swap in better photos.
   */
  const lowQualityCount = photoSlots.filter(
    (s) => s.quality !== undefined && s.quality.score < MIN_QUALITY_TO_PUBLISH,
  ).length;

  async function handlePublish() {
    const ok = await form.trigger();
    if (!ok) return;
    if (lowQualityCount > 0) {
      form.setError('root', {
        message: `Replace ${String(lowQualityCount)} low-quality photo${
          lowQualityCount === 1 ? '' : 's'
        } before publishing.`,
      });
      return;
    }
    try {
      const values = form.getValues();
      const input: CreateListingInput = { ...buildInput(values), publish: true };
      const created = await createListing.mutateAsync(input);
      if (onPublishSuccess) {
        onPublishSuccess(created.id);
        return;
      }
      router.push('/sell/mine' as Route);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish listing';
      form.setError('root', { message });
    }
  }

  const values = form.watch();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Sell something</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Create a listing — buyers bid up, highest bidder wins.
        </p>
      </div>

      <Progress value={progress} className="mb-6" aria-label="Listing creation progress" />
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm text-zinc-400">
        <span className="font-medium text-zinc-200">
          Step {String(step + 1)} of {String(STEPS.length)}
        </span>
        <span>{currentStep ? `${currentStep.title} — ${currentStep.description}` : ''}</span>
      </div>

      <Form {...form}>
        <Card className="mt-2 bg-card">
          <CardHeader>
            <CardTitle>{currentStep?.title}</CardTitle>
            <CardDescription>{currentStep?.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Step 0: Category */}
            {step === 0 ? (
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={(v) => {
                          field.onChange(v);
                        }}
                      >
                        <SelectTrigger className="min-h-[44px]">
                          <SelectValue placeholder="Pick a category" />
                        </SelectTrigger>
                        <SelectContent>
                          {GOODS_CATEGORIES.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/* Step 1: Details */}
            {step === 1 ? (
              <>
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="IKEA dining table — solid oak, 6-seat"
                          maxLength={120}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={6}
                          placeholder="Condition, dimensions, why you're selling..."
                          maxLength={5000}
                        />
                      </FormControl>
                      <FormDescription>Markdown supported. 20–5000 characters.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="condition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Condition</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value ? field.value : UNSPECIFIED_CONDITION}
                          onValueChange={(v) => {
                            field.onChange(v === UNSPECIFIED_CONDITION ? '' : v);
                          }}
                        >
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue placeholder="Pick a condition (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            {CONDITION_OPTIONS.map((c) => (
                              <SelectItem
                                key={c.value || UNSPECIFIED_CONDITION}
                                value={c.value === '' ? UNSPECIFIED_CONDITION : c.value}
                              >
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription>
                        StockX-style grade. Leave blank to skip — buyers prefer when it&apos;s set.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}

            {/* Step 2: Photos */}
            {step === 2 ? (
              <FormField
                control={form.control}
                name="photoUrls"
                render={() => (
                  <FormItem>
                    <FormLabel>Photos (1–{MAX_PHOTOS})</FormLabel>
                    {aiState === 'analyzing' ? (
                      <div
                        role="status"
                        aria-live="polite"
                        className="mb-3 flex items-start gap-2 rounded-md border border-[var(--brand-gold)]/30 bg-[var(--brand-gold)]/5 p-3 text-sm text-zinc-200"
                      >
                        <Sparkles
                          className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-[var(--brand-gold)]"
                          aria-hidden="true"
                        />
                        <span>Analyzing your photo to suggest a title, category, and price…</span>
                      </div>
                    ) : null}
                    {aiState === 'applied' && aiSummary ? (
                      <div
                        role="status"
                        aria-live="polite"
                        className="mb-3 flex items-start gap-2 rounded-md border border-[var(--brand-gold)]/30 bg-[var(--brand-gold)]/5 p-3 text-sm text-zinc-200"
                      >
                        <Sparkles
                          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-gold)]"
                          aria-hidden="true"
                        />
                        <span>
                          AI suggested a title, category, and starting price — edit anything before
                          publishing.
                        </span>
                      </div>
                    ) : null}

                    {photoSlots.length === 0 ? (
                      <div
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        role="region"
                        aria-label="Drag and drop photos here"
                        className="rounded-xl border-2 border-dashed border-white/10 bg-white/[0.02] p-6 text-center"
                      >
                        <ImagePlus
                          className="mx-auto mb-2 h-10 w-10 text-zinc-500"
                          aria-hidden="true"
                        />
                        <p className="text-sm text-zinc-300">Drag photos here, or</p>
                        <Button
                          type="button"
                          variant="outline"
                          className="mx-auto mt-2 min-h-[44px]"
                          onClick={() => {
                            fileInputRef.current?.click();
                          }}
                        >
                          Browse files
                        </Button>
                        <p className="mt-2 text-xs text-zinc-500">
                          JPEG, PNG, or WebP. Maximum 10 photos.
                        </p>
                      </div>
                    ) : (
                      <SortablePhotoGrid
                        photos={photoSlots}
                        onReorder={reorderPhotos}
                        onCropEdit={(idx) => {
                          setEditingIndex(idx);
                        }}
                        onRemove={removePhoto}
                        onAdd={() => {
                          fileInputRef.current?.click();
                        }}
                        maxPhotos={MAX_PHOTOS}
                      />
                    )}

                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ACCEPTED_PHOTO_TYPES.join(',')}
                      className="hidden"
                      onChange={handleFileInput}
                      aria-label="Upload listing photos"
                    />

                    {lowQualityCount > 0 ? (
                      <p
                        role="alert"
                        className="mt-2 text-sm text-amber-400"
                      >
                        Replace {String(lowQualityCount)} low-quality photo
                        {lowQualityCount === 1 ? '' : 's'} before publishing.
                      </p>
                    ) : null}

                    <p className="mt-2 text-xs text-zinc-500">
                      Drag tiles to reorder. The first photo is the cover.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/* Step 3: Pickup */}
            {step === 3 ? (
              <>
                <FormField
                  control={form.control}
                  name="pickupZip"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pickup zip</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="94110"
                        />
                      </FormControl>
                      <FormDescription>
                        Buyers see only the zip until they win.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="pickupAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pickup address (private)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="123 Main St"
                          maxLength={200}
                        />
                      </FormControl>
                      <FormDescription>
                        Shared with the winner only after payment.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}

            {/* Step 4: Auction */}
            {step === 4 ? (
              <>
                <FormField
                  control={form.control}
                  name="startingPriceDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Starting price (USD)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          step="0.01"
                          inputMode="decimal"
                          value={field.value === 0 ? '' : field.value}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            field.onChange(Number.isFinite(v) ? v : 0);
                          }}
                          placeholder="50.00"
                        />
                      </FormControl>
                      <FormDescription>
                        Bids start here and go up. Set lower to attract more bidders.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="auctionDurationHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Auction duration</FormLabel>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {DURATIONS.map((d) => (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => {
                              field.onChange(d.value);
                            }}
                            aria-pressed={field.value === d.value}
                            className={cn(
                              'min-h-[64px] rounded-xl border p-3 text-left transition',
                              field.value === d.value
                                ? 'border-[var(--brand-gold)] bg-[var(--brand-gold)]/10'
                                : 'border-white/10 bg-white/[0.02] hover:border-white/20',
                            )}
                          >
                            <p className="text-sm font-semibold text-zinc-100">{d.label}</p>
                            <p className="text-xs text-zinc-400">{d.sub}</p>
                          </button>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}

            {/* Step 5: Review */}
            {step === 5 ? (
              <div className="space-y-4">
                <ReviewRow label="Category">
                  {GOODS_CATEGORIES.find((c) => c.id === values.categoryId)?.name ?? '—'}
                </ReviewRow>
                <ReviewRow label="Title">{values.title || '—'}</ReviewRow>
                <ReviewRow label="Description">
                  <p className="line-clamp-3 whitespace-pre-wrap text-zinc-300">
                    {values.description || '—'}
                  </p>
                </ReviewRow>
                <ReviewRow label="Photos">{String(values.photoUrls.length)} attached</ReviewRow>
                <ReviewRow label="Pickup">
                  {values.pickupZip}
                  {values.pickupAddress ? ` · ${values.pickupAddress}` : ''}
                </ReviewRow>
                <ReviewRow label="Starting price">
                  {formatCents(Math.round(values.startingPriceDollars * 100))}
                </ReviewRow>
                <ReviewRow label="Duration">
                  {DURATIONS.find((d) => d.value === values.auctionDurationHours)?.label ??
                    `${String(values.auctionDurationHours)}h`}
                </ReviewRow>

                {form.formState.errors.root ? (
                  <p className="text-sm text-red-400" role="alert">
                    {form.formState.errors.root.message}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </Form>

      {/* Step nav */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={goPrev}
          disabled={step === 0}
          className="min-h-[44px]"
        >
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            onClick={() => {
              void goNext();
            }}
            className="min-h-[44px]"
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              void handlePublish();
            }}
            disabled={createListing.isPending}
            className="min-h-[44px] bg-[var(--brand-gold)] text-black hover:bg-[var(--brand-gold)]/90"
          >
            {createListing.isPending ? 'Publishing…' : 'Publish listing'}
          </Button>
        )}
      </div>

      {editingIndex !== null && photoSlots[editingIndex] ? (
        <PhotoCropper
          src={photoSlots[editingIndex].url}
          aspect={4 / 3}
          onSave={(blob) => {
            handleCropSave(blob);
          }}
          onCancel={() => {
            setEditingIndex(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-white/[0.06] pb-3 last:border-b-0 sm:flex-row sm:gap-4">
      <p className="w-32 shrink-0 text-xs font-medium tracking-wide text-zinc-400 uppercase">
        {label}
      </p>
      <div className="text-sm text-zinc-200">{children}</div>
    </div>
  );
}
