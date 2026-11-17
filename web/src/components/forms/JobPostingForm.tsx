'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import type { JobFormType } from '@/components/forms/job-posting/types';
import { CategorySelector } from '@/components/providers/CategorySelector';
import { Button } from '@/components/ui/button';
import { ChunkPlaceholder } from '@/components/ui/chunk-placeholder';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Progress } from '@/components/ui/progress';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useCreateJob } from '@/hooks/useJobs';
import { api } from '@/lib/api';
import { jobPostingSchema, type JobPostingFormValues } from '@/lib/schemas/jobs';
import {
  AUCTION_TYPE,
  UPLOAD_CONTEXT,
  type CreateJobInput,
  type SubmitAnswerInput,
} from '@/types';

// Steps 2–7 are not on screen when the wizard opens, so each one's code (and
// what only it uses: the property select, the slider, the market-range
// tooltip, the pre-quote questions) loads with the step, not with the page.
// The loader for the step after the current one is started as soon as a step
// is shown, so in practice "Next" finds the code already there; the
// placeholder covers a slow connection and reserves the step's height.
const STEP_LOADERS = {
  1: () => import('@/components/forms/job-posting/StepDetails').then((m) => m.StepDetails),
  2: () => import('@/components/forms/job-posting/StepLocation').then((m) => m.StepLocation),
  3: () => import('@/components/forms/job-posting/StepSchedule').then((m) => m.StepSchedule),
  4: () => import('@/components/forms/job-posting/StepPhotos').then((m) => m.StepPhotos),
  5: () => import('@/components/forms/job-posting/StepAuction').then((m) => m.StepAuction),
  6: () => import('@/components/forms/job-posting/StepReview').then((m) => m.StepReview),
} as const;

function StepLoading() {
  return <ChunkPlaceholder label="Loading this step…" className="min-h-[320px]" />;
}

const StepDetails = dynamic(STEP_LOADERS[1], { loading: StepLoading });
const StepLocation = dynamic(STEP_LOADERS[2], { loading: StepLoading });
const StepSchedule = dynamic(STEP_LOADERS[3], { loading: StepLoading });
const StepPhotos = dynamic(STEP_LOADERS[4], { loading: StepLoading });
const StepAuction = dynamic(STEP_LOADERS[5], { loading: StepLoading });
const StepReview = dynamic(STEP_LOADERS[6], { loading: StepLoading });

/** Start fetching the code for `step` (no-op for step 0 and past the end). */
function preloadStep(step: number): void {
  const load = (STEP_LOADERS as Record<number, (() => Promise<unknown>) | undefined>)[step];
  // A failed preload is not an error: the step's own dynamic() load retries.
  if (load) void load().catch(() => undefined);
}

const STEPS = [
  { title: 'Category', description: 'What type of service do you need?' },
  { title: 'Details', description: 'Describe the job' },
  { title: 'Location', description: 'Where is the work?' },
  { title: 'Schedule', description: 'When do you need it done?' },
  { title: 'Photos', description: 'Add photos of the job' },
  { title: 'Auction', description: 'Set your auction parameters' },
  { title: 'Review', description: 'Review and publish' },
] as const;



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

export function JobPostingForm() {
  const [step, setStep] = useState(0);
  // Fetch the next step's code while the seller fills in this one.
  useEffect(() => {
    preloadStep(step + 1);
  }, [step]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const photoUpload = useImageUpload({ context: UPLOAD_CONTEXT.JOB_PHOTO });
  const [useInstantMatch, setUseInstantMatch] = useState(false);
  // Wave 5 services-polish state — kept outside react-hook-form because
  // these fields aren't covered by jobPostingSchema (Zod schema lives
  // in lib/validations.ts which isn't owned by this wave). The handler
  // serializes them onto CreateJobInput at publish time.
  const [isHourly, setIsHourly] = useState(false);
  const [hourlyRateDollars, setHourlyRateDollars] = useState<number | undefined>(undefined);
  const [sameDayRequested, setSameDayRequested] = useState(false);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, SubmitAnswerInput>>({});
  const router = useRouter();
  const searchParams = useSearchParams();
  // Allow deep-linking a pre-selected category, e.g. the /legal vertical's
  // "Post a legal job" CTA passes ?category_id=<legal subtree id>. Empty when
  // absent, so the normal blank flow is unchanged.
  // FR-18.7 residual: recurring cancel CTA can also pass title / is_recurring /
  // recurrence_frequency / description so remaining visits can be re-auctioned.
  const presetCategoryId = searchParams.get('category_id') ?? '';
  const presetTitle = (searchParams.get('title') ?? '').trim().slice(0, 200);
  const presetDescription = (searchParams.get('description') ?? '').trim().slice(0, 5000);
  const presetIsRecurring =
    searchParams.get('is_recurring') === 'true' || searchParams.get('is_recurring') === '1';
  const rawFreq = (searchParams.get('recurrence_frequency') ?? '').trim().toLowerCase();
  const presetFrequency =
    rawFreq === 'weekly' ||
    rawFreq === 'biweekly' ||
    rawFreq === 'monthly' ||
    rawFreq === 'quarterly'
      ? (rawFreq as JobPostingFormValues['recurrenceFrequency'])
      : undefined;
  // FR-18.7 deepen: optional property + starting bid from recurring cancel CTA.
  const presetPropertyId = (searchParams.get('property_id') ?? '').trim();
  const [selectedPropertyId, setSelectedPropertyId] = useState(presetPropertyId);
  const rawStartingBidCents = (searchParams.get('starting_bid_cents') ?? '').trim();
  const parsedStartingBidCents = Number(rawStartingBidCents);
  const presetStartingBidDollars =
    Number.isFinite(parsedStartingBidCents) && parsedStartingBidCents > 0
      ? Math.round(parsedStartingBidCents) / 100
      : undefined;
  const createJob = useCreateJob();

  const form = useForm<JobPostingFormValues>({
    resolver: zodResolver(jobPostingSchema),
    defaultValues: {
      categoryId: presetCategoryId,
      title: presetTitle,
      description: presetDescription,
      scheduleType: 'flexible',
      scheduledDate: '',
      isRecurring: presetIsRecurring,
      recurrenceFrequency: presetIsRecurring ? presetFrequency : undefined,
      locationAddress: '',
      locationLat: undefined,
      locationLng: undefined,
      startingBidDollars: presetStartingBidDollars,
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
      property_id: selectedPropertyId || undefined,
      starting_bid_cents: values.startingBidDollars
        ? Math.round(values.startingBidDollars * 100)
        : undefined,
      offer_accepted_cents: values.offerAcceptedDollars
        ? Math.round(values.offerAcceptedDollars * 100)
        : undefined,
      auction_duration_hours: values.auctionDurationHours,
      auction_type: values.auctionType,
      photo_urls: values.photoUrls && values.photoUrls.length > 0 ? values.photoUrls : undefined,
      // Wave 5 services-polish (Section H) — hourly billing + same-day SLA.
      is_hourly: isHourly || undefined,
      hourly_rate_cents:
        isHourly && hourlyRateDollars
          ? Math.round(hourlyRateDollars * 100)
          : undefined,
      same_day_requested: sameDayRequested || undefined,
    };
  }

  async function uploadedJobPhotoUrls(): Promise<string[] | null> {
    if (photos.length === 0) return [];
    const urls: string[] = [];
    for (const file of photos) {
      const outcome = await photoUpload.upload(file);
      if (!outcome.ok) {
        form.setError('root', { message: `Couldn't upload a photo: ${outcome.error}` });
        return null;
      }
      urls.push(outcome.result.confirmedUrl);
    }
    return urls;
  }

  async function handlePublish() {
    const valid = await form.trigger();
    if (!valid) return;

    setUploadingPhotos(true);
    try {
      const photoUrls = await uploadedJobPhotoUrls();
      if (photoUrls === null) return;
      const values = form.getValues();
      const input = buildCreateInput(values);
      if (photoUrls.length > 0) input.photo_urls = photoUrls;
      input.publish = true;
      const createdJob = await createJob.mutateAsync(input);

      if (useInstantMatch && createdJob.id) {
        // Call instant match directly using the new job ID (avoids stale closure).
        try {
          await api.post<{ status: string; expires_at: string }>(`/api/v1/jobs/${createdJob.id}/instant-match`);
        } catch {
          // Non-fatal — job was created, instant match just didn't fire.
        }
      }

      // Best-effort post the customer's pre-quote answers. Non-fatal:
      // the job is created; missing answers just mean providers will
      // chat-clarify scope (which is the pre-Wave-5 status quo).
      const answersList = Object.values(questionAnswers);
      if (createdJob.id && answersList.length > 0) {
        try {
          await api.post<{ saved: number }>(`/api/v1/jobs/${createdJob.id}/answers`, {
            answers: answersList,
          });
        } catch {
          // swallow
        }
      }

      router.push('/jobs/mine' as Route);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish job';
      form.setError('root', { message });
    } finally {
      setUploadingPhotos(false);
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

    setUploadingPhotos(true);
    try {
      const photoUrls = await uploadedJobPhotoUrls();
      if (photoUrls === null) return;
      const values = form.getValues();
      const input = buildCreateInput(values);
      if (photoUrls.length > 0) input.photo_urls = photoUrls;
      await createJob.mutateAsync(input);
      router.push('/jobs/mine' as Route);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save draft';
      form.setError('root', { message });
    } finally {
      setUploadingPhotos(false);
    }
  }

  const isPending = createJob.isPending || uploadingPhotos;

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
              {step === 1 ? (
                <StepDetails
                  form={form}
                  questionAnswers={questionAnswers}
                  onQuestionAnswersChange={setQuestionAnswers}
                />
              ) : null}
              {step === 2 ? (
                <StepLocation
                  form={form}
                  selectedPropertyId={selectedPropertyId}
                  onPropertyChange={setSelectedPropertyId}
                />
              ) : null}
              {step === 3 ? (
                <StepSchedule
                  form={form}
                  sameDayRequested={sameDayRequested}
                  onSameDayChange={setSameDayRequested}
                />
              ) : null}
              {step === 4 ? <StepPhotos photos={photos} onPhotosChange={setPhotos} /> : null}
              {step === 5 ? (
                <StepAuction
                  form={form}
                  isHourly={isHourly}
                  onIsHourlyChange={setIsHourly}
                  hourlyRateDollars={hourlyRateDollars}
                  onHourlyRateChange={setHourlyRateDollars}
                />
              ) : null}
              {step === 6 ? (
                <StepReview
                  form={form}
                  photoCount={photos.length}
                  useInstantMatch={useInstantMatch}
                  onInstantMatchChange={setUseInstantMatch}
                  isHourly={isHourly}
                  hourlyRateDollars={hourlyRateDollars}
                  sameDayRequested={sameDayRequested}
                  questionAnswerCount={Object.keys(questionAnswers).length}
                />
              ) : null}

              {form.formState.errors.root ? (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive"
                >
                  {form.formState.errors.root.message}
                </div>
              ) : null}

              {/* Navigation buttons */}
              <div className="flex flex-wrap gap-3">
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
                      variant="default"
                      onClick={() => void handlePublish()}
                      disabled={isPending}
                      className="min-h-[44px]"
                    >
                      {uploadingPhotos ? 'Uploading photos…' : isPending ? 'Publishing...' : 'Publish Job'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleSaveDraft()}
                      disabled={isPending}
                      className="min-h-[44px]"
                    >
                      {uploadingPhotos ? 'Uploading photos…' : createJob.isPending ? 'Saving...' : 'Save as Draft'}
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
function StepCategory({ form }: { form: JobFormType }) {
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
