import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LIVE_REFRESH_EVENT, refreshAppData } from "@/lib/refresh";

/**
 * Force-refetch active queries for cases React Query does not cover:
 * Flutter WebView resume, bfcache restore, and explicit data-refresh
 * events (foreground push). Window-focus and reconnect stay on the
 * QueryClient defaults so those paths are not doubled.
 */
export function useLiveRefresh() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const hardRefresh = () => {
      void refreshAppData(queryClient, { force: true });
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) hardRefresh();
    };

    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("mysewa-app-resume", hardRefresh);
    window.addEventListener(LIVE_REFRESH_EVENT, hardRefresh);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("mysewa-app-resume", hardRefresh);
      window.removeEventListener(LIVE_REFRESH_EVENT, hardRefresh);
    };
  }, [queryClient]);
}
