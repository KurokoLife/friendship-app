import type { PostHogEventProperties } from '@posthog/core';
import PostHog from 'posthog-react-native';

// Minimal analytics scaffolding (2026-08-01). Recommendation: PostHog,
// see PROGRESS.md's session entry for the full reasoning (open-source/
// self-hostable if this app ever wants to move its data off a third
// party entirely, matching AGENTS.md's own "transparency always" and
// "behavioral tracking... disclosed at onboarding" stance more
// comfortably than a closed-platform vendor would; EU hosting option
// matters given how sensitive this app's real data is, life transitions
// like bereavement/divorce, not just generic product-usage events; and a
// real self-hosted or EU-hosted hosting path exists if that's ever
// decided, rather than a one-way commitment to a US-only SaaS).
//
// Deliberately a thin wrapper, not a full event taxonomy: this is
// scaffolding for future instrumentation, not a retroactive analytics
// overhaul of every screen in the app. No-ops completely (every call
// becomes a harmless void) when EXPO_PUBLIC_POSTHOG_API_KEY isn't set,
// matching this codebase's own established `isSupabaseConfigured`
// graceful-degradation convention, so a project with no key configured
// (this one, today) behaves identically to before this file existed.

const API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

let client: PostHog | null = null;

export function initAnalytics(): void {
  if (!API_KEY || client) return;
  client = new PostHog(API_KEY, { host: HOST });
}

export function track(event: string, properties?: PostHogEventProperties): void {
  client?.capture(event, properties);
}

export function identifyUser(userId: string): void {
  client?.identify(userId);
}

export function resetAnalyticsIdentity(): void {
  client?.reset();
}
