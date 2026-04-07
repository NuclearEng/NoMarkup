'use client';

import { useState } from 'react';

import { useParams } from 'next/navigation';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAdminUser, useBanUser, useSuspendUser } from '@/hooks/useAdmin';
import { USER_STATUS_CLASSES } from '@/lib/status-badge-classes';
import { cn } from '@/lib/utils';
import { USER_STATUS } from '@/types';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const userId = params.id as string;
  const { data, isLoading, isError } = useAdminUser(userId);
  const [actionType, setActionType] = useState<'suspend' | 'ban' | null>(null);
  const [reason, setReason] = useState('');

  const suspendMutation = useSuspendUser();
  const banMutation = useBanUser();

  const user = data?.user;

  async function handleConfirmAction() {
    if (!actionType || !userId) return;
    const mutation = actionType === 'suspend' ? suspendMutation : banMutation;
    await mutation.mutateAsync({ userId, reason });
    setActionType(null);
    setReason('');
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" className="h-4 w-56" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton variant="text" className="h-4 w-56" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-20" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton variant="text" className="h-3 w-20" />
                    <Skeleton variant="text" className="h-4 w-28" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton variant="text" className="h-3 w-20" />
                    <Skeleton variant="text" className="h-4 w-28" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: 'Admin', href: '/admin' },
            { label: 'Users', href: '/admin/users' },
            { label: 'Detail' },
          ]}
        />
        <h1 className="gold-text text-2xl font-bold tracking-tight">User Detail</h1>
        <EmptyState
          icon={<AnimatedIllustration type="error" size="sm" />}
          title="Failed to load user details"
          description="The user may not exist or you may not have permission."
        />
      </div>
    );
  }

  return (
    <PageTransition>
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: 'Admin', href: '/admin' },
          { label: 'Users', href: '/admin/users' },
          { label: user.display_name || user.email },
        ]}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">{user.display_name || user.email}</h1>
          <p className="text-zinc-300 mt-1">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={user.status === USER_STATUS.SUSPENDED}
            onClick={() => {
              setActionType('suspend');
            }}
            aria-label="Suspend this user"
          >
            Suspend
          </Button>
          <Button
            variant="destructive"
            className="min-h-[44px]"
            disabled={user.status === USER_STATUS.BANNED}
            onClick={() => {
              setActionType('ban');
            }}
            aria-label="Ban this user"
          >
            Ban
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Profile Info */}
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text text-base">User Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-zinc-300">Status</span>
                <div className="mt-1">
                  <Badge variant="outline" className={cn('text-xs', USER_STATUS_CLASSES[user.status])}>
                    {user.status}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-zinc-300">Roles</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {user.roles.map((role) => (
                    <Badge key={role} variant="outline" className="text-xs">
                      {role}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-zinc-300">Phone</span>
                <p className="mt-1">{user.phone || 'N/A'}</p>
              </div>
              <div>
                <span className="text-zinc-300">Email Verified</span>
                <p className="mt-1">{user.email_verified ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <span className="text-zinc-300">Phone Verified</span>
                <p className="mt-1">{user.phone_verified ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <span className="text-zinc-300">Joined</span>
                <p className="mt-1">{formatDate(user.created_at)}</p>
              </div>
              <div className="col-span-2">
                <span className="text-zinc-300">Last Login</span>
                <p className="mt-1">
                  {user.last_login_at ? formatDate(user.last_login_at) : 'Never'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Provider Profile (if applicable) */}
        {user.provider_profile ? (
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardHeader>
              <CardTitle className="gold-text text-base">Provider Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div className="col-span-2">
                  <span className="text-zinc-300">Display Name</span>
                  <p className="mt-1 font-medium">{user.provider_profile.display_name}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-zinc-300">Business Name</span>
                  <p className="mt-1">{user.provider_profile.business_name || 'N/A'}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-zinc-300">Bio</span>
                  <p className="mt-1 text-white/80">{user.provider_profile.bio || 'N/A'}</p>
                </div>

                <Separator className="col-span-2" />

                <div>
                  <span className="text-zinc-300">Trust Score</span>
                  <p className="mt-1 font-medium tabular-nums">
                    {user.provider_profile.trust_score !== undefined
                      ? (user.provider_profile.trust_score * 100).toFixed(0)
                      : 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-300">Trust Tier</span>
                  <p className="mt-1">{user.provider_profile.trust_tier ?? 'N/A'}</p>
                </div>
                <div>
                  <span className="text-zinc-300">Jobs Completed</span>
                  <p className="mt-1 tabular-nums">
                    {String(user.provider_profile.jobs_completed)}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-300">Avg Rating</span>
                  <p className="mt-1 tabular-nums">
                    {user.provider_profile.average_rating.toFixed(1)} (
                    {String(user.provider_profile.total_reviews)} reviews)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <ActionConfirmDialog
        open={actionType !== null}
        onClose={() => {
          setActionType(null);
          setReason('');
        }}
        onConfirm={() => {
          void handleConfirmAction();
        }}
        title={
          actionType === 'ban'
            ? `Ban ${user.display_name || user.email}`
            : `Suspend ${user.display_name || user.email}`
        }
        description={
          actionType === 'ban'
            ? 'This will permanently ban the user from the platform.'
            : 'This will temporarily suspend the user account.'
        }
        confirmLabel={actionType === 'ban' ? 'Ban User' : 'Suspend User'}
        destructive
        loading={suspendMutation.isPending || banMutation.isPending}
      >
        <div className="space-y-2">
          <label htmlFor="user-action-reason" className="text-sm font-medium">
            Reason
          </label>
          <Textarea
            id="user-action-reason"
            placeholder="Provide a reason for this action..."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            rows={3}
          />
        </div>
      </ActionConfirmDialog>
    </div>
    </PageTransition>
  );
}
