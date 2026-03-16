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
import { useProviderProfile } from '@/hooks/useProviderProfile';
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
  const isProviderRole = user?.roles.includes(USER_ROLE.PROVIDER) ?? false;
  const { data: providerProfile } = useProviderProfile();

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
  const isAdmin = user.roles.includes(USER_ROLE.ADMIN);

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
              onCancel={() => {
                setEditing(false);
              }}
              onSuccess={() => {
                setEditing(false);
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16">
                {user.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt={user.displayName} />
                ) : null}
                <AvatarFallback className="text-lg">{getInitials(user.displayName)}</AvatarFallback>
              </Avatar>

              <div className="flex-1 space-y-1">
                <h2 className="text-xl font-semibold">{user.displayName}</h2>
                <p className="text-muted-foreground text-sm">{user.email}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {user.roles.map((role) => (
                    <Badge key={role} variant="secondary">
                      {role}
                    </Badge>
                  ))}
                  {user.emailVerified ? <Badge variant="outline">Email Verified</Badge> : null}
                </div>
              </div>
            </div>

            <Separator className="my-6" />

            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-sm font-medium">Member Since</dt>
                <dd className="text-sm">
                  {new Date(user.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-sm font-medium">MFA</dt>
                <dd className="text-sm">{user.mfaEnabled ? 'Enabled' : 'Disabled'}</dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  setEditing(true);
                }}
                className="min-h-[44px]"
              >
                Edit Profile
              </Button>

              {!isProvider && !isAdmin ? (
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

      {/* Provider business info */}
      {isProvider && providerProfile ? (
        <Card>
          <CardHeader>
            <CardTitle>Provider Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {providerProfile.businessName ? (
                <div>
                  <dt className="text-muted-foreground text-sm font-medium">Business Name</dt>
                  <dd className="text-sm">{providerProfile.businessName}</dd>
                </div>
              ) : null}
              {providerProfile.serviceCategories.length > 0 ? (
                <div>
                  <dt className="text-muted-foreground text-sm font-medium">Service Categories</dt>
                  <dd className="flex flex-wrap gap-1 pt-1">
                    {providerProfile.serviceCategories.map((cat) => (
                      <Badge key={cat.id} variant="outline">
                        {cat.name}
                      </Badge>
                    ))}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground text-sm font-medium">Service Radius</dt>
                <dd className="text-sm">{String(providerProfile.serviceRadiusKm)} km</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-sm font-medium">Jobs Completed</dt>
                <dd className="text-sm">{String(providerProfile.jobsCompleted)}</dd>
              </div>
              {providerProfile.onTimeRate !== null ? (
                <div>
                  <dt className="text-muted-foreground text-sm font-medium">On-Time Rate</dt>
                  <dd className="text-sm">{(providerProfile.onTimeRate * 100).toFixed(0)}%</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground text-sm font-medium">Stripe</dt>
                <dd className="text-sm">
                  {providerProfile.stripeOnboardingComplete ? 'Connected' : 'Not connected'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-sm font-medium">Profile Completeness</dt>
                <dd className="text-sm">{String(providerProfile.profileCompleteness)}%</dd>
              </div>
            </dl>
            {providerProfile.bio ? (
              <div className="mt-4">
                <p className="text-muted-foreground text-sm font-medium">Bio</p>
                <p className="mt-1 text-sm">{providerProfile.bio}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
