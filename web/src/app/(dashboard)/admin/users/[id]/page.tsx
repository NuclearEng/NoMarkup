'use client';

import { useState } from 'react';

import { useParams } from 'next/navigation';

import { ActionConfirmDialog } from '@/components/admin/ActionConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useAdminUser, useBanUser, useSuspendUser } from '@/hooks/useAdmin';
import { cn } from '@/lib/utils';
import type { UserStatus } from '@/types';
import { USER_STATUS } from '@/types';

const STATUS_CLASSES: Record<UserStatus, string> = {
  active: 'bg-green-100 text-green-800 border-green-200',
  suspended: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  banned: 'bg-red-100 text-red-800 border-red-200',
  deactivated: 'bg-gray-100 text-gray-800 border-gray-200',
};

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
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-4 pt-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">User Detail</h1>
        <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load user details. The user may not exist or you may not have permission.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {user.first_name} {user.last_name}
          </h1>
          <p className="mt-1 text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={user.status === USER_STATUS.SUSPENDED}
            onClick={() => { setActionType('suspend'); }}
            aria-label="Suspend this user"
          >
            Suspend
          </Button>
          <Button
            variant="destructive"
            className="min-h-[44px]"
            disabled={user.status === USER_STATUS.BANNED}
            onClick={() => { setActionType('ban'); }}
            aria-label="Ban this user"
          >
            Ban
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Profile Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Status</span>
                <div className="mt-1">
                  <Badge
                    variant="outline"
                    className={cn('text-xs', STATUS_CLASSES[user.status])}
                  >
                    {user.status}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Roles</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {user.roles.map((role) => (
                    <Badge key={role} variant="outline" className="text-xs">
                      {role}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Phone</span>
                <p className="mt-1">{user.phone || 'N/A'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Email Verified</span>
                <p className="mt-1">{user.email_verified ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Phone Verified</span>
                <p className="mt-1">{user.phone_verified ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Joined</span>
                <p className="mt-1">{formatDate(user.created_at)}</p>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Last Login</span>
                <p className="mt-1">
                  {user.last_login_at ? formatDate(user.last_login_at) : 'Never'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Provider Profile (if applicable) */}
        {user.provider_profile ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provider Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="col-span-2">
                  <span className="text-muted-foreground">Display Name</span>
                  <p className="mt-1 font-medium">
                    {user.provider_profile.display_name}
                  </p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Business Name</span>
                  <p className="mt-1">
                    {user.provider_profile.business_name || 'N/A'}
                  </p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Bio</span>
                  <p className="mt-1 text-muted-foreground">
                    {user.provider_profile.bio || 'N/A'}
                  </p>
                </div>

                <Separator className="col-span-2" />

                <div>
                  <span className="text-muted-foreground">Trust Score</span>
                  <p className="mt-1 font-medium tabular-nums">
                    {user.provider_profile.trust_score !== undefined
                      ? (user.provider_profile.trust_score * 100).toFixed(0)
                      : 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Trust Tier</span>
                  <p className="mt-1">
                    {user.provider_profile.trust_tier ?? 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Jobs Completed</span>
                  <p className="mt-1 tabular-nums">
                    {String(user.provider_profile.jobs_completed)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Avg Rating</span>
                  <p className="mt-1 tabular-nums">
                    {user.provider_profile.average_rating.toFixed(1)} ({String(user.provider_profile.total_reviews)} reviews)
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
        onConfirm={() => { void handleConfirmAction(); }}
        title={
          actionType === 'ban'
            ? `Ban ${user.first_name} ${user.last_name}`
            : `Suspend ${user.first_name} ${user.last_name}`
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
            onChange={(e) => { setReason(e.target.value); }}
            rows={3}
          />
        </div>
      </ActionConfirmDialog>
    </div>
  );
}
