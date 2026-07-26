'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, ShieldX, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError, downloadAuthenticated, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

interface DeletionResponse {
  created: boolean;
  grace_deadline: string;
  message: string;
}

interface RestoreResponse {
  cancelled: boolean;
}

const REASON_OPTIONS = [
  { value: 'no_longer_needed', label: 'No longer need the service' },
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'switching_competitor', label: 'Switching to a competitor' },
  { value: 'privacy_concerns', label: 'Privacy concerns' },
  { value: 'too_many_emails', label: 'Too many emails / notifications' },
  { value: 'never_used', label: 'Never really used it' },
  { value: 'other', label: 'Other' },
] as const;

export default function AccountSettingsPage() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  const [reason, setReason] = useState<string>('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [graceDeadline, setGraceDeadline] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const canSubmit =
    reason.length > 0 && confirmation === 'DELETE' && !submitting;

  async function handleDelete() {
    setError(null);
    setSubmitting(true);
    try {
      const resp = await api.delete<DeletionResponse>('/api/v1/users/me', {
        reason,
        confirmation,
      });
      setGraceDeadline(resp.grace_deadline);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.userMessage('Failed to request account deletion.'));
      } else {
        setError('Failed to request account deletion. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRestore() {
    setError(null);
    setRestoring(true);
    try {
      const resp = await api.post<RestoreResponse>(
        '/api/v1/users/me/restore',
        {},
      );
      if (resp.cancelled) {
        setRestored(true);
        setGraceDeadline(null);
      } else {
        setError('No pending deletion request to cancel.');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.userMessage('Failed to cancel account deletion.'));
      } else {
        setError('Failed to cancel account deletion. Please try again.');
      }
    } finally {
      setRestoring(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.replace('/');
  }

  async function handleExport() {
    setExportError(null);
    setExported(false);
    setExporting(true);
    try {
      const filename = `nomarkup-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      await downloadAuthenticated('/api/v1/users/me/export', filename);
      setExported(true);
    } catch (err) {
      setExportError(getApiErrorMessage(err, 'Could not prepare your data export. Please try again.'));
    } finally {
      setExporting(false);
    }
  }

  // Already requested — show the grace-period state.
  if (graceDeadline) {
    const deadlineDate = new Date(graceDeadline);
    const formatted = deadlineDate.toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });

    return (
      <div className="space-y-6">
        <Card className="glass border border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-amber-300">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              Account deletion scheduled
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-zinc-200">
              Your account is scheduled for permanent deletion on{' '}
              <span className="font-semibold">{formatted}</span>.
            </p>
            <p className="text-sm text-zinc-300">
              You can cancel any time before then by clicking{' '}
              <strong>Restore my account</strong>. After the deadline, your
              data will be irrecoverable.
            </p>

            <div
              className="flex flex-col gap-3 sm:flex-row"
              role="group"
              aria-label="Account recovery actions"
            >
              <Button
                onClick={() => { void handleRestore(); }}
                disabled={restoring || restored}
                className="min-h-[44px]"
              >
                <Undo2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {restored ? 'Restored' : 'Restore my account'}
              </Button>
              <Button
                variant="outline"
                onClick={() => { void handleLogout(); }}
                className="min-h-[44px]"
              >
                Sign out
              </Button>
            </div>

            {restored && (
              <p
                className="text-sm text-emerald-400"
                role="status"
                aria-live="polite"
              >
                Your account is no longer scheduled for deletion.
              </p>
            )}
            {error && (
              <p
                className="text-sm text-red-400"
                role="alert"
                aria-live="assertive"
              >
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="glass border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="text-lg text-zinc-100">Privacy &amp; legal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-300">
          <p>
            Learn how we handle your data, the rules of the platform, and how to
            get help. Full policies live on public pages (no login required).
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <li>
              <Link
                href="/privacy"
                className="min-h-[44px] inline-flex items-center text-[var(--brand-gold)] underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link
                href="/terms"
                className="min-h-[44px] inline-flex items-center text-[var(--brand-gold)] underline-offset-4 hover:underline"
              >
                Terms of Service
              </Link>
            </li>
            <li>
              <Link
                href="/support"
                className="min-h-[44px] inline-flex items-center text-[var(--brand-gold)] underline-offset-4 hover:underline"
              >
                Support
              </Link>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="glass border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-zinc-100">
            <Download className="h-5 w-5" aria-hidden="true" />
            Download my data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm text-zinc-300">
            <p>
              Get a copy of the personal data NoMarkup holds about your account
              (GDPR Article 15 / CCPA right to access). The download is a single
              JSON file that includes your:
            </p>
            <ul className="ml-5 list-disc space-y-1">
              <li>Profile and account details</li>
              <li>Jobs, listings, bids, and offers you created</li>
              <li>Contracts and orders you took part in</li>
              <li>Payments, payouts, and advances</li>
              <li>Reviews you wrote and messages you sent</li>
              <li>Notifications, wishlist, watchlist, saved searches, referrals</li>
            </ul>
            <p className="text-xs text-zinc-400">
              For privacy, other people&rsquo;s details inside shared records
              (messages, contracts, orders) are shown only as a display name,
              and security data such as passwords is never included. Very long
              histories may be capped &mdash; capped sections are flagged in the
              file.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => { void handleExport(); }}
            disabled={exporting}
            className="min-h-[44px]"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {exporting ? 'Preparing your file…' : 'Download my data'}
          </Button>

          {exported && (
            <p
              className="text-sm text-emerald-400"
              role="status"
              aria-live="polite"
            >
              Your data export has been downloaded.
            </p>
          )}
          {exportError && (
            <p
              className="text-sm text-red-400"
              role="alert"
              aria-live="assertive"
            >
              {exportError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardHeader>
          <CardTitle className="gold-text flex items-center gap-2 text-lg">
            <ShieldX className="h-5 w-5" aria-hidden="true" />
            Delete my account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2 text-sm text-zinc-300">
            <p>
              You can permanently delete your NoMarkup account at any time.
              We will:
            </p>
            <ul className="ml-5 list-disc space-y-1">
              <li>Schedule deletion 30 days from now (your grace period).</li>
              <li>
                Erase your profile, properties, photos, and KYC documents.
              </li>
              <li>
                Anonymize bids, contracts, and reviews you participated in
                so platform records remain consistent.
              </li>
              <li>Delete your Stripe customer and any payment methods.</li>
            </ul>
            <p>
              Some records are kept for legal retention (tax forms, payment
              ledger). Sign in any time during the grace period to cancel.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deletion-reason">Why are you leaving?</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger
                id="deletion-reason"
                aria-required="true"
                className="min-h-[44px]"
              >
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deletion-confirm">
              Type <span className="font-mono font-bold">DELETE</span> to
              confirm
            </Label>
            <Input
              id="deletion-confirm"
              value={confirmation}
              onChange={(e) => { setConfirmation(e.target.value); }}
              placeholder="DELETE"
              autoComplete="off"
              aria-describedby="deletion-confirm-help"
              className="min-h-[44px]"
            />
            <p id="deletion-confirm-help" className="text-xs text-zinc-400">
              This is intentional friction so the action cannot be triggered
              accidentally.
            </p>
          </div>

          {error && (
            <p
              className="text-sm text-red-400"
              role="alert"
              aria-live="assertive"
            >
              {error}
            </p>
          )}

          <Button
            variant="destructive"
            onClick={() => { void handleDelete(); }}
            disabled={!canSubmit}
            className="min-h-[44px]"
          >
            {submitting ? 'Submitting...' : 'Request account deletion'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
