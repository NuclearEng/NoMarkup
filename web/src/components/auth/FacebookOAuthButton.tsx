'use client';

/**
 * FacebookOAuthButton — Continue with Facebook.
 *
 * Mirrors the styling + 44px touch-target rules used by oauth-buttons.tsx.
 * Clicking redirects to /api/v1/auth/oauth/facebook which is handled by
 * the gateway's OAuthHandler.InitFacebookOAuth — when FACEBOOK_CLIENT_ID
 * isn't configured server-side, the gateway redirects back to /login
 * with `?error=facebook_not_configured` so the UI degrades gracefully.
 */

import { Button } from '@/components/ui/button';

const FACEBOOK_OAUTH_URL = '/api/v1/auth/oauth/facebook';

interface FacebookOAuthButtonProps {
  className?: string;
}

export function FacebookOAuthButton({ className }: FacebookOAuthButtonProps) {
  return (
    <Button
      variant="outline"
      className={
        className ??
        'min-h-[44px] w-full border border-white/10 bg-white/5 text-white/80 transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-[0.99]'
      }
      onClick={() => {
        window.location.href = FACEBOOK_OAUTH_URL;
      }}
      type="button"
    >
      <FacebookIcon className="mr-2 h-5 w-5" />
      Continue with Facebook
    </Button>
  );
}

interface IconProps {
  className?: string;
}

export function FacebookIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.018 4.388 11.005 10.125 11.918v-8.43H7.078v-3.488h3.047V9.412c0-3.026 1.794-4.697 4.532-4.697 1.312 0 2.686.235 2.686.235v2.971h-1.514c-1.49 0-1.955.928-1.955 1.882v2.262h3.328l-.532 3.488h-2.796v8.43C19.612 23.078 24 18.091 24 12.073Z" />
    </svg>
  );
}
