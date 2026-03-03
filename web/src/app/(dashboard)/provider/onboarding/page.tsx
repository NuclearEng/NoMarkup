'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';

import { CategorySelector } from '@/components/providers/CategorySelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
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
import { Textarea } from '@/components/ui/textarea';
import {
  useUpdateCategories,
  useUpdatePortfolio,
  useUpdateProviderProfile,
  useSetGlobalTerms,
} from '@/hooks/useProviderProfile';
import {
  businessInfoSchema,
  globalTermsSchema,
  type BusinessInfoFormValues,
  type GlobalTermsFormValues,
} from '@/lib/validations';

const STEPS = [
  { title: 'Business Info', description: 'Tell us about your business' },
  { title: 'Categories', description: 'What services do you offer?' },
  { title: 'Service Area', description: 'Where do you work?' },
  { title: 'Terms', description: 'Set your default terms' },
  { title: 'Portfolio', description: 'Showcase your work' },
] as const;

export default function ProviderOnboardingPage() {
  const [step, setStep] = useState(0);
  const router = useRouter();

  const progress = ((step + 1) / STEPS.length) * 100;

  function goNext() {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      router.push('/provider' as Route);
    }
  }

  function goPrev() {
    if (step > 0) {
      setStep(step - 1);
    }
  }

  const currentStep = STEPS[step];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Provider Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Step {String(step + 1)} of {String(STEPS.length)}
        </p>
      </div>

      <Progress value={progress} className="h-2" aria-label="Onboarding progress" />

      {/* Step indicators */}
      <nav aria-label="Onboarding steps" className="flex gap-2 overflow-x-auto pb-2">
        {STEPS.map((s, idx) => (
          <button
            key={s.title}
            type="button"
            onClick={() => { setStep(idx); }}
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
          {step === 0 ? <BusinessInfoStep onNext={goNext} /> : null}
          {step === 1 ? <CategoriesStep onNext={goNext} onPrev={goPrev} /> : null}
          {step === 2 ? <ServiceAreaStep onNext={goNext} onPrev={goPrev} /> : null}
          {step === 3 ? <GlobalTermsStep onNext={goNext} onPrev={goPrev} /> : null}
          {step === 4 ? <PortfolioStep onNext={goNext} onPrev={goPrev} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

// -- Step 1: Business Info --
function BusinessInfoStep({ onNext }: { onNext: () => void }) {
  const updateProvider = useUpdateProviderProfile();

  const form = useForm<BusinessInfoFormValues>({
    resolver: zodResolver(businessInfoSchema),
    defaultValues: { businessName: '', bio: '', serviceAddress: '' },
  });

  async function onSubmit(values: BusinessInfoFormValues) {
    await updateProvider.mutateAsync({
      business_name: values.businessName,
      bio: values.bio || undefined,
      service_address: values.serviceAddress || undefined,
    });
    onNext();
  }

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6">
        <FormField
          control={form.control}
          name="businessName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Business Name</FormLabel>
              <FormControl>
                <Input {...field} className="min-h-[44px]" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="bio"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bio</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  maxLength={500}
                  rows={4}
                  placeholder="Tell customers about your business..."
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                {String(field.value?.length ?? 0)}/500 characters
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="serviceAddress"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Service Address</FormLabel>
              <FormControl>
                <Input {...field} placeholder="123 Main St, City, State" className="min-h-[44px]" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-3">
          <Button type="submit" disabled={updateProvider.isPending} className="min-h-[44px]">
            {updateProvider.isPending ? 'Saving...' : 'Next'}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// -- Step 2: Categories --
function CategoriesStep({ onNext, onPrev }: { onNext: () => void; onPrev: () => void }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const updateCategories = useUpdateCategories();

  async function handleSave() {
    if (selectedIds.length > 0) {
      await updateCategories.mutateAsync(selectedIds);
    }
    onNext();
  }

  return (
    <div className="space-y-6">
      <CategorySelector selected={selectedIds} onChange={setSelectedIds} />

      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onPrev} className="min-h-[44px]">
          Previous
        </Button>
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={updateCategories.isPending}
          className="min-h-[44px]"
        >
          {updateCategories.isPending ? 'Saving...' : 'Next'}
        </Button>
        <Button type="button" variant="ghost" onClick={onNext} className="min-h-[44px]">
          Skip
        </Button>
      </div>
    </div>
  );
}

// -- Step 3: Service Area --
function ServiceAreaStep({ onNext, onPrev }: { onNext: () => void; onPrev: () => void }) {
  const [radius, setRadius] = useState(25);
  const updateProvider = useUpdateProviderProfile();

  async function handleSave() {
    await updateProvider.mutateAsync({ service_radius_km: radius });
    onNext();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="radius-input" className="text-sm font-medium">
          Service Radius: {String(radius)} km
        </label>
        <input
          id="radius-input"
          type="range"
          min={5}
          max={100}
          step={5}
          value={radius}
          onChange={(e) => { setRadius(Number(e.target.value)); }}
          className="w-full accent-primary"
          aria-label={`Service radius: ${String(radius)} kilometers`}
          style={{ minHeight: '44px' }}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>5 km</span>
          <span>100 km</span>
        </div>
      </div>

      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        Map placeholder - service area visualization will appear here
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onPrev} className="min-h-[44px]">
          Previous
        </Button>
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={updateProvider.isPending}
          className="min-h-[44px]"
        >
          {updateProvider.isPending ? 'Saving...' : 'Next'}
        </Button>
        <Button type="button" variant="ghost" onClick={onNext} className="min-h-[44px]">
          Skip
        </Button>
      </div>
    </div>
  );
}

// -- Step 4: Global Terms --
function GlobalTermsStep({ onNext, onPrev }: { onNext: () => void; onPrev: () => void }) {
  const setGlobalTerms = useSetGlobalTerms();

  const form = useForm<GlobalTermsFormValues>({
    resolver: zodResolver(globalTermsSchema),
    defaultValues: {
      paymentTiming: 'completion',
      milestones: [],
      cancellationPolicy: '',
      warrantyTerms: '',
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'milestones',
  });

  const paymentTiming = form.watch('paymentTiming');

  async function onSubmit(values: GlobalTermsFormValues) {
    await setGlobalTerms.mutateAsync({
      payment_timing: values.paymentTiming,
      milestones: values.milestones ?? [],
      cancellation_policy: values.cancellationPolicy ?? '',
      warranty_terms: values.warrantyTerms ?? '',
    });
    onNext();
  }

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6">
        <FormField
          control={form.control}
          name="paymentTiming"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Default Payment Timing</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="min-h-[44px]">
                    <SelectValue placeholder="Select timing" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="upfront">Upfront</SelectItem>
                  <SelectItem value="milestone">Milestone</SelectItem>
                  <SelectItem value="completion">On Completion</SelectItem>
                  <SelectItem value="payment_plan">Payment Plan</SelectItem>
                  <SelectItem value="recurring">Recurring</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {paymentTiming === 'milestone' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Milestone Templates</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { append({ description: '', percentage: 0 }); }}
                className="min-h-[44px]"
              >
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Add Milestone
              </Button>
            </div>

            {fields.map((field, index) => {
              const descName = `milestones.${String(index)}.description` as `milestones.${number}.description`;
              const pctName = `milestones.${String(index)}.percentage` as `milestones.${number}.percentage`;
              return (
              <div key={field.id} className="flex gap-3">
                <FormField
                  control={form.control}
                  name={descName}
                  render={({ field: f }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input {...f} placeholder="Milestone description" className="min-h-[44px]" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={pctName}
                  render={({ field: f }) => (
                    <FormItem className="w-24">
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          {...f}
                          onChange={(e) => { f.onChange(Number(e.target.value)); }}
                          placeholder="%"
                          className="min-h-[44px]"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => { remove(index); }}
                  className="min-h-[44px] min-w-[44px]"
                  aria-label={`Remove milestone ${String(index + 1)}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              );
            })}

            <FormField
              control={form.control}
              name="milestones"
              render={() => <FormMessage />}
            />
          </div>
        ) : null}

        <FormField
          control={form.control}
          name="cancellationPolicy"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cancellation Policy</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} placeholder="Describe your cancellation policy..." />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="warrantyTerms"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Warranty Terms</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} placeholder="Describe your warranty terms..." />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={onPrev} className="min-h-[44px]">
            Previous
          </Button>
          <Button type="submit" disabled={setGlobalTerms.isPending} className="min-h-[44px]">
            {setGlobalTerms.isPending ? 'Saving...' : 'Next'}
          </Button>
          <Button type="button" variant="ghost" onClick={onNext} className="min-h-[44px]">
            Skip
          </Button>
        </div>
      </form>
    </Form>
  );
}

// -- Step 5: Portfolio --
function PortfolioStep({ onNext, onPrev }: { onNext: () => void; onPrev: () => void }) {
  const [images, setImages] = useState<{ url: string; caption: string }[]>([]);
  const updatePortfolio = useUpdatePortfolio();

  function addImage() {
    setImages([...images, { url: '', caption: '' }]);
  }

  function removeImage(index: number) {
    setImages(images.filter((_, i) => i !== index));
  }

  function updateImage(index: number, field: 'url' | 'caption', value: string) {
    setImages(images.map((img, i) => (i === index ? { ...img, [field]: value } : img)));
  }

  async function handleSave() {
    const validImages = images.filter((img) => img.url.trim() !== '');
    if (validImages.length > 0) {
      await updatePortfolio.mutateAsync(
        validImages.map((img, idx) => ({
          image_url: img.url,
          caption: img.caption || null,
          sort_order: idx,
        })),
      );
    }
    onNext();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Add URLs to images showcasing your work. Image upload will be available soon.
      </p>

      {images.map((img, index) => (
        <div key={index} className="flex gap-3">
          <div className="flex-1 space-y-2">
            <Input
              type="url"
              placeholder="Image URL"
              value={img.url}
              onChange={(e) => { updateImage(index, 'url', e.target.value); }}
              className="min-h-[44px]"
              aria-label={`Image ${String(index + 1)} URL`}
            />
            <Input
              placeholder="Caption (optional)"
              value={img.caption}
              onChange={(e) => { updateImage(index, 'caption', e.target.value); }}
              className="min-h-[44px]"
              aria-label={`Image ${String(index + 1)} caption`}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => { removeImage(index); }}
            className="mt-0 min-h-[44px] min-w-[44px]"
            aria-label={`Remove image ${String(index + 1)}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={addImage}
        className="min-h-[44px]"
      >
        <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
        Add Image
      </Button>

      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onPrev} className="min-h-[44px]">
          Previous
        </Button>
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={updatePortfolio.isPending}
          className="min-h-[44px]"
        >
          {updatePortfolio.isPending ? 'Saving...' : 'Finish'}
        </Button>
        <Button type="button" variant="ghost" onClick={onNext} className="min-h-[44px]">
          Skip
        </Button>
      </div>
    </div>
  );
}
