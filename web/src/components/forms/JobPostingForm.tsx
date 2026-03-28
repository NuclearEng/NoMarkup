'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft, ChevronRight, ImagePlus, X } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, type DragEvent } from 'react';
import { useForm } from 'react-hook-form';

import { MarketRangeDisplay } from '@/components/jobs/MarketRangeDisplay';
import { CategorySelector } from '@/components/providers/CategorySelector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { ENABLE_LIVE_AUCTION } from '@/lib/constants';
import { useCreateJob, usePublishJob } from '@/hooks/useJobs';
import { formatCents } from '@/lib/utils';
import { jobPostingSchema, type JobPostingFormValues } from '@/lib/validations';
import { AUCTION_TYPE, type CreateJobInput, type MarketRange } from '@/types';

const STEPS = [
  { title: 'Category', description: 'What type of service do you need?' },
  { title: 'Details', description: 'Describe the job' },
  { title: 'Location', description: 'Where is the work?' },
  { title: 'Schedule', description: 'When do you need it done?' },
  { title: 'Photos', description: 'Add photos of the job' },
  { title: 'Auction', description: 'Set your auction parameters' },
  { title: 'Review', description: 'Review and publish' },
] as const;

const MAX_PHOTOS = 10;
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Fields to validate per step (used for partial validation)
const STEP_FIELDS: Record<number, (keyof JobPostingFormValues)[]> = {
  0: ['categoryId'],
  1: ['title', 'description'],
  2: [],
  3: ['scheduleType', 'scheduledDate', 'isRecurring', 'recurrenceFrequency'],
  4: [], // Photos — validated via local state, not Zod
  5: ['auctionDurationHours', 'startingBidDollars', 'offerAcceptedDollars'],
  6: [],
};

// Example market range for the review step (would come from API in production)
const EXAMPLE_MARKET_RANGE: MarketRange = {
  low_cents: 5000,
  median_cents: 12500,
  high_cents: 25000,
  sample_size: 0,
};

export function JobPostingForm() {
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<File[]>([]);
  const router = useRouter();
  const createJob = useCreateJob();
  const publishJob = usePublishJob();

  const form = useForm<JobPostingFormValues>({
    resolver: zodResolver(jobPostingSchema),
    defaultValues: {
      categoryId: '',
      title: '',
      description: '',
      scheduleType: 'flexible',
      scheduledDate: '',
      isRecurring: false,
      recurrenceFrequency: undefined,
      locationAddress: '',
      locationLat: undefined,
      locationLng: undefined,
      startingBidDollars: undefined,
      offerAcceptedDollars: undefined,
      auctionDurationHours: 72,
      auctionType: AUCTION_TYPE.SEALED,
      photoUrls: [],
    },
    mode: 'onTouched',
  });

  const progress = ((step + 1) / STEPS.length) * 100;
  const currentStep = STEPS[step];

  async function validateCurrentStep(): Promise<boolean> {
    const fields = STEP_FIELDS[step];
    if (!fields || fields.length === 0) return true;
    const result = await form.trigger(fields);
    return result;
  }

  async function goNext() {
    const valid = await validateCurrentStep();
    if (!valid) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  }

  function goPrev() {
    if (step > 0) {
      setStep(step - 1);
    }
  }

  function buildCreateInput(values: JobPostingFormValues): CreateJobInput {
    return {
      category_id: values.categoryId,
      title: values.title,
      description: values.description,
      schedule_type: values.scheduleType,
      scheduled_date: values.scheduledDate || undefined,
      is_recurring: values.isRecurring,
      recurrence_frequency: values.recurrenceFrequency,
      location_address: values.locationAddress || undefined,
      location_lat: values.locationLat,
      location_lng: values.locationLng,
      starting_bid_cents: values.startingBidDollars
        ? Math.round(values.startingBidDollars * 100)
        : undefined,
      offer_accepted_cents: values.offerAcceptedDollars
        ? Math.round(values.offerAcceptedDollars * 100)
        : undefined,
      auction_duration_hours: values.auctionDurationHours,
      auction_type: values.auctionType,
      photo_urls: values.photoUrls && values.photoUrls.length > 0 ? values.photoUrls : undefined,
    };
  }

  async function handlePublish() {
    const valid = await form.trigger();
    if (!valid) return;

    try {
      const values = form.getValues();
      const input = buildCreateInput(values);
      const job = await createJob.mutateAsync(input);
      if (!job?.id) throw new Error('Job creation returned no data');
      await publishJob.mutateAsync(job.id);
      router.push('/jobs/mine' as Route);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish job';
      form.setError('root', { message });
    }
  }

  async function handleSaveDraft() {
    // For drafts, skip full validation - just require category and title
    const hasCategory = !!form.getValues('categoryId');
    const hasTitle = form.getValues('title').length >= 10;

    if (!hasCategory || !hasTitle) {
      await form.trigger(['categoryId', 'title']);
      return;
    }

    try {
      const values = form.getValues();
      const input = buildCreateInput(values);
      await createJob.mutateAsync(input);
      router.push('/jobs/mine' as Route);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save draft';
      form.setError('root', { message });
    }
  }

  const isPending = createJob.isPending || publishJob.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Post a New Job</h1>
        <p className="text-muted-foreground text-sm">
          Step {String(step + 1)} of {String(STEPS.length)}
        </p>
      </div>

      <Progress value={progress} className="h-2" aria-label="Job posting progress" />

      {/* Step indicators */}
      <nav aria-label="Job posting steps" className="flex gap-2 overflow-x-auto pb-2">
        {STEPS.map((s, idx) => (
          <button
            key={s.title}
            type="button"
            onClick={() => {
              if (idx < step) setStep(idx);
            }}
            disabled={idx > step}
            className={`min-h-[44px] rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap ${
              idx === step
                ? 'bg-primary text-primary-foreground'
                : idx < step
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground'
            }`}
            aria-current={idx === step ? 'step' : undefined}
          >
            {s.title}
          </button>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>{currentStep?.title}</CardTitle>
          <CardDescription>{currentStep?.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
              }}
              className="space-y-6"
            >
              {step === 0 ? <StepCategory form={form} /> : null}
              {step === 1 ? <StepDetails form={form} /> : null}
              {step === 2 ? <StepLocation form={form} /> : null}
              {step === 3 ? <StepSchedule form={form} /> : null}
              {step === 4 ? <StepPhotos photos={photos} onPhotosChange={setPhotos} /> : null}
              {step === 5 ? <StepAuction form={form} /> : null}
              {step === 6 ? (
                <StepReview
                  form={form}
                  marketRange={EXAMPLE_MARKET_RANGE}
                  photoCount={photos.length}
                />
              ) : null}

              {/* Navigation buttons */}
              <div className="flex gap-3">
                {step > 0 ? (
                  <Button type="button" variant="outline" onClick={goPrev} className="min-h-[44px]">
                    <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                    Previous
                  </Button>
                ) : null}

                {step < STEPS.length - 1 ? (
                  <Button type="button" onClick={() => void goNext()} className="min-h-[44px]">
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : null}

                {step === STEPS.length - 1 ? (
                  <>
                    <Button
                      type="button"
                      onClick={() => void handlePublish()}
                      disabled={isPending}
                      className="min-h-[44px]"
                    >
                      {isPending ? 'Publishing...' : 'Publish Job'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleSaveDraft()}
                      disabled={isPending}
                      className="min-h-[44px]"
                    >
                      {isPending ? 'Saving...' : 'Save as Draft'}
                    </Button>
                  </>
                ) : null}
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

// -- Step 1: Category --
type FormType = ReturnType<typeof useForm<JobPostingFormValues>>;

function StepCategory({ form }: { form: FormType }) {
  const categoryId = form.watch('categoryId');

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="categoryId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Service Category</FormLabel>
            <FormControl>
              <CategorySelector
                selected={field.value ? [field.value] : []}
                onChange={(ids) => {
                  field.onChange(ids[0] ?? '');
                }}
              />
            </FormControl>
            <FormMessage />
            {categoryId ? (
              <p className="text-muted-foreground text-sm">
                Category selected. Click Next to continue.
              </p>
            ) : null}
          </FormItem>
        )}
      />
    </div>
  );
}

// -- Step 2: Details --
function StepDetails({ form }: { form: FormType }) {
  return (
    <div className="space-y-6">
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Job Title</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="e.g., Kitchen sink repair and replacement"
                maxLength={200}
                className="min-h-[44px]"
              />
            </FormControl>
            <FormDescription>
              {String(field.value.length)}/200 characters (minimum 10)
            </FormDescription>
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
                maxLength={5000}
                placeholder="Describe the work you need done in detail. Include any specific requirements, materials needed, or preferences..."
              />
            </FormControl>
            <FormDescription>
              {String(field.value.length)}/5000 characters (minimum 50)
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

// -- Step 3: Location --
function StepLocation({ form }: { form: FormType }) {
  return (
    <div className="space-y-6">
      <FormField
        control={form.control}
        name="locationAddress"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Service Address</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="123 Main St, City, State, ZIP"
                className="min-h-[44px]"
              />
            </FormControl>
            <FormDescription>
              Where should the service provider come? Leave blank for remote work.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="text-muted-foreground rounded-md border p-8 text-center text-sm">
        Map preview will appear here based on the address entered
      </div>
    </div>
  );
}

// -- Step 4: Schedule --
function StepSchedule({ form }: { form: FormType }) {
  const scheduleType = form.watch('scheduleType');
  const isRecurring = form.watch('isRecurring');

  return (
    <div className="space-y-6">
      <FormField
        control={form.control}
        name="scheduleType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Schedule Type</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder="Select schedule type" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="specific_date">Specific Date</SelectItem>
                <SelectItem value="date_range">Date Range</SelectItem>
                <SelectItem value="flexible">Flexible</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {scheduleType === 'specific_date' ? (
        <FormField
          control={form.control}
          name="scheduledDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Preferred Date</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="date"
                  min={new Date().toISOString().split('T')[0]}
                  className="min-h-[44px]"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      <FormField
        control={form.control}
        name="isRecurring"
        render={({ field }) => (
          <FormItem className="flex min-h-[44px] items-center gap-3">
            <FormControl>
              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormLabel className="cursor-pointer">This is a recurring job</FormLabel>
            <FormMessage />
          </FormItem>
        )}
      />

      {isRecurring ? (
        <FormField
          control={form.control}
          name="recurrenceFrequency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Recurrence Frequency</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? ''}>
                <FormControl>
                  <SelectTrigger className="min-h-[44px]">
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  );
}

// -- Step 5: Photos --
interface StepPhotosProps {
  photos: File[];
  onPhotosChange: (photos: File[]) => void;
}

function StepPhotos({ photos, onPhotosChange }: StepPhotosProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files).filter((f) => ACCEPTED_PHOTO_TYPES.includes(f.type));
      const slotsRemaining = MAX_PHOTOS - photos.length;
      if (slotsRemaining <= 0) return;
      const toAdd = incoming.slice(0, slotsRemaining);
      onPhotosChange([...photos, ...toAdd]);
    },
    [photos, onPhotosChange],
  );

  const removePhoto = useCallback(
    (index: number) => {
      onPhotosChange(photos.filter((_, i) => i !== index));
    },
    [photos, onPhotosChange],
  );

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [addFiles],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drag photos here or click to browse"
        className={`focus-visible:ring-ring flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'
        } ${photos.length >= MAX_PHOTOS ? 'pointer-events-none opacity-50' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={openFilePicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFilePicker();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          multiple
          className="sr-only"
          onChange={handleInputChange}
          aria-hidden="true"
          tabIndex={-1}
        />
        <ImagePlus className="text-muted-foreground mb-2 h-8 w-8" aria-hidden="true" />
        <p className="text-muted-foreground text-sm font-medium">
          Drag photos here or click to browse
        </p>
        <p className="text-muted-foreground/70 mt-1 text-xs">Up to 10 photos (JPG, PNG, WebP)</p>
      </div>

      {/* Photo count */}
      {photos.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {String(photos.length)} of {String(MAX_PHOTOS)} photos selected
        </p>
      ) : null}

      {/* Preview thumbnails */}
      {photos.length > 0 ? (
        <div className="grid grid-cols-5 gap-3">
          {photos.map((file, index) => (
            <div
              key={`${file.name}-${String(file.lastModified)}-${String(index)}`}
              className="group bg-muted relative aspect-square overflow-hidden rounded-md border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={URL.createObjectURL(file)}
                alt={file.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  removePhoto(index);
                }}
                className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// -- Step 6: Auction --
function StepAuction({ form }: { form: FormType }) {
  const durationHours = form.watch('auctionDurationHours');

  return (
    <div className="space-y-6">
      {ENABLE_LIVE_AUCTION ? (
        <div className="space-y-2">
          <p className="text-sm font-medium" id="auction-type-label">
            Auction Type
          </p>
          <div className="flex gap-4" role="radiogroup" aria-labelledby="auction-type-label">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value={AUCTION_TYPE.SEALED}
                {...form.register('auctionType')}
                defaultChecked
                className="h-4 w-4"
              />
              <span className="text-sm">Sealed Bid</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value={AUCTION_TYPE.LIVE}
                {...form.register('auctionType')}
                className="h-4 w-4"
              />
              <span className="text-sm">Live Auction</span>
            </label>
          </div>
          <p className="text-muted-foreground text-xs">
            Live auctions show real-time price drops. Sealed bids are hidden until you choose a
            winner.
          </p>
        </div>
      ) : null}

      <FormField
        control={form.control}
        name="startingBidDollars"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Starting Bid (optional)</FormLabel>
            <FormControl>
              <div className="relative">
                <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2">
                  $
                </span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : undefined;
                    field.onChange(val);
                  }}
                  className="min-h-[44px] pl-8"
                />
              </div>
            </FormControl>
            <FormDescription>
              Set a suggested starting price for bids. Leave blank to let providers set their own
              price.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="offerAcceptedDollars"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Instant Accept Price (optional)</FormLabel>
            <FormControl>
              <div className="relative">
                <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2">
                  $
                </span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : undefined;
                    field.onChange(val);
                  }}
                  className="min-h-[44px] pl-8"
                />
              </div>
            </FormControl>
            <FormDescription>
              If a provider bids at or below this price, their bid is automatically accepted.
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
            <FormLabel>
              Auction Duration: {String(durationHours)} hour{durationHours !== 1 ? 's' : ''} (
              {String(Math.floor(durationHours / 24))} day
              {Math.floor(durationHours / 24) !== 1 ? 's' : ''} {String(durationHours % 24)}h)
            </FormLabel>
            <FormControl>
              <Slider
                min={24}
                max={168}
                step={1}
                value={[field.value]}
                onValueChange={(values) => {
                  const val = values[0];
                  if (val !== undefined) {
                    field.onChange(val);
                  }
                }}
                className="min-h-[44px]"
                aria-label={`Auction duration: ${String(durationHours)} hours`}
              />
            </FormControl>
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>24h (1 day)</span>
              <span>168h (7 days)</span>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

// -- Step 7: Review --
function StepReview({
  form,
  marketRange,
  photoCount,
}: {
  form: FormType;
  marketRange: MarketRange;
  photoCount: number;
}) {
  const values = form.getValues();

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-md border p-4">
        <div>
          <h3 className="text-muted-foreground text-sm font-medium">Title</h3>
          <p className="text-base font-semibold">{values.title}</p>
        </div>

        <div>
          <h3 className="text-muted-foreground text-sm font-medium">Description</h3>
          <p className="text-sm whitespace-pre-wrap">{values.description}</p>
        </div>

        {values.locationAddress ? (
          <div>
            <h3 className="text-muted-foreground text-sm font-medium">Location</h3>
            <p className="text-sm">{values.locationAddress}</p>
          </div>
        ) : null}

        <div>
          <h3 className="text-muted-foreground text-sm font-medium">Schedule</h3>
          <div className="flex gap-2">
            <Badge variant="outline">
              {values.scheduleType === 'specific_date'
                ? 'Specific Date'
                : values.scheduleType === 'date_range'
                  ? 'Date Range'
                  : 'Flexible'}
            </Badge>
            {values.scheduledDate ? (
              <Badge variant="secondary">
                {new Date(values.scheduledDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Badge>
            ) : null}
            {values.isRecurring && values.recurrenceFrequency ? (
              <Badge variant="secondary">Recurring: {values.recurrenceFrequency}</Badge>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="text-muted-foreground text-sm font-medium">Photos</h3>
          <p className="text-sm">
            {photoCount > 0
              ? `${String(photoCount)} photo${photoCount !== 1 ? 's' : ''} attached`
              : 'No photos attached'}
          </p>
        </div>

        <div>
          <h3 className="text-muted-foreground text-sm font-medium">Auction Settings</h3>
          <div className="mt-1 space-y-1 text-sm">
            {ENABLE_LIVE_AUCTION && values.auctionType ? (
              <p>Type: {values.auctionType === 'live' ? 'Live Auction' : 'Sealed Bid'}</p>
            ) : null}
            <p>
              Duration: {String(values.auctionDurationHours)} hours (
              {String(Math.floor(values.auctionDurationHours / 24))} days{' '}
              {String(values.auctionDurationHours % 24)}h)
            </p>
            {values.startingBidDollars ? (
              <p>Starting bid: {formatCents(Math.round(values.startingBidDollars * 100))}</p>
            ) : (
              <p>Starting bid: Open</p>
            )}
            {values.offerAcceptedDollars ? (
              <p>Instant accept: {formatCents(Math.round(values.offerAcceptedDollars * 100))}</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Market range display */}
      {marketRange.sample_size > 0 ? <MarketRangeDisplay marketRange={marketRange} /> : null}
    </div>
  );
}
