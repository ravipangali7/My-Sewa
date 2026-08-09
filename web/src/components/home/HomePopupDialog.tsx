import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import type { HomePopup } from "@/lib/types";

/**
 * Fetches the next eligible home popup for the signed-in user and shows it once
 * per home visit. Recording the view is server-side so the 24h cap is per user.
 */
export function HomePopupDialog() {
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<HomePopup | null>(null);
  const recordedForId = useRef<number | null>(null);

  const activeQuery = useQuery({
    queryKey: ["popups", "active"],
    queryFn: () => apiClient.activeHomePopup(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const shownMutation = useMutation({
    mutationFn: (id: number) => apiClient.recordHomePopupShown(id),
  });

  useEffect(() => {
    const next = activeQuery.data?.popup ?? null;
    if (!next) {
      setPopup(null);
      setOpen(false);
      return;
    }
    setPopup(next);
    setOpen(true);
    if (recordedForId.current !== next.id) {
      recordedForId.current = next.id;
      shownMutation.mutate(next.id);
    }
    // Intentionally omit shownMutation from deps — record once per fetched popup id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery.data?.popup?.id]);

  if (!popup) return null;

  const title = popup.title?.trim() || "Announcement";
  const body = popup.body?.trim() || "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto gap-3 p-4 sm:max-w-md">
        <DialogHeader className="space-y-2 text-left">
          {popup.title?.trim() ? (
            <DialogTitle className="text-lg leading-snug">{title}</DialogTitle>
          ) : (
            <DialogTitle className="sr-only">{title}</DialogTitle>
          )}
          {body ? (
            <DialogDescription className="whitespace-pre-wrap text-sm text-foreground/80">
              {body}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Home announcement</DialogDescription>
          )}
        </DialogHeader>
        {popup.image_url ? (
          <img
            src={popup.image_url}
            alt={title}
            className="max-h-[50vh] w-full rounded-md object-contain"
          />
        ) : null}
        <Button type="button" className="mt-1 w-full" onClick={() => setOpen(false)}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
