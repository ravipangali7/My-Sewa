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
import {
  apiErrorFields,
  errorMessageFromUnknown,
  type ApiErrorFields,
  userFriendlyApiMessage,
} from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export { errorMessageFromUnknown, userFriendlyApiMessage, apiErrorFields } from "@/lib/api-errors";
export { toastApiError, toastApiMessage, apiErrorTitle } from "@/lib/api-errors";

type ErrorPopupProps = {
  open: boolean;
  title?: string;
  message: string;
  /** Structured Error / Message / HimaPay Response fields (values only when present). */
  details?: Pick<ApiErrorFields, "error" | "message" | "himapayResponseText"> | null;
  onClose: () => void;
};

function DetailBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "whitespace-pre-wrap wrap-break-word text-[14px] leading-relaxed text-foreground",
          mono && "rounded-lg bg-muted/60 p-2.5 font-mono text-[12px]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Mobile-friendly centered dialog for API / HimalPay errors. */
export function ErrorPopup({
  open,
  title,
  message,
  details,
  onClose,
}: ErrorPopupProps) {
  const t = useT();
  const errorValue = details?.error?.trim() || null;
  const messageValue = (details?.message || message || "").trim() || null;
  const himapayValue = details?.himapayResponseText?.trim() || null;
  const showStructured = Boolean(errorValue || himapayValue);

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent
        className={cn(
          "mx-4 w-[calc(100%-2rem)] max-w-md gap-4 rounded-2xl p-5 sm:mx-0 sm:w-full sm:p-6",
          "max-h-[85dvh] overflow-y-auto",
        )}
      >
        <AlertDialogHeader className="space-y-3 text-left">
          <AlertDialogTitle className="text-[17px] leading-snug text-destructive">
            {title || t("common.somethingWrong")}
          </AlertDialogTitle>
          {/* Keep a single description for a11y; structured blocks carry the real values. */}
          <AlertDialogDescription className="sr-only">
            {messageValue || title || t("common.somethingWrong")}
          </AlertDialogDescription>
          {showStructured ? (
            <div className="max-h-[50dvh] space-y-3 overflow-y-auto text-left">
              {errorValue ? <DetailBlock label="Error" value={errorValue} /> : null}
              {messageValue ? <DetailBlock label="Message" value={messageValue} /> : null}
              {himapayValue ? (
                <DetailBlock label="HimaPay Response" value={himapayValue} mono />
              ) : null}
            </div>
          ) : (
            <div
              className={cn(
                "whitespace-pre-wrap wrap-break-word text-[15px] leading-relaxed text-foreground",
                "max-h-[50dvh] overflow-y-auto",
              )}
            >
              {messageValue}
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-end">
          <AlertDialogAction
            className="h-11 w-full rounded-xl text-[16px] sm:w-auto sm:min-w-28"
            onClick={onClose}
          >
            {t("common.ok")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Hook: hold an error popup message and helpers. */
export function useErrorPopup(defaultTitle = "Something went wrong") {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [message, setMessage] = useState("");
  const [details, setDetails] = useState<ApiErrorFields | null>(null);

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
    const fields = apiErrorFields(err, opts?.fallback || errorMessageFromUnknown(err));
    setTitle(opts?.title || defaultTitle);
    setMessage(fields.message);
    setDetails(fields);
    setOpen(true);
  }

  function showMessage(text: string, opts?: { title?: string }) {
    const cleaned = userFriendlyApiMessage(text, text);
    setTitle(opts?.title || defaultTitle);
    setMessage(cleaned);
    setDetails({
      error: null,
      message: cleaned,
      himapayResponse: null,
      himapayResponseText: null,
    });
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  const popup = (
    <ErrorPopup
      open={open}
      title={title}
      message={message}
      details={details}
      onClose={close}
    />
  );

  return { showError, showMessage, close, popup, open };
}
