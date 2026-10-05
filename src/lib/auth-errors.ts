// Friendly sign-in errors (docs/DECISIONS.md, onboarding screen 2). The raw
// Supabase/Twilio text ("Invalid 'To' Phone Number", "Token has expired or
// is invalid") is never shown to people.

type AuthLikeError = { message?: string; status?: number; code?: string } | null | undefined;

function isRateLimited(error: AuthLikeError): boolean {
  const message = (error?.message ?? '').toLowerCase();
  return error?.status === 429 || message.includes('rate limit') || message.includes('too many');
}

export function friendlySendCodeError(error: AuthLikeError): string {
  if (isRateLimited(error)) {
    return 'Too many tries in a short time. Wait a minute, then try again.';
  }
  return "We couldn't send a code to that number. Check it and try again.";
}

export function friendlyVerifyCodeError(error: AuthLikeError): string {
  if (isRateLimited(error)) {
    return 'Too many tries in a short time. Wait a minute, then try again.';
  }
  return "That code didn't work. Check it, or tap Resend code for a new one.";
}

export const FRIENDLY_SAVE_ERROR = 'Something went wrong saving that. Try again.';
