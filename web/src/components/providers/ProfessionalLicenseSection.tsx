'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Clock, Scale, XCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
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
import { useFeatureFlag } from '@/hooks/useFeatureFlags';
import {
  LICENSE_STATUS,
  LICENSE_TYPE,
  useMyLicenses,
  useSubmitLicense,
  type LicenseStatus,
  type ProviderLicense,
} from '@/hooks/useProviderLicenses';
import { cn } from '@/lib/utils';

// US states + DC + federal districts a bar membership can be issued by. Kept as a
// flat list — the backend is the source of truth and validates the value too.
const JURISDICTIONS = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
  'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
] as const;

const licenseFormSchema = z.object({
  licenseNumber: z
    .string()
    .trim()
    .min(3, 'Enter your bar license number')
    .max(64, 'License number is too long'),
  jurisdiction: z.string().min(1, 'Select the issuing jurisdiction'),
});

type LicenseFormValues = z.infer<typeof licenseFormSchema>;

function StatusBadge({ status }: { status: LicenseStatus }) {
  if (status === LICENSE_STATUS.VERIFIED) {
    return (
      <Badge className="gap-1 border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        Verified
      </Badge>
    );
  }
  if (status === LICENSE_STATUS.REJECTED) {
    return (
      <Badge className="gap-1 border-destructive/30 bg-destructive/10 text-destructive">
        <XCircle className="h-3 w-3" aria-hidden="true" />
        Rejected
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 border-amber-500/20 bg-amber-500/10 text-amber-300">
      <Clock className="h-3 w-3" aria-hidden="true" />
      Pending review
    </Badge>
  );
}

function LicenseRow({ license }: { license: ProviderLicense }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-[var(--brand-gold)]/10 bg-white/[0.04] p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-100">
          {license.jurisdiction} Bar
        </p>
        <p className="truncate text-xs text-zinc-400">No. {license.license_number}</p>
        {license.status === LICENSE_STATUS.REJECTED && license.rejection_reason ? (
          <p className="mt-1 text-xs text-destructive">{license.rejection_reason}</p>
        ) : null}
      </div>
      <StatusBadge status={license.status} />
    </li>
  );
}

/**
 * ProfessionalLicenseSection lets a provider submit a bar license for the LEGAL
 * vertical and shows the verification status of each license they've submitted.
 * It is self-contained (own data fetching + submit), so it can drop into the
 * onboarding flow or the provider profile/settings.
 *
 * The whole section is gated behind the `legal_services` flag — when the flag is
 * explicitly OFF it renders nothing (no dead "submit a bar license" UI for
 * non-legal markets). The gateway independently enforces the flag.
 */
export function ProfessionalLicenseSection({ className }: { className?: string }) {
  const legalEnabled = useFeatureFlag('legal_services');
  const { data: licenses, isLoading } = useMyLicenses();
  const submitLicense = useSubmitLicense();

  const form = useForm<LicenseFormValues>({
    resolver: zodResolver(licenseFormSchema),
    defaultValues: { licenseNumber: '', jurisdiction: '' },
  });

  if (!legalEnabled) return null;

  async function onSubmit(values: LicenseFormValues) {
    await submitLicense.mutateAsync({
      license_type: LICENSE_TYPE.BAR,
      license_number: values.licenseNumber.trim(),
      jurisdiction: values.jurisdiction,
    });
    form.reset({ licenseNumber: '', jurisdiction: '' });
  }

  return (
    <section className={cn('space-y-5', className)}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-gold)]/10 text-[var(--brand-gold)]">
          <Scale className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Professional License</h3>
          <p className="text-sm text-zinc-400">
            Add your bar license to compete for legal jobs. Verified attorneys earn a
            &ldquo;Verified Bar Member&rdquo; badge on their public profile.
          </p>
        </div>
      </div>

      {/* Existing licenses + their verification status */}
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-lg border border-[var(--brand-gold)]/10 bg-white/[0.04]" />
      ) : licenses && licenses.length > 0 ? (
        <ul className="space-y-2">
          {licenses.map((license) => (
            <LicenseRow key={license.id} license={license} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">
          You haven&apos;t submitted a professional license yet.
        </p>
      )}

      {/* Submit form */}
      <Form {...form}>
        <form
          onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
          className="space-y-4 rounded-lg border border-[var(--brand-gold)]/10 bg-white/[0.02] p-4"
        >
          <FormField
            control={form.control}
            name="jurisdiction"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Issuing jurisdiction</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="min-h-[44px]">
                      <SelectValue placeholder="Select a state" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {JURISDICTIONS.map((j) => (
                      <SelectItem key={j} value={j}>
                        {j}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="licenseNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bar license number</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="e.g. 1234567"
                    autoComplete="off"
                    className="min-h-[44px]"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={submitLicense.isPending} className="min-h-[44px]">
            {submitLicense.isPending ? 'Submitting...' : 'Submit for verification'}
          </Button>
        </form>
      </Form>
    </section>
  );
}
