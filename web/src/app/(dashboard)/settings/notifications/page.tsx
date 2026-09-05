'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useNotificationPreferences, useUpdatePreferences } from '@/hooks/useNotifications';
import { NOTIFICATION_TYPE } from '@/types';
import type { NotificationPreference, NotificationType } from '@/types';

interface CategoryGroup {
  label: string;
  types: { type: NotificationType; label: string }[];
}

const PREFERENCE_CATEGORIES: CategoryGroup[] = [
  {
    label: 'Bidding',
    types: [
      { type: NOTIFICATION_TYPE.NEW_BID, label: 'New bid received' },
      { type: NOTIFICATION_TYPE.BID_AWARDED, label: 'Bid awarded' },
      { type: NOTIFICATION_TYPE.BID_NOT_SELECTED, label: 'Bid not selected' },
      { type: NOTIFICATION_TYPE.AUCTION_CLOSING_SOON, label: 'Auction closing soon' },
      { type: NOTIFICATION_TYPE.AUCTION_CLOSED, label: 'Auction closed' },
      { type: NOTIFICATION_TYPE.OFFER_ACCEPTED, label: 'Offer accepted' },
    ],
  },
  {
    label: 'Contracts',
    types: [
      { type: NOTIFICATION_TYPE.CONTRACT_CREATED, label: 'Contract created' },
      { type: NOTIFICATION_TYPE.CONTRACT_ACCEPTED, label: 'Contract accepted' },
      { type: NOTIFICATION_TYPE.WORK_STARTED, label: 'Work started' },
      { type: NOTIFICATION_TYPE.MILESTONE_SUBMITTED, label: 'Milestone submitted' },
      { type: NOTIFICATION_TYPE.MILESTONE_APPROVED, label: 'Milestone approved' },
      { type: NOTIFICATION_TYPE.REVISION_REQUESTED, label: 'Revision requested' },
      { type: NOTIFICATION_TYPE.WORK_COMPLETED, label: 'Work completed' },
      { type: NOTIFICATION_TYPE.COMPLETION_APPROVED, label: 'Completion approved' },
    ],
  },
  {
    label: 'Payments',
    types: [
      { type: NOTIFICATION_TYPE.PAYMENT_RECEIVED, label: 'Payment received' },
      { type: NOTIFICATION_TYPE.PAYMENT_RELEASED, label: 'Payment released' },
      { type: NOTIFICATION_TYPE.PAYMENT_FAILED, label: 'Payment failed' },
      {
        type: NOTIFICATION_TYPE.PAYMENT_AUTHENTICATION_REQUIRED,
        label: 'Bank authentication (3DS)',
      },
      { type: NOTIFICATION_TYPE.PAYOUT_SENT, label: 'Payout sent' },
    ],
  },
  {
    label: 'Messages',
    types: [
      { type: NOTIFICATION_TYPE.NEW_MESSAGE, label: 'New message' },
    ],
  },
  {
    label: 'Reviews',
    types: [
      { type: NOTIFICATION_TYPE.REVIEW_RECEIVED, label: 'Review received' },
      { type: NOTIFICATION_TYPE.REVIEW_REMINDER, label: 'Review reminder' },
    ],
  },
  {
    label: 'Trust & Safety',
    types: [
      { type: NOTIFICATION_TYPE.DISPUTE_OPENED, label: 'Dispute opened' },
      { type: NOTIFICATION_TYPE.DISPUTE_RESOLVED, label: 'Dispute resolved' },
      { type: NOTIFICATION_TYPE.TIER_UPGRADE, label: 'Tier upgrade' },
      { type: NOTIFICATION_TYPE.TIER_DOWNGRADE, label: 'Tier downgrade' },
    ],
  },
];

function buildPreferenceMap(preferences: NotificationPreference[]): Map<NotificationType, NotificationPreference> {
  const map = new Map<NotificationType, NotificationPreference>();
  for (const pref of preferences) {
    map.set(pref.notification_type, pref);
  }
  return map;
}

function getDefaultPreference(type: NotificationType): NotificationPreference {
  return {
    notification_type: type,
    push_enabled: true,
    email_enabled: true,
    sms_enabled: false,
    in_app_enabled: true,
  };
}

/** FR-17.3 — payment failures, disputes, guarantee, account flags cannot be disabled. */
function isCriticalNotificationType(type: string): boolean {
  const t = type.trim().toLowerCase();
  if (!t) return false;
  if (t === 'payment_failed') return true;
  if (t.startsWith('dispute_')) return true;
  if (t.includes('guarantee')) return true;
  if (t === 'account_flag' || t.startsWith('account_flag')) return true;
  return false;
}

function forceCriticalEnabled(pref: NotificationPreference): NotificationPreference {
  if (!isCriticalNotificationType(pref.notification_type)) return pref;
  return {
    ...pref,
    push_enabled: true,
    email_enabled: true,
    in_app_enabled: true,
  };
}

export default function NotificationPreferencesPage() {
  const { data, isLoading, isError } = useNotificationPreferences();
  const updatePreferences = useUpdatePreferences();

  const [preferenceMap, setPreferenceMap] = useState<Map<NotificationType, NotificationPreference>>(new Map());
  const [globalPush, setGlobalPush] = useState(true);
  const [globalEmail, setGlobalEmail] = useState(true);
  const [globalSms, setGlobalSms] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Sync server state into local state
  useEffect(() => {
    if (data) {
      setPreferenceMap(buildPreferenceMap(data.preferences));
      setGlobalPush(data.global_push_enabled);
      setGlobalEmail(data.global_email_enabled);
      setGlobalSms(data.global_sms_enabled);
      setIsDirty(false);
    }
  }, [data]);

  function getPreference(type: NotificationType): NotificationPreference {
    return preferenceMap.get(type) ?? getDefaultPreference(type);
  }

  function updatePref(type: NotificationType, field: keyof Omit<NotificationPreference, 'notification_type'>, value: boolean) {
    if (isCriticalNotificationType(type) && value === false) {
      // FR-17.3 — critical types stay on.
      return;
    }
    setPreferenceMap((prev) => {
      const next = new Map(prev);
      const current = next.get(type) ?? getDefaultPreference(type);
      next.set(type, { ...current, [field]: value });
      return next;
    });
    setIsDirty(true);
  }

  function handleSave() {
    const allPrefs: NotificationPreference[] = [];
    for (const category of PREFERENCE_CATEGORIES) {
      for (const item of category.types) {
        allPrefs.push(forceCriticalEnabled(getPreference(item.type)));
      }
    }

    void updatePreferences.mutateAsync({
      preferences: allPrefs,
      global_push_enabled: globalPush,
      global_email_enabled: globalEmail,
      global_sms_enabled: globalSms,
    }).then(() => {
      setIsDirty(false);
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Notification Preferences</h1>
          <p className="mt-1 text-zinc-300">
            Choose how and when you want to be notified. Payment failures, disputes, and
            guarantee alerts are required and cannot be turned off.
          </p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="glass glass-highlight border border-[var(--brand-gold)]/10">
              <CardContent className="py-6">
                <div className="space-y-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">Notification Preferences</h1>
        </div>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load notification preferences. Please try refreshing the page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="gold-text text-2xl font-bold tracking-tight">Notification Preferences</h1>
        <p className="mt-1 text-zinc-300">
          Choose how and when you want to be notified.
        </p>
      </div>

      {/* Global toggles */}
      <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
        <CardContent className="py-6">
          <h2 className="gold-text text-lg font-semibold">Global Settings</h2>
          <p className="mt-1 text-sm text-zinc-300">
            Master toggles for each notification channel. Disabling a channel here turns it off for all notification types.
          </p>
          <div className="mt-4 space-y-4">
            <div className="flex min-h-[44px] items-center justify-between">
              <div>
                <p className="text-sm font-medium">Email notifications</p>
                <p className="text-xs text-zinc-300">Receive notifications via email</p>
              </div>
              <Switch
                checked={globalEmail}
                onCheckedChange={(checked) => {
                  setGlobalEmail(checked);
                  setIsDirty(true);
                }}
                aria-label="Toggle email notifications globally"
              />
            </div>
            <div className="glass-divider" role="separator" />
            <div className="flex min-h-[44px] items-center justify-between">
              <div>
                <p className="text-sm font-medium">Push notifications</p>
                <p className="text-xs text-zinc-300">Receive push notifications on your device</p>
              </div>
              <Switch
                checked={globalPush}
                onCheckedChange={(checked) => {
                  setGlobalPush(checked);
                  setIsDirty(true);
                }}
                aria-label="Toggle push notifications globally"
              />
            </div>
            <div className="glass-divider" role="separator" />
            <div className="flex min-h-[44px] items-center justify-between">
              <div>
                <p className="text-sm font-medium">SMS notifications</p>
                <p className="text-xs text-zinc-300">Receive notifications via text message</p>
              </div>
              <Switch
                checked={globalSms}
                onCheckedChange={(checked) => {
                  setGlobalSms(checked);
                  setIsDirty(true);
                }}
                aria-label="Toggle SMS notifications globally"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-type preferences */}
      {PREFERENCE_CATEGORIES.map((category) => (
        <Card key={category.label} className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="py-6">
            <h2 className="gold-text text-lg font-semibold">{category.label}</h2>
            <div className="mt-4">
              {/* Column headers */}
              <div className="mb-3 hidden items-center gap-4 sm:flex">
                <div className="flex-1" />
                <div className="w-16 text-center text-xs font-medium text-zinc-300">In-App</div>
                <div className="w-16 text-center text-xs font-medium text-zinc-300">Email</div>
                <div className="w-16 text-center text-xs font-medium text-zinc-300">Push</div>
              </div>

              <div className="space-y-1">
                {category.types.map((item, idx) => {
                  const pref = getPreference(item.type);
                  const critical = isCriticalNotificationType(item.type);
                  return (
                    <div key={item.type}>
                      {idx > 0 ? <div className="glass-divider my-1" aria-hidden="true" /> : null}
                      <div className="flex min-h-[44px] flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-4">
                        <div className="flex flex-1 flex-col gap-0.5">
                          <p className="text-sm font-medium">
                            {item.label}
                            {critical ? (
                              <span className="ml-2 text-xs font-semibold text-[var(--brand-gold)]">
                                Required
                              </span>
                            ) : null}
                          </p>
                          {critical ? (
                            <p className="text-xs text-zinc-400">
                              Critical alert — cannot be turned off.
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-4">
                          {/* In-App: always on */}
                          <div className="flex w-16 flex-col items-center gap-1">
                            <span className="text-xs text-zinc-300 sm:hidden">In-App</span>
                            <Switch
                              checked={critical ? true : pref.in_app_enabled}
                              disabled
                              aria-label={`In-app notification for ${item.label}`}
                            />
                          </div>
                          {/* Email */}
                          <div className="flex w-16 flex-col items-center gap-1">
                            <span className="text-xs text-zinc-300 sm:hidden">Email</span>
                            <Switch
                              checked={critical ? true : pref.email_enabled && globalEmail}
                              disabled={critical || !globalEmail}
                              onCheckedChange={(checked) => { updatePref(item.type, 'email_enabled', checked); }}
                              aria-label={`Email notification for ${item.label}${critical ? ' (required)' : ''}`}
                            />
                          </div>
                          {/* Push */}
                          <div className="flex w-16 flex-col items-center gap-1">
                            <span className="text-xs text-zinc-300 sm:hidden">Push</span>
                            <Switch
                              checked={critical ? true : pref.push_enabled && globalPush}
                              disabled={critical || !globalPush}
                              onCheckedChange={(checked) => { updatePref(item.type, 'push_enabled', checked); }}
                              aria-label={`Push notification for ${item.label}${critical ? ' (required)' : ''}`}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Save button */}
      <div className="flex justify-end pb-8">
        <Button
          className="min-h-[44px]"
          onClick={handleSave}
          disabled={!isDirty || updatePreferences.isPending}
        >
          {updatePreferences.isPending ? 'Saving...' : 'Save preferences'}
        </Button>
      </div>
    </div>
  );
}
