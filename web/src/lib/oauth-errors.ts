/**
 * Maps gateway OAuth callback / init `?error=` query codes to user-facing copy.
 *
 * Gateway redirects to `/login?error=<code>` (or `/register?error=<code>` via
 * the same codes) when a provider rejects the flow or is not configured.
 * Codes come from Init*OAuth guards and *OAuthCallback handlers in
 * gateway/internal/handler/oauth*.go.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  google_not_configured:
    'Google sign-in is not configured on this server. Use email, or ask an admin to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
  facebook_not_configured:
    'Facebook sign-in is not configured on this server. Use email, or ask an admin to set FACEBOOK_CLIENT_ID and FACEBOOK_CLIENT_SECRET.',
  apple_not_configured:
    'Apple sign-in is not configured on this server. Use email, or ask an admin to set APPLE_CLIENT_ID and APPLE_CLIENT_SECRET.',
  invalid_state: 'Sign-in session expired or was invalid. Please try again.',
  missing_code: 'Sign-in was cancelled or incomplete. Please try again.',
  exchange_failed: 'Could not complete sign-in with the provider. Please try again.',
  missing_id_token: 'Could not verify your identity with the provider. Please try again.',
  oauth_invalid_signature:
    'Could not verify the sign-in token from the provider. Please try again.',
  email_not_verified:
    'Your email is not verified with that provider. Verify it there, then try again.',
  userinfo_failed: 'Could not load your profile from the provider. Please try again.',
  decode_failed: 'Could not read your profile from the provider. Please try again.',
  auth_failed: 'Could not create or link your account. Please try again or use email.',
  access_denied: 'Sign-in was cancelled. You can try again or use email.',
  // Generic provider rejections often pass through as-is from Google/Facebook.
  invalid_request: 'The sign-in request was invalid. Please try again.',
  server_error: 'The sign-in provider had a temporary error. Please try again.',
  temporarily_unavailable:
    'The sign-in provider is temporarily unavailable. Please try again shortly.',
};

/**
 * Resolve a user-visible message for an OAuth `error` query parameter.
 * Returns null when the code is empty/unknown so the form can stay quiet.
 */
export function messageForOAuthError(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.trim().toLowerCase();
  if (!normalized) return null;

  const known = OAUTH_ERROR_MESSAGES[normalized];
  if (known) return known;

  // Provider-specific not_configured patterns (future-proof).
  if (normalized.endsWith('_not_configured')) {
    const provider = normalized.replace(/_not_configured$/, '');
    const label = provider.charAt(0).toUpperCase() + provider.slice(1);
    return `${label} sign-in is not configured on this server. Use email instead.`;
  }

  return `Could not connect with the sign-in provider (${normalized}). Try again or use email.`;
}
