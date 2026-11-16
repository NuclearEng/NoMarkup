'use client';

import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { GoogleIcon, AppleIcon } from '@/components/auth/oauth-icons';
import { FacebookIcon } from '@/components/auth/FacebookOAuthButton';
import { safeInternalPath } from '@/lib/safe-internal-path';

const GOOGLE_OAUTH_URL = '/api/v1/auth/oauth/google';
const APPLE_OAUTH_URL = '/api/v1/auth/oauth/apple';
const FACEBOOK_OAUTH_URL = '/api/v1/auth/oauth/facebook';

/** Survives the OAuth round-trip; LoginForm reads this when `?next=` is gone. */
export const POST_LOGIN_NEXT_KEY = 'nomarkup:post_login_next';

function persistPostLoginNext(raw: string | null): void {
  const path = safeInternalPath(raw, '');
  if (path === '') return;
  try {
    sessionStorage.setItem(POST_LOGIN_NEXT_KEY, path);
  } catch {
    // sessionStorage can throw in private mode.
  }
}

export function OAuthButtons() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? searchParams.get('returnTo');

  function startOAuth(url: string): void {
    persistPostLoginNext(next);
    const path = safeInternalPath(next, '');
    window.location.href =
      path === '' ? url : `${url}?next=${encodeURIComponent(path)}`;
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="outline"
        className="min-h-[44px] w-full border border-white/10 bg-white/5 text-white/80 transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-[0.99]"
        onClick={() => {
          startOAuth(GOOGLE_OAUTH_URL);
        }}
        type="button"
      >
        <GoogleIcon className="mr-2 h-5 w-5" />
        Continue with Google
      </Button>
      <Button
        variant="outline"
        className="min-h-[44px] w-full border border-white/10 bg-white/5 text-white/80 transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-[0.99]"
        onClick={() => {
          startOAuth(APPLE_OAUTH_URL);
        }}
        type="button"
      >
        <AppleIcon className="mr-2 h-5 w-5" />
        Continue with Apple
      </Button>
      <Button
        variant="outline"
        className="min-h-[44px] w-full border border-white/10 bg-white/5 text-white/80 transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-[0.99]"
        onClick={() => {
          startOAuth(FACEBOOK_OAUTH_URL);
        }}
        type="button"
      >
        <FacebookIcon className="mr-2 h-5 w-5" />
        Continue with Facebook
      </Button>
    </div>
  );
}

export function OAuthDivider() {
  return (
    <div className="relative my-4">
      <div className="absolute inset-0 flex items-center">
        <span className="h-px w-full bg-white/10" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-transparent px-2 text-white/60 backdrop-blur-sm">
          Or continue with email
        </span>
      </div>
    </div>
  );
}
