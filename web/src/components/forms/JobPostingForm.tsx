'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { useCreateJob, usePublishJob } from '@/hooks/useJobs';
import { formatCents } from '@/lib/utils';
import { jobPostingSchema, type JobPostingFormValues } from '@/lib/validations';
import type { CreateJobInput, MarketRange } from '@/types';

const STEPS = [
  { title: 'Category', description: 'What type of service do you need?' },
  { title: 'Details', description: 'Describe the job' },
  { title: 'Location', description: 'Where is the work?' },
  { title: 'Schedule', description: 'When do you need it done?' },
  { title: 'Auction', description: 'Set your auction parameters' },
  { title: 'Review', description: 'Review and publish' },
] as const;

// Fields to validate per step (used for partial validation)
const STEP_FIELDS: Record<number, (keyof JobPostingFormValues)[]> = {
  0: ['categoryId'],
  1: ['title', 'description'],
  2: [],
  3: ['scheduleType', 'scheduledDate', 'isRecurring', 'recurrenceFrequency'],
  4: ['auctionDurationHours', 'startingBidDollars', 'offerAcceptedDollars'],
  5: [],
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
    };
  }

  async function handlePublish() {
    const valid = await form.trigger();
    if (!valid) return;

    const values = form.getValues();
    const input = buildCreateInput(values);
    const job = await createJob.mutateAsync(input);
    await publishJob.mutateAsync(job.id);
    router.push('/jobs/mine' as Route);
  }

  async function handleSaveDraft() {
    // For drafts, skip full validation - just require category and title
    const hasCategory = !!form.getValues('categoryId');
    const hasTitle = form.getValues('title').length >= 10;

    if (!hasCategory || !hasTitle) {
      await form.trigger(['categoryId', 'title']);
      return;
    }

    const values = form.getValues();
    const input = buildCreateInput(values);
    await createJob.mutateAsync(input);
    router.push('/jobs/mine' as Route);
  }

  const isPending = createJob.isPending || publishJob.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Post a New Job</h1>
        <p className="text-sm text-muted-foreground">
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
            className={`min-h-[44px] whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
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
            <form onSubmit={(e) => { e.preventDefault(); }} className="space-y-6">
              {step === 0 ? <StepCategory form={form} /> : null}
              {step === 1 ? <StepDetails form={form} /> : null}
              {step === 2 ? <StepLocation form={form} /> : null}
              {step === 3 ? <StepSchedule form={form} /> : null}
              {step === 4 ? <StepAuction form={form} /> : null}
              {step === 5 ? (
                <StepReview form={form} marketRange={EXAMPLE_MARKET_RANGE} />
              ) : null}

              {/* Navigation buttons */}
              <div className="flex gap-3">
                {step > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={goPrev}
                    className="min-h-[44px]"
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                    Previous
                  </Button>
                ) : null}

                {step < STEPS.length - 1 ? (
                  <Button
                    type="button"
                    onClick={() => void goNext()}
                    className="min-h-[44px]"
                  >
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
                onChange={(ids) => { field.onChange(ids[0] ?? ''); }}
              />
            </FormControl>
            <FormMessage />
            {categoryId ? (
              <p className="text-sm text-muted-foreground">
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

      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
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
              <Checkbox
                checked={field.value}
                onCheckedChange={field.onChange}
              />
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

// -- Step 5: Auction --
function StepAuction({ form }: { form: FormType }) {
  const durationHours = form.watch('auctionDurationHours');

  return (
    <div className="space-y-6">
      <FormField
        control={form.control}
        name="startingBidDollars"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Starting Bid (optional)</FormLabel>
            <FormControl>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
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
              Set a suggested starting price for bids. Leave blank to let providers set their own price.
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
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
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
              Auction Duration: {String(durationHours)} hour{durationHours !== 1 ? 's' : ''}{' '}
              ({String(Math.floor(durationHours / 24))} day{Math.floor(durationHours / 24) !== 1 ? 's' : ''}{' '}
              {String(durationHours % 24)}h)
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
            <div className="flex justify-between text-xs text-muted-foreground">
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

// -- Step 6: Review --
function StepReview({
  form,
  marketRange,
}: {
  form: FormType;
  marketRange: MarketRange;
}) {
  const values = form.getValues();

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-md border p-4">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Title</h3>
          <p className="text-base font-semibold">{values.title}</p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Description</h3>
          <p className="whitespace-pre-wrap text-sm">{values.description}</p>
        </div>

        {values.locationAddress ? (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Location</h3>
            <p className="text-sm">{values.locationAddress}</p>
          </div>
        ) : null}

        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Schedule</h3>
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
              <Badge variant="secondary">
                Recurring: {values.recurrenceFrequency}
              </Badge>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Auction Settings</h3>
          <div className="mt-1 space-y-1 text-sm">
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
              <p>
                Instant accept:{' '}
                {formatCents(Math.round(values.offerAcceptedDollars * 100))}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Market range display */}
      {marketRange.sample_size > 0 ? (
        <MarketRangeDisplay marketRange={marketRange} />
      ) : null}
    </div>
  );
}
