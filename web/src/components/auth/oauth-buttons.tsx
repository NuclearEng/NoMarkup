'use client';

import { Button } from '@/components/ui/button';
import { GoogleIcon, AppleIcon } from '@/components/auth/oauth-icons';

const GOOGLE_OAUTH_URL = '/api/v1/auth/oauth/google';
const APPLE_OAUTH_URL = '/api/v1/auth/oauth/apple';

export function OAuthButtons() {
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="outline"
        className="glass-button min-h-[44px] w-full border-white/10 text-white/80 transition-all duration-200 hover:scale-[1.01] hover:text-white active:scale-[0.99]"
        onClick={() => {
          window.location.href = GOOGLE_OAUTH_URL;
        }}
        type="button"
      >
        <GoogleIcon className="mr-2 h-5 w-5" />
        Continue with Google
      </Button>
      <Button
        variant="outline"
        className="glass-button min-h-[44px] w-full border-white/10 text-white/80 transition-all duration-200 hover:scale-[1.01] hover:text-white active:scale-[0.99]"
        onClick={() => {
          window.location.href = APPLE_OAUTH_URL;
        }}
        type="button"
      >
        <AppleIcon className="mr-2 h-5 w-5" />
        Continue with Apple
      </Button>
    </div>
  );
}

export function OAuthDivider() {
  return (
    <div className="relative my-4">
      <div className="absolute inset-0 flex items-center">
        <span className="glass-divider w-full" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-transparent px-2 text-white/40 backdrop-blur-sm">Or continue with email</span>
      </div>
    </div>
  );
}
