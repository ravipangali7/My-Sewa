import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshAppData } from "@/lib/refresh";

/**
 * Re-fetches all queries when the app/tab becomes visible again
 * (WebView resume, browser tab focus, or Flutter lifecycle bridge).
 */
export function useLiveRefresh() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = () => {
      void refreshAppData(queryClient);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    const onFocus = () => refresh();
    const onResume = () => refresh();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("mysewa-app-resume", onResume);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("mysewa-app-resume", onResume);
    };
  }, [queryClient]);
}
