'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ProfileForm } from '@/components/forms/ProfileForm';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useEnableRole, useProfile } from '@/hooks/useProfile';
import { USER_ROLE } from '@/types';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function ProfilePage() {
  const { data: user, isLoading, error } = useProfile();
  const enableRole = useEnableRole();
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12" role="status">
        <p className="text-muted-foreground">Loading profile...</p>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex items-center justify-center p-12" role="alert">
        <p className="text-destructive">Failed to load profile. Please try again.</p>
      </div>
    );
  }

  const isProvider = user.roles.includes(USER_ROLE.PROVIDER);

  async function handleBecomeProvider() {
    await enableRole.mutateAsync(USER_ROLE.PROVIDER);
    router.push('/provider/onboarding' as Route);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm
              user={user}
              onCancel={() => { setEditing(false); }}
              onSuccess={() => { setEditing(false); }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16">
                {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.displayName} /> : null}
                <AvatarFallback className="text-lg">
                  {getInitials(user.displayName)}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 space-y-1">
                <h2 className="text-xl font-semibold">{user.displayName}</h2>
                <p className="text-sm text-muted-foreground">{user.email}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {user.roles.map((role) => (
                    <Badge key={role} variant="secondary">
                      {role}
                    </Badge>
                  ))}
                  {user.emailVerified ? (
                    <Badge variant="outline">Email Verified</Badge>
                  ) : null}
                </div>
              </div>
            </div>

            <Separator className="my-6" />

            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Member Since</dt>
                <dd className="text-sm">
                  {new Date(user.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">MFA</dt>
                <dd className="text-sm">{user.mfaEnabled ? 'Enabled' : 'Disabled'}</dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => { setEditing(true); }} className="min-h-[44px]">
                Edit Profile
              </Button>

              {!isProvider ? (
                <Button
                  variant="outline"
                  onClick={() => void handleBecomeProvider()}
                  disabled={enableRole.isPending}
                  className="min-h-[44px]"
                >
                  {enableRole.isPending ? 'Setting up...' : 'Become a Provider'}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
