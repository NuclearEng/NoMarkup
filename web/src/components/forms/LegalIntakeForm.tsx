'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Scale, ShieldCheck } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCategoryTree } from '@/hooks/useCategories';
import { useCreateJob } from '@/hooks/useJobs';
import {
  LEGAL_CONTACT_PREFERENCE,
  LEGAL_URGENCY,
  legalIntakeSchema,
  type LegalContactPreference,
  type LegalIntakeFormValues,
  type LegalUrgency,
} from '@/lib/validations';
import { AUCTION_TYPE, SCHEDULE_TYPE, type CreateJobInput, type ServiceCategory } from '@/types';

// 2-letter US state codes (+ DC). Mirrors the provider onboarding list so the
// jurisdiction selector stays consistent across the app.
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
] as const;

// Friendly, plain-language labels + helper copy for the timeline options. The
// urgency choice maps onto the job's schedule_type (and the same-day SLA flag)
// at submit time — attorneys see how soon the client needs help.
const URGENCY_OPTIONS: Record<LegalUrgency, { label: string; hint: string }> = {
  urgent: { label: 'Urgent — within 48 hours', hint: 'Deadline, hearing, or time-sensitive filing.' },
  soon: { label: 'Soon — within a couple of weeks', hint: 'Important but not an emergency.' },
  flexible: { label: 'Flexible — no firm deadline', hint: 'Looking for the right fit at the right price.' },
};

const CONTACT_OPTIONS: Record<LegalContactPreference, string> = {
  platform: 'Secure messaging on NoMarkup',
  phone: 'Phone call',
  video: 'Video consultation',
};

// Default auction window for legal matters (3 days) — long enough for several
// attorneys to review and bid, short enough to keep the client moving.
const LEGAL_AUCTION_DURATION_HOURS = 72;

interface LegalIntakeFormProps {
  /** Optional pre-selected matter category id (e.g. deep-linked from a marketing
   *  surface). When it matches a resolved matter type, that type starts selected. */
  presetMatterCategoryId?: string;
}

/**
 * LegalIntakeForm is a standalone, legal-tailored intake — NOT the generic
 * 3-level service-category wizard. It asks for a legal MATTER TYPE (the level-2
 * legal service categories, with friendly labels), the matter details,
 * jurisdiction, timeline, budget, and contact preference, then creates a job in
 * the chosen legal category via the existing job-create mutation so attorneys
 * can bid (reverse auction). Because the matter type is itself a legal service
 * category, the created job lands in the legal vertical and appears under the
 * legal landing's "Open legal cases".
 */
export function LegalIntakeForm({ presetMatterCategoryId }: LegalIntakeFormProps) {
  const router = useRouter();
  const createJob = useCreateJob();
  const { data: tree, isLoading: treeLoading, isError: treeError, refetch } = useCategoryTree();

  // The matter types are the level-2 children of the legal subtree root (slug
  // `legal`). Sourced live from the DB-backed category tree so this never drifts
  // from the canonical taxonomy.
  const matterTypes = useMemo<ServiceCategory[]>(() => {
    const legalRoot = tree?.find((c) => c.slug === 'legal');
    // The public tree only returns active categories, so no extra filtering.
    return legalRoot?.children ?? [];
  }, [tree]);

  const form = useForm<LegalIntakeFormValues>({
    resolver: zodResolver(legalIntakeSchema),
    defaultValues: {
      matterCategoryId: '',
      title: '',
      description: '',
      jurisdiction: '',
      urgency: 'soon',
      budgetDollars: undefined,
      contactPreference: 'platform',
    },
    mode: 'onTouched',
  });

  // Seed the matter type from a deep-link once the tree resolves, if it's valid.
  useEffect(() => {
    if (!presetMatterCategoryId || matterTypes.length === 0) return;
    if (form.getValues('matterCategoryId')) return;
    const match = matterTypes.find((m) => m.id === presetMatterCategoryId);
    if (match) form.setValue('matterCategoryId', match.id);
  }, [presetMatterCategoryId, matterTypes, form]);

  function buildCreateInput(values: LegalIntakeFormValues): CreateJobInput {
    const stateName = values.jurisdiction;
    const contactLabel = CONTACT_OPTIONS[values.contactPreference];
    // Fold the legal-specific context the generic job columns don't have into
    // the description so attorneys see jurisdiction + contact preference. The
    // matter type itself is carried structurally as category_id.
    const description =
      `${values.description}\n\n` +
      `— Jurisdiction: ${stateName}\n` +
      `— Preferred contact: ${contactLabel}`;

    const budgetCents =
      values.budgetDollars !== undefined ? Math.round(values.budgetDollars * 100) : undefined;

    return {
      category_id: values.matterCategoryId,
      title: values.title,
      description,
      schedule_type: values.urgency === 'flexible' ? SCHEDULE_TYPE.FLEXIBLE : SCHEDULE_TYPE.DATE_RANGE,
      is_recurring: false,
      // Budget acts as the customer's ceiling — attorneys bid at or below it.
      offer_accepted_cents: budgetCents,
      auction_duration_hours: LEGAL_AUCTION_DURATION_HOURS,
      auction_type: AUCTION_TYPE.SEALED,
      // Urgent matters get the same-day SLA flag so the matcher prioritizes
      // attorneys who can engage immediately.
      same_day_requested: values.urgency === 'urgent' || undefined,
      publish: true,
    };
  }

  async function handleSubmit(values: LegalIntakeFormValues) {
    try {
      const input = buildCreateInput(values);
      await createJob.mutateAsync(input);
      router.push('/jobs/mine' as Route);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not post your legal job. Please try again.';
      form.setError('root', { message });
    }
  }

  const isPending = createJob.isPending;
  const rootError = form.formState.errors.root?.message;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-gold)]/10 text-[var(--brand-gold)]">
          <Scale className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">Tell us about your legal matter</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Describe what you need and licensed attorneys will compete on price. It takes a minute.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Legal intake</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={(e) => void form.handleSubmit(handleSubmit)(e)} className="space-y-6">
              {/* Matter type — the legal-specific selector that replaces the
                  generic 3-level service-category picker. */}
              <FormField
                control={form.control}
                name="matterCategoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>What type of legal help do you need?</FormLabel>
                    {treeLoading ? (
                      <div
                        className="bg-muted h-11 w-full animate-pulse rounded-md"
                        aria-label="Loading legal matter types"
                      />
                    ) : treeError || matterTypes.length === 0 ? (
                      <div className="space-y-2">
                        <p className="text-destructive text-sm" role="alert">
                          We couldn&apos;t load the legal matter types. Please retry.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-[44px]"
                          onClick={() => void refetch()}
                        >
                          Retry
                        </Button>
                      </div>
                    ) : (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="min-h-[44px]">
                            <SelectValue placeholder="Select a matter type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {matterTypes.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <FormDescription>
                      Not sure? Pick the closest — your attorney can advise once they see the details.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Give your matter a short title</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., Review a commercial lease before I sign"
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
                    <FormLabel>Describe your matter</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={6}
                        maxLength={5000}
                        placeholder="What's going on, what you're trying to achieve, any deadlines, and key facts. Don't share confidential details until you've engaged an attorney."
                      />
                    </FormControl>
                    <FormDescription>
                      {String(field.value.length)}/5000 characters (minimum 50)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="jurisdiction"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Which state is this matter in?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[44px]">
                          <SelectValue placeholder="Select a state" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-72">
                        {US_STATES.map((code) => (
                          <SelectItem key={code} value={code}>
                            {code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Attorneys must be licensed in your jurisdiction to bid.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="urgency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>How soon do you need help?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[44px]">
                          <SelectValue placeholder="Choose a timeline" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LEGAL_URGENCY.map((key) => (
                          <SelectItem key={key} value={key}>
                            {URGENCY_OPTIONS[key].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>{URGENCY_OPTIONS[field.value].hint}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="budgetDollars"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Budget (optional)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2">
                          $
                        </span>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={1}
                          placeholder="500"
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            field.onChange(v === '' ? undefined : Number(v));
                          }}
                          className="min-h-[44px] pl-8"
                        />
                      </div>
                    </FormControl>
                    <FormDescription>
                      Your ceiling. Attorneys bid at or below it. Leave blank to let them quote.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contactPreference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>How would you like to be contacted?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="min-h-[44px]">
                          <SelectValue placeholder="Choose a contact method" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LEGAL_CONTACT_PREFERENCE.map((key) => (
                          <SelectItem key={key} value={key}>
                            {CONTACT_OPTIONS[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {rootError ? (
                <p className="text-destructive text-sm" role="alert" aria-live="assertive">
                  {rootError}
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button type="submit" disabled={isPending} className="min-h-[44px]">
                  {isPending ? 'Posting…' : 'Post my legal job'}
                  {!isPending ? <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /> : null}
                </Button>
                <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  Every attorney&apos;s bar license is verified before they can bid.
                </p>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
