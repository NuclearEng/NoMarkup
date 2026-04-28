'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft, ChevronRight, ImagePlus, Sparkles, X } from 'lucide-react';
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
import { Progress } from '@/components/ui/progress';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCreateListing } from '@/hooks/useListings';
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
  1: ['title', 'description'],
  2: ['photoUrls'],
  3: ['pickupZip'],
  4: ['startingPriceDollars', 'auctionDurationHours'],
  5: [],
};

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

export function ListingPostingForm({ onPublishSuccess }: ListingPostingFormProps = {}) {
  const router = useRouter();
  const createListing = useCreateListing();
  const [step, setStep] = useState(0);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [aiState, setAiState] = useState<'idle' | 'analyzing' | 'applied' | 'error'>('idle');
  const [aiSummary, setAiSummary] = useState<ListingImageAnalysisResult | null>(null);
  const aiTriggeredRef = useRef(false);

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
    const acceptedFiles: File[] = [];
    const acceptedUrls: string[] = [];
    for (const f of Array.from(files)) {
      if (!ACCEPTED_PHOTO_TYPES.includes(f.type)) continue;
      // Stub: in production, upload via the imaging engine and use the returned URL.
      // For frontend-only build, we use object URLs as placeholder.
      const url = URL.createObjectURL(f);
      acceptedUrls.push(url);
      acceptedFiles.push(f);
    }
    const wasEmpty = photoUrls.length === 0;
    const nextUrls = [...photoUrls, ...acceptedUrls].slice(0, MAX_PHOTOS);
    const nextFiles = [...photoFiles, ...acceptedFiles].slice(0, MAX_PHOTOS);
    setPhotoUrls(nextUrls);
    setPhotoFiles(nextFiles);
    form.setValue('photoUrls', nextUrls, { shouldValidate: true, shouldDirty: true });

    // Fire AI auto-fill on the very first photo upload (only once per session).
    if (wasEmpty && acceptedFiles.length > 0 && !aiTriggeredRef.current) {
      const firstFile = acceptedFiles[0];
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
    const next = photoUrls.filter((_, i) => i !== idx);
    const nextFiles = photoFiles.filter((_, i) => i !== idx);
    setPhotoUrls(next);
    setPhotoFiles(nextFiles);
    form.setValue('photoUrls', next, { shouldValidate: true, shouldDirty: true });
  }

  async function handlePublish() {
    const ok = await form.trigger();
    if (!ok) return;
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
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept={ACCEPTED_PHOTO_TYPES.join(',')}
                        className="hidden"
                        onChange={handleFileInput}
                        aria-label="Upload listing photos"
                      />
                      <p className="mt-2 text-xs text-zinc-500">
                        JPEG, PNG, or WebP. Maximum 10 photos.
                      </p>
                    </div>

                    {photoUrls.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2 pt-3 sm:grid-cols-4">
                        {photoUrls.map((url, i) => (
                          <div
                            key={`${url}-${String(i)}`}
                            className="relative aspect-square overflow-hidden rounded-md border border-white/10 bg-zinc-900"
                          >
                            <ProgressiveImage
                              src={url}
                              alt={`Photo ${String(i + 1)}`}
                              className="absolute inset-0"
                            />
                            <button
                              type="button"
                              aria-label={`Remove photo ${String(i + 1)}`}
                              onClick={() => {
                                removePhoto(i);
                              }}
                              className="absolute top-1 right-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            {i === 0 ? (
                              <span className="absolute bottom-1 left-1 rounded-full bg-[var(--brand-gold)] px-2 py-0.5 text-[10px] font-semibold text-black">
                                Hero
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
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
