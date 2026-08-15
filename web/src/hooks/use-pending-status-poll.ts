import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { isLiveRefreshAllowed, LIVE_REFETCH_MS } from "@/lib/refresh";
import type { TranslateFn } from "@/lib/i18n";

type PendingLike = {
  merchant_txn_id?: string | null;
  status?: string | null;
};

export type PendingStatusCheckResult = {
  nextStatus?: string | null | undefined;
  message?: string | null | undefined;
};

export function toastPendingSettled(
  nextStatus: string,
  message: string | null | undefined,
  t: TranslateFn,
) {
  if (nextStatus === "success") {
    toast.success(t("live.statusSuccess"));
    return;
  }
  if (nextStatus === "failed") {
    toast.error(message || t("live.statusFailed"));
  }
}

/**
 * Asks the provider-status endpoint for in-flight payments, then invalidates
 * list/wallet queries when a row leaves `pending`. Pauses while hidden/offline
 * and does not restart when the same pending IDs are merely re-fetched.
 */
export function usePendingStatusPoll<T extends PendingLike>(
  items: T[] | undefined,
  check: (item: T) => Promise<PendingStatusCheckResult>,
  options: {
    invalidateKeys: QueryKey[];
    onSettled?: (item: T, nextStatus: string, message?: string | null | undefined) => void;
    maxItems?: number;
  },
) {
  const queryClient = useQueryClient();
  const checkRef = useRef(check);
  checkRef.current = check;
  const onSettledRef = useRef(options.onSettled);
  onSettledRef.current = options.onSettled;
  const keysRef = useRef(options.invalidateKeys);
  keysRef.current = options.invalidateKeys;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const maxItems = options.maxItems ?? 5;

  const pendingKey = (items ?? [])
    .filter((item) => item.status === "pending" && item.merchant_txn_id)
    .slice(0, maxItems)
    .map((item) => item.merchant_txn_id)
    .join("|");

  useEffect(() => {
    if (!pendingKey) return;

    let cancelled = false;
    let timer: number | null = null;

    const pendingItems = () =>
      (itemsRef.current ?? [])
        .filter((item) => item.status === "pending" && item.merchant_txn_id)
        .slice(0, maxItems);

    const poll = async () => {
      if (cancelled || !isLiveRefreshAllowed()) return;
      let changed = false;
      for (const item of pendingItems()) {
        try {
          const res = await checkRef.current(item);
          const next = res.nextStatus;
          if (next && next !== "pending" && next !== item.status) {
            changed = true;
            onSettledRef.current?.(item, next, res.message);
          }
        } catch {
          // ignore transient status errors while polling
        }
        if (cancelled) return;
      }
      if (changed && !cancelled) {
        for (const key of keysRef.current) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
    };

    const startTimer = () => {
      if (timer != null) window.clearInterval(timer);
      timer = window.setInterval(() => {
        void poll();
      }, LIVE_REFETCH_MS);
    };

    const stopTimer = () => {
      if (timer == null) return;
      window.clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void poll();
        startTimer();
      } else {
        stopTimer();
      }
    };

    void poll();
    if (document.visibilityState === "visible") startTimer();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pendingKey, queryClient, maxItems]);
}
