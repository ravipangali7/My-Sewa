import type { QueryClient } from "@tanstack/react-query";

/** How often authenticated live data re-fetches while the app is open. */
export const LIVE_REFETCH_MS = 10_000;

/**
 * Invalidate every cached query so the current page (and auth/wallet)
 * re-fetches from the API. Used by pull-to-refresh and app-resume.
 */
export async function refreshAppData(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries();
}
