import type { QueryClient } from "@tanstack/react-query";

/** How often authenticated live data re-fetches while the app is open. */
export const LIVE_REFETCH_MS = 10_000;

/** Feature flags / maintenance / branding — slower than txn status. */
export const SETTINGS_REFETCH_MS = 30_000;

/** Ignore overlapping focus + visibility + resume signals. */
const RESUME_DEDUP_MS = 2_000;

export const LIVE_REFRESH_EVENT = "mysewa-data-refresh";

/**
 * True when it is safe to hit the API for background live updates.
 * Polling pauses in hidden tabs and while the browser reports offline.
 */
export function isLiveRefreshAllowed(): boolean {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }
  return true;
}

export function liveRefetchInterval(ms: number = LIVE_REFETCH_MS): number | false {
  return isLiveRefreshAllowed() ? ms : false;
}

/** Spread into useQuery for balances, lists, and status-bearing screens. */
export function liveQueryOptions(intervalMs: number = LIVE_REFETCH_MS) {
  return {
    refetchInterval: () => liveRefetchInterval(intervalMs),
    refetchIntervalInBackground: false as const,
    refetchOnWindowFocus: true as const,
    refetchOnReconnect: true as const,
  };
}

/** Admin queues / ledgers: always refetch on navigation, then keep live. */
export function adminLiveQueryOptions(intervalMs: number = LIVE_REFETCH_MS) {
  return {
    ...liveQueryOptions(intervalMs),
    refetchOnMount: "always" as const,
  };
}

/** Public settings (feature flags, maintenance). Do not use on admin edit forms. */
export function settingsQueryOptions() {
  return {
    staleTime: SETTINGS_REFETCH_MS,
    ...liveQueryOptions(SETTINGS_REFETCH_MS),
  };
}

/** Ask the root live-refresh listener to refetch active queries. */
export function notifyLiveRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LIVE_REFRESH_EVENT));
}

let refreshInFlight: Promise<void> | null = null;
let lastRefreshAt = 0;

/**
 * Re-fetch currently mounted queries. Pull-to-refresh uses `force` so a
 * manual gesture always runs; resume/push events are deduped.
 */
export async function refreshAppData(
  queryClient: QueryClient,
  options?: { force?: boolean },
): Promise<void> {
  const force = options?.force === true;
  if (!force && !isLiveRefreshAllowed()) return;

  const now = Date.now();
  if (refreshInFlight && now - lastRefreshAt < RESUME_DEDUP_MS) {
    return refreshInFlight;
  }
  if (!force && now - lastRefreshAt < RESUME_DEDUP_MS) return;

  lastRefreshAt = now;
  const run = queryClient
    .refetchQueries(force ? { type: "active" } : { type: "active", stale: true })
    .then(() => undefined);
  refreshInFlight = run;
  try {
    await run;
  } finally {
    if (refreshInFlight === run) refreshInFlight = null;
  }
}
