'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import type { Route } from 'next';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';

import { CategorySelector } from '@/components/providers/CategorySelector';

const ServiceAreaMap = dynamic(
  () => import('@/components/maps/ServiceAreaMap').then((mod) => mod.ServiceAreaMap),
  { ssr: false },
);
import { ImageUpload } from '@/components/ui/ImageUpload';
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';
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
  { title: 'Verification', description: 'Upload documents to verify your business' },
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
          {step === 5 ? <DocumentVerificationStep onNext={goNext} onPrev={goPrev} /> : null}
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
    defaultValues: {
      businessName: '',
      bio: '',
      serviceAddress: '',
      einTin: '',
      insuranceProvider: '',
      insurancePolicyNumber: '',
      insuranceExpiry: '',
      insuranceCoverageDollars: undefined,
    },
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

        {/* Business Identity */}
        <div className="border-t pt-6">
          <h3 className="mb-4 text-sm font-semibold">Business Identity (Optional)</h3>

          <div className="space-y-4">
            <FormField
              control={form.control}
              name="einTin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>EIN / TIN</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="XX-XXXXXXX"
                      maxLength={10}
                      className="min-h-[44px]"
                      onChange={(e) => {
                        let val = e.target.value.replace(/[^\d-]/g, '');
                        // Auto-insert dash after 2 digits
                        if (val.length === 2 && !val.includes('-') && field.value?.length !== 3) {
                          val = val + '-';
                        }
                        field.onChange(val);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="insuranceProvider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Insurance Provider</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. State Farm, Allstate" className="min-h-[44px]" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="insurancePolicyNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Insurance Policy Number</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="POL-12345678" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="insuranceExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Insurance Expiry Date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" className="min-h-[44px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="insuranceCoverageDollars"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Insurance Coverage Amount ($)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      placeholder="e.g. 1000000"
                      className="min-h-[44px]"
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        field.onChange(val === '' ? undefined : Number(val));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

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
          className="min-h-[44px] w-full accent-primary"
          aria-label={`Service radius: ${String(radius)} kilometers`}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>5 km</span>
          <span>100 km</span>
        </div>
      </div>

      {/* Service area visualization */}
      {process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] ? (
        <div className="space-y-2">
          <ServiceAreaMap radiusKm={radius} />
          <p className="text-center text-sm font-medium">
            {String(radius)} km service radius
            <span className="ml-1 text-xs text-muted-foreground">
              (~{String(Math.round(radius * 0.621))} miles)
            </span>
          </p>
        </div>
      ) : (
        <div className="relative flex items-center justify-center rounded-md border bg-muted/30 p-8">
          <div className="relative">
            <div
              className="flex items-center justify-center rounded-full border-2 border-dashed border-primary/30 bg-primary/5"
              style={{ width: `${String(Math.min(radius * 3, 250))}px`, height: `${String(Math.min(radius * 3, 250))}px` }}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                You
              </div>
            </div>
            <p className="mt-3 text-center text-sm font-medium">
              {String(radius)} km service radius
            </p>
            <p className="text-center text-xs text-muted-foreground">
              ~{String(Math.round(radius * 0.621))} miles
            </p>
          </div>
        </div>
      )}

      <div>
        <label htmlFor="service-address" className="text-sm font-medium">
          Service Base Address
        </label>
        <Input
          id="service-address"
          placeholder="Enter your base address for service area"
          className="mt-1 min-h-[44px]"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Your service area will be centered on this address.
        </p>
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
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const updatePortfolio = useUpdatePortfolio();

  function handleUploadComplete(result: { confirmedUrl: string }) {
    setUploadedUrls((prev) => [...prev, result.confirmedUrl]);
  }

  function handleRemove(url: string) {
    setUploadedUrls((prev) => prev.filter((u) => u !== url));
    setCaptions((prev) => {
      const next = { ...prev };
      delete next[url];
      return next;
    });
  }

  async function handleSave() {
    if (uploadedUrls.length > 0) {
      await updatePortfolio.mutateAsync(
        uploadedUrls.map((url, idx) => ({
          image_url: url,
          caption: captions[url] || null,
          sort_order: idx,
        })),
      );
    }
    onNext();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Upload images showcasing your best work. Up to 10 portfolio images.
      </p>

      <ImageUpload
        context="portfolio"
        onUploadComplete={handleUploadComplete}
        multiple
        maxFiles={10}
        existingImages={uploadedUrls}
        onRemove={handleRemove}
        placeholder="Drop portfolio images here, or click to browse"
      />

      {/* Captions for uploaded images */}
      {uploadedUrls.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Add captions (optional)</p>
          {uploadedUrls.map((url, index) => (
            <Input
              key={url}
              placeholder={`Caption for image ${String(index + 1)}`}
              value={captions[url] ?? ''}
              onChange={(e) => {
                setCaptions((prev) => ({ ...prev, [url]: e.target.value }));
              }}
              className="min-h-[44px]"
              aria-label={`Caption for image ${String(index + 1)}`}
            />
          ))}
        </div>
      ) : null}

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
          {updatePortfolio.isPending ? 'Saving...' : 'Next'}
        </Button>
        <Button type="button" variant="ghost" onClick={onNext} className="min-h-[44px]">
          Skip
        </Button>
      </div>
    </div>
  );
}

// -- Step 6: Document Verification --

const ACCEPTED_DOCUMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const ACCEPTED_DOCUMENT_EXTENSIONS = '.jpg,.jpeg,.png,.webp,.pdf';

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

interface DocumentTypeConfig {
  key: string;
  label: string;
  description: string;
  required: boolean;
}

const DOCUMENT_TYPES: DocumentTypeConfig[] = [
  {
    key: 'government_id',
    label: 'Government-Issued ID',
    description: "Driver's license or passport. Used to verify your identity.",
    required: true,
  },
  {
    key: 'business_license',
    label: 'Business License',
    description: 'Your business registration or license certificate.',
    required: false,
  },
  {
    key: 'proof_of_insurance',
    label: 'Proof of Insurance',
    description: 'Liability insurance or bonding documentation.',
    required: false,
  },
  {
    key: 'trade_license',
    label: 'Trade-Specific License',
    description: 'Electrician, plumber, contractor, or other trade license.',
    required: false,
  },
];

interface DocumentFile {
  file: File;
  name: string;
}

function formatDocumentSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function DocumentVerificationStep({ onNext, onPrev }: { onNext: () => void; onPrev: () => void }) {
  const [documents, setDocuments] = useState<Record<string, DocumentFile>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleFileSelect(docKey: string, file: File | undefined) {
    if (!file) return;

    // Validate file type
    if (!ACCEPTED_DOCUMENT_TYPES.includes(file.type)) {
      setErrors((prev) => ({
        ...prev,
        [docKey]: 'Please upload a JPG, PNG, WebP, or PDF file.',
      }));
      return;
    }

    // Validate file size
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      setErrors((prev) => ({
        ...prev,
        [docKey]: `File exceeds the ${formatDocumentSize(MAX_DOCUMENT_SIZE_BYTES)} limit.`,
      }));
      return;
    }

    // Clear any previous error
    setErrors((prev) => {
      const next = { ...prev };
      delete next[docKey];
      return next;
    });

    setDocuments((prev) => ({
      ...prev,
      [docKey]: { file, name: file.name },
    }));
  }

  function handleRemove(docKey: string) {
    setDocuments((prev) => {
      const next = { ...prev };
      delete next[docKey];
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[docKey];
      return next;
    });
  }

  function handleFinish() {
    // Validate required documents
    const missingRequired = DOCUMENT_TYPES.filter(
      (dt) => dt.required && !documents[dt.key],
    );

    if (missingRequired.length > 0) {
      const newErrors: Record<string, string> = {};
      for (const dt of missingRequired) {
        newErrors[dt.key] = `${dt.label} is required.`;
      }
      setErrors((prev) => ({ ...prev, ...newErrors }));
      return;
    }

    // In the future, documents would be uploaded to the server here.
    // For now, proceed to complete onboarding.
    onNext();
  }

  const hasRequiredDocuments = DOCUMENT_TYPES.filter((dt) => dt.required).every(
    (dt) => documents[dt.key] !== undefined,
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Upload documents to verify your identity and business credentials.
        Accepted formats: JPG, PNG, WebP, PDF (max{' '}
        {formatDocumentSize(MAX_DOCUMENT_SIZE_BYTES)}).
      </p>

      <div className="space-y-4">
        {DOCUMENT_TYPES.map((docType) => (
          <DocumentUploadField
            key={docType.key}
            config={docType}
            document={documents[docType.key]}
            error={errors[docType.key]}
            onFileSelect={(file) => { handleFileSelect(docType.key, file); }}
            onRemove={() => { handleRemove(docType.key); }}
          />
        ))}
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onPrev} className="min-h-[44px]">
          Previous
        </Button>
        <Button
          type="button"
          onClick={handleFinish}
          className="min-h-[44px]"
        >
          Finish
        </Button>
        {hasRequiredDocuments ? null : (
          <Button type="button" variant="ghost" onClick={onNext} className="min-h-[44px]">
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}

function DocumentUploadField({
  config,
  document,
  error,
  onFileSelect,
  onRemove,
}: {
  config: DocumentTypeConfig;
  document: DocumentFile | undefined;
  error: string | undefined;
  onFileSelect: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      onFileSelect(file);
    },
    [onFileSelect],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      onFileSelect(file);
      // Reset input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onFileSelect],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFilePicker();
      }
    },
    [openFilePicker],
  );

  const isPdf = document?.file.type === 'application/pdf';

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              {config.label}
            </label>
            <Badge variant={config.required ? 'default' : 'secondary'}>
              {config.required ? 'Required' : 'Optional'}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {config.description}
          </p>
        </div>
        {document ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" aria-label="Uploaded" />
        ) : null}
      </div>

      {document ? (
        <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
          <FileText className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{document.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatDocumentSize(document.file.size)}
              {isPdf ? ' - PDF' : ` - ${document.file.type.replace('image/', '').toUpperCase()}`}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="min-h-[44px] min-w-[44px] shrink-0"
            aria-label={`Remove ${config.label}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Upload ${config.label}`}
          className={cn(
            'flex min-h-[80px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-4 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
          )}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={openFilePicker}
          onKeyDown={handleKeyDown}
        >
          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_DOCUMENT_EXTENSIONS}
            className="sr-only"
            onChange={handleInputChange}
            aria-hidden="true"
            tabIndex={-1}
          />
          <Upload className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {isDragging ? 'Drop file here' : 'Click or drag file to upload'}
          </p>
        </div>
      )}

      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert" aria-describedby={inputId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
