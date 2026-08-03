import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

type ErrorPopupProps = {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
};

/** Mobile-friendly centered dialog for API / HimalPay errors. */
export function ErrorPopup({
  open,
  title,
  message,
  onClose,
}: ErrorPopupProps) {
  const t = useT();
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent
        className={cn(
          "mx-4 w-[calc(100%-2rem)] max-w-md gap-4 rounded-2xl p-5 sm:mx-0 sm:w-full sm:p-6",
          "max-h-[85dvh] overflow-y-auto",
        )}
      >
        <AlertDialogHeader className="space-y-2 text-left">
          <AlertDialogTitle className="text-[17px] leading-snug text-destructive">
            {title || t("common.somethingWrong")}
          </AlertDialogTitle>
          <AlertDialogDescription
            className={cn(
              "whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground",
              "max-h-[50dvh] overflow-y-auto",
            )}
          >
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-end">
          <AlertDialogAction
            className="h-11 w-full rounded-xl text-[16px] sm:w-auto sm:min-w-[7rem]"
            onClick={onClose}
          >
            {t("common.ok")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function errorMessageFromUnknown(err: unknown, fallback = "Request failed"): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

/** Hook: hold an error popup message and helpers. */
export function useErrorPopup(defaultTitle = "Something went wrong") {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    // Keep focus inside dialog on mobile soft keyboards
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function showError(err: unknown, opts?: { title?: string; fallback?: string }) {
    setTitle(opts?.title || defaultTitle);
    setMessage(errorMessageFromUnknown(err, opts?.fallback || "Request failed"));
    setOpen(true);
  }

  function showMessage(text: string, opts?: { title?: string }) {
    setTitle(opts?.title || defaultTitle);
    setMessage(text);
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  const popup = (
    <ErrorPopup open={open} title={title} message={message} onClose={close} />
  );

  return { showError, showMessage, close, popup, open };
}
