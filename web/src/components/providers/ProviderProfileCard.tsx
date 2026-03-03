'use client';

import { Star } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { ProviderProfile, TrustTier } from '@/types';

const TRUST_TIER_LABELS: Record<TrustTier, string> = {
  under_review: 'Under Review',
  new: 'New',
  rising: 'Rising',
  trusted: 'Trusted',
  top_rated: 'Top Rated',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

interface ProviderProfileCardProps {
  profile: ProviderProfile;
  displayName: string;
  avatarUrl: string | null;
  trustTier?: TrustTier;
  averageRating?: number | null;
  verified?: boolean;
}

export function ProviderProfileCard({
  profile,
  displayName,
  avatarUrl,
  trustTier,
  averageRating,
  verified,
}: ProviderProfileCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-4">
          <Avatar className="h-14 w-14">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
            <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
          </Avatar>

          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{profile.businessName ?? displayName}</h3>
              {trustTier ? (
                <Badge variant="outline">{TRUST_TIER_LABELS[trustTier]}</Badge>
              ) : null}
              {verified ? <Badge variant="secondary">Verified</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">{displayName}</p>

            {averageRating != null ? (
              <div className="flex items-center gap-1" aria-label={`Rating: ${String(averageRating)} out of 5`}>
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    className={`h-4 w-4 ${
                      i < Math.round(averageRating)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-muted-foreground'
                    }`}
                    aria-hidden="true"
                  />
                ))}
                <span className="ml-1 text-sm text-muted-foreground">
                  ({profile.jobsCompleted} jobs)
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {profile.bio ? (
          <p className="mt-4 line-clamp-3 text-sm text-muted-foreground">{profile.bio}</p>
        ) : null}

        {profile.serviceCategories.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {profile.serviceCategories.slice(0, 5).map((cat) => (
              <Badge key={cat.id} variant="secondary" className="text-xs">
                {cat.name}
              </Badge>
            ))}
            {profile.serviceCategories.length > 5 ? (
              <Badge variant="secondary" className="text-xs">
                +{profile.serviceCategories.length - 5} more
              </Badge>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
