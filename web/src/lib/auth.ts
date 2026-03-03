export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  // Token is stored in HTTP-only cookie and sent automatically via credentials: 'include'
  // This function is for cases where we need the token explicitly (e.g., WebSocket auth)
  return null;
}

export function isAuthenticated(): boolean {
  // In a real implementation, check for a non-HTTP-only session indicator cookie
  return false;
}
