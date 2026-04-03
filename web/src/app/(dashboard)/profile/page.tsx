'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ProfileForm } from '@/components/forms/ProfileForm';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContentLoader } from '@/components/ui/content-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
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
      <PageTransition>
        <ContentLoader preset="profile" />
      </PageTransition>
    );
  }

  if (error || !user) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center p-12">
          <EmptyState
            icon={<AnimatedIllustration type="error" size="md" />}
            title="Failed to load profile"
            description="Something went wrong. Please try again."
          />
        </div>
      </PageTransition>
    );
  }

  const isProvider = user.roles.includes(USER_ROLE.PROVIDER);
  const isAdmin = user.roles.includes(USER_ROLE.ADMIN);

  async function handleBecomeProvider() {
    await enableRole.mutateAsync(USER_ROLE.PROVIDER);
    router.push('/provider/onboarding' as Route);
  }

  return (
    <PageTransition>
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="gold-text text-2xl font-bold tracking-tight">My Profile</h1>

      {editing ? (
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text">Edit Profile</CardTitle>
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
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16 ring-2 ring-[var(--brand-gold)]/20">
                {user.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt={user.displayName} />
                ) : null}
                <AvatarFallback className="text-lg">{getInitials(user.displayName)}</AvatarFallback>
              </Avatar>

              <div className="flex-1 space-y-1">
                <h2 className="text-xl font-semibold">{user.displayName}</h2>
                <p className="text-zinc-400 text-sm">{user.email}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {user.roles.map((role) => (
                    <Badge key={role} variant="secondary" className="glass-badge text-xs">
                      {role}
                    </Badge>
                  ))}
                  {user.emailVerified ? <Badge variant="outline" className="glass-badge text-xs">Email Verified</Badge> : null}
                </div>
              </div>
            </div>

            <div className="glass-divider my-6" aria-hidden="true" />

            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-zinc-400 text-sm font-medium">Member Since</dt>
                <dd className="text-sm">
                  {new Date(user.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400 text-sm font-medium">MFA</dt>
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
        <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
          <CardHeader>
            <CardTitle className="gold-text">Provider Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {providerProfile.businessName ? (
                <div>
                  <dt className="text-zinc-400 text-sm font-medium">Business Name</dt>
                  <dd className="text-sm">{providerProfile.businessName}</dd>
                </div>
              ) : null}
              {providerProfile.serviceCategories.length > 0 ? (
                <div>
                  <dt className="text-zinc-400 text-sm font-medium">Service Categories</dt>
                  <dd className="flex flex-wrap gap-1 pt-1">
                    {providerProfile.serviceCategories.map((cat) => (
                      <Badge key={cat.id} variant="outline" className="glass-badge text-xs">
                        {cat.name}
                      </Badge>
                    ))}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-zinc-400 text-sm font-medium">Service Radius</dt>
                <dd className="text-sm">{String(providerProfile.serviceRadiusKm)} km</dd>
              </div>
              <div>
                <dt className="text-zinc-400 text-sm font-medium">Jobs Completed</dt>
                <dd className="text-sm">{String(providerProfile.jobsCompleted)}</dd>
              </div>
              {providerProfile.onTimeRate !== null ? (
                <div>
                  <dt className="text-zinc-400 text-sm font-medium">On-Time Rate</dt>
                  <dd className="text-sm">{(providerProfile.onTimeRate * 100).toFixed(0)}%</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-zinc-400 text-sm font-medium">Stripe</dt>
                <dd className="text-sm">
                  {providerProfile.stripeOnboardingComplete ? 'Connected' : 'Not connected'}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400 text-sm font-medium">Profile Completeness</dt>
                <dd className="text-sm">{String(providerProfile.profileCompleteness)}%</dd>
              </div>
            </dl>
            {providerProfile.bio ? (
              <div className="mt-4">
                <p className="text-zinc-400 text-sm font-medium">Bio</p>
                <p className="mt-1 text-sm">{providerProfile.bio}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
    </PageTransition>
  );
}
