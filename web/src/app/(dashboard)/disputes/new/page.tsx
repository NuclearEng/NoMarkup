'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Upload, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
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
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useContracts } from '@/hooks/useContracts';
import { useFileDispute } from '@/hooks/useDisputes';
import { useImageUpload } from '@/hooks/useImageUpload';

const DISPUTE_STEPS = [
  { title: 'Contract', description: 'Select the affected contract' },
  { title: 'Reason', description: 'Why are you filing this dispute?' },
  { title: 'Description', description: 'Describe what happened' },
  { title: 'Evidence', description: 'Upload supporting photos (optional)' },
  { title: 'Review', description: 'Review and submit' },
] as const;

const DISPUTE_REASONS = [
  { value: 'quality_issue', label: 'Quality Issue', description: 'Work was not completed to the agreed standard' },
  { value: 'incomplete_work', label: 'Incomplete Work', description: 'The provider did not finish the job' },
  { value: 'no_show', label: 'No-Show', description: 'Provider failed to show up' },
  { value: 'property_damage', label: 'Property Damage', description: 'Property was damaged during the work' },
  { value: 'other', label: 'Other', description: 'Another issue not listed above' },
] as const;

type _DisputeReason = (typeof DISPUTE_REASONS)[number]['value'];

const disputeSchema = z.object({
  contractId: z.string().min(1, 'Please select a contract'),
  reason: z.enum(['quality_issue', 'incomplete_work', 'no_show', 'property_damage', 'other'], {
    required_error: 'Please select a reason',
  }),
  description: z.string().min(50, 'Description must be at least 50 characters').max(5000),
});

type DisputeFormValues = z.infer<typeof disputeSchema>;

const MAX_EVIDENCE = 5;

function DisputeFormInner() {
  const searchParams = useSearchParams();
  const prefilledContractId = searchParams.get('contractId') ?? '';

  const [step, setStep] = useState(0);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [disputeId, setDisputeId] = useState('');

  const { data: contractsData } = useContracts({ page_size: 50 });
  const fileDispute = useFileDispute();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const imageUpload = useImageUpload({
    context: 'document',
    onSuccess: (result) => {
      setEvidenceUrls((prev) => [...prev, result.confirmedUrl]);
    },
    onError: (error) => {
      // Error is shown in the UI via imageUpload.error
      void error;
    },
  });

  const form = useForm<DisputeFormValues>({
    resolver: zodResolver(disputeSchema),
    defaultValues: {
      contractId: prefilledContractId,
      reason: undefined,
      description: '',
    },
    mode: 'onTouched',
  });

  const currentStep = DISPUTE_STEPS[step];
  const progress = ((step + 1) / DISPUTE_STEPS.length) * 100;

  async function validateStep(): Promise<boolean> {
    switch (step) {
      case 0:
        return form.trigger('contractId');
      case 1:
        return form.trigger('reason');
      case 2:
        return form.trigger('description');
      default:
        return true;
    }
  }

  async function goNext() {
    const valid = await validateStep();
    if (valid && step < DISPUTE_STEPS.length - 1) {
      setStep(step + 1);
    }
  }

  function goPrev() {
    if (step > 0) setStep(step - 1);
  }

  async function handleSubmit() {
    const valid = await form.trigger();
    if (!valid) return;

    const values = form.getValues();
    try {
      const result = await fileDispute.mutateAsync({
        contract_id: values.contractId,
        reason: values.reason,
        description: values.description,
        evidence_urls: evidenceUrls,
      });
      setDisputeId(result.dispute_id);
      setSubmitted(true);
    } catch {
      // Error toast handled by mutation
    }
  }

  const handleEvidenceUpload = useCallback(
    async (file: File) => {
      if (evidenceUrls.length >= MAX_EVIDENCE) return;
      await imageUpload.upload(file);
    },
    [evidenceUrls.length, imageUpload],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void handleEvidenceUpload(file);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [handleEvidenceUpload],
  );

  const removeEvidence = useCallback((index: number) => {
    setEvidenceUrls((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const contracts = contractsData?.contracts ?? [];
  const selectedContract = contracts.find((c) => c.id === form.watch('contractId'));
  const selectedReasonObj = DISPUTE_REASONS.find((r) => r.value === form.watch('reason'));

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg space-y-6 py-12 text-center">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" aria-hidden="true" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Dispute Filed</h1>
          <p className="text-zinc-400">
            Your dispute has been submitted and is under review. We&apos;ll be in touch shortly.
          </p>
        </div>
        <Card className="border-border/50 bg-card/60 text-left">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Dispute ID</span>
              <span className="font-mono text-sm text-zinc-200">{disputeId}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm text-zinc-400">Status</span>
              <Badge variant="secondary">Filed</Badge>
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-center gap-3">
          <Button asChild className="min-h-[44px]">
            <Link href="/contracts">Back to Contracts</Link>
          </Button>
          <Button variant="outline" asChild className="min-h-[44px]">
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-6 w-6 text-orange-400" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">File a Dispute</h1>
          <p className="text-sm text-zinc-400">
            Step {String(step + 1)} of {String(DISPUTE_STEPS.length)}
          </p>
        </div>
      </div>

      <Progress value={progress} className="h-2" aria-label="Dispute filing progress" />

      <nav aria-label="Dispute filing steps" className="flex gap-2 overflow-x-auto pb-2">
        {DISPUTE_STEPS.map((s, idx) => (
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
              {/* Step 1: Contract selection */}
              {step === 0 ? (
                <FormField
                  control={form.control}
                  name="contractId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue placeholder="Select the contract for this dispute" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {contracts.length === 0 ? (
                            <SelectItem value="__none__" disabled>
                              No contracts found
                            </SelectItem>
                          ) : null}
                          {contracts.map((contract) => (
                            <SelectItem key={contract.id} value={contract.id}>
                              #{contract.contract_number} — {contract.job_title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Select the contract related to this dispute.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              {/* Step 2: Reason */}
              {step === 1 ? (
                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason</FormLabel>
                      <div
                        className="space-y-2"
                        role="radiogroup"
                        aria-label="Select dispute reason"
                      >
                        {DISPUTE_REASONS.map((reason) => (
                          // eslint-disable-next-line jsx-a11y/label-has-associated-control -- htmlFor + nested input; rule's static analyzer can't trace map()
                          <label
                            key={reason.value}
                            htmlFor={`dispute-reason-${reason.value}`}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                              field.value === reason.value
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:border-border/80 hover:bg-muted/30'
                            }`}
                          >
                            <input
                              id={`dispute-reason-${reason.value}`}
                              type="radio"
                              value={reason.value}
                              checked={field.value === reason.value}
                              onChange={() => {
                                field.onChange(reason.value);
                              }}
                              className="mt-0.5 h-4 w-4"
                            />
                            <div>
                              <p className="text-sm font-medium text-zinc-200">{reason.label}</p>
                              <p className="mt-0.5 text-xs text-zinc-400">{reason.description}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              {/* Step 3: Description */}
              {step === 2 ? (
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={8}
                          maxLength={5000}
                          placeholder="Please describe the issue in detail. Include dates, what was agreed upon, and what went wrong..."
                        />
                      </FormControl>
                      <FormDescription>
                        {String(field.value.length)}/5000 characters (minimum 50)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              {/* Step 4: Evidence */}
              {step === 3 ? (
                <div className="space-y-4">
                  <p className="text-muted-foreground text-sm">
                    Upload up to {String(MAX_EVIDENCE)} photos as evidence (optional).
                  </p>

                  {evidenceUrls.length < MAX_EVIDENCE ? (
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={handleFileChange}
                        aria-hidden="true"
                        tabIndex={-1}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={imageUpload.status === 'uploading' || imageUpload.status === 'getting_url' || imageUpload.status === 'confirming'}
                        className="min-h-[44px] w-full"
                      >
                        <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                        {imageUpload.status === 'uploading'
                          ? `Uploading... ${String(imageUpload.progress)}%`
                          : imageUpload.status === 'getting_url' || imageUpload.status === 'confirming'
                            ? 'Processing...'
                            : 'Add Photo'}
                      </Button>
                      {imageUpload.error ? (
                        <p className="text-destructive mt-1 text-xs">{imageUpload.error}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {evidenceUrls.length > 0 ? (
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                      {evidenceUrls.map((url, index) => (
                        <div
                          key={url}
                          className="group relative aspect-square overflow-hidden rounded-md border"
                        >
                          {/* Evidence preview — using img intentionally, not next/image */}
                          <img
                            src={url}
                            alt={`Evidence ${String(index + 1)}`}
                            className="h-full w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => { removeEvidence(index); }}
                            className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
                            aria-label={`Remove evidence photo ${String(index + 1)}`}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                      No photos added yet
                    </p>
                  )}

                  <p className="text-muted-foreground text-xs">
                    {String(evidenceUrls.length)}/{String(MAX_EVIDENCE)} photos
                  </p>
                </div>
              ) : null}

              {/* Step 5: Review */}
              {step === 4 ? (
                <div className="space-y-4">
                  <div className="rounded-md border p-4 space-y-3">
                    <div>
                      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Contract</h3>
                      <p className="mt-0.5 text-sm font-semibold text-zinc-200">
                        {selectedContract
                          ? `#${selectedContract.contract_number} — ${selectedContract.job_title}`
                          : form.watch('contractId')}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Reason</h3>
                      <p className="mt-0.5 text-sm text-zinc-200">
                        {selectedReasonObj?.label ?? form.watch('reason')}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Description</h3>
                      <p className="mt-0.5 text-sm whitespace-pre-wrap text-zinc-300">
                        {form.watch('description')}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Evidence</h3>
                      <p className="mt-0.5 text-sm text-zinc-300">
                        {evidenceUrls.length > 0
                          ? `${String(evidenceUrls.length)} photo${evidenceUrls.length !== 1 ? 's' : ''} attached`
                          : 'No photos attached'}
                      </p>
                    </div>
                  </div>

                  {form.formState.errors.root ? (
                    <p className="text-destructive text-sm">
                      {form.formState.errors.root.message}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Navigation */}
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

                {step < DISPUTE_STEPS.length - 1 ? (
                  <Button
                    type="button"
                    onClick={() => void goNext()}
                    className="min-h-[44px]"
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : null}

                {step === DISPUTE_STEPS.length - 1 ? (
                  <Button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={fileDispute.isPending}
                    className="min-h-[44px] bg-orange-600 text-white hover:bg-orange-700"
                  >
                    {fileDispute.isPending ? 'Submitting...' : 'Submit Dispute'}
                  </Button>
                ) : null}
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

function NewDisputeFallback() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading dispute form">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export default function NewDisputePage() {
  return (
    <Suspense fallback={<NewDisputeFallback />}>
      <DisputeFormInner />
    </Suspense>
  );
}
