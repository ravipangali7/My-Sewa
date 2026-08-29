import { useEffect, useState } from "react";
import {
  Check,
  CheckCheck,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  authorizedObjectUrl,
  downloadAuthorizedAttachment,
  supportChatAttachmentPath,
} from "@/lib/support-chat-media";
import type { SupportChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

function FileGlyph({ kind }: { kind: string }) {
  if (kind === "image") return <ImageIcon className="size-5 shrink-0" />;
  if (kind === "video") return <Film className="size-5 shrink-0" />;
  return <FileText className="size-5 shrink-0" />;
}

function AuthorizedImage({ path, alt, onOpen }: { path: string; alt: string; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void authorizedObjectUrl(path).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!src) {
    return (
      <div className="flex h-40 w-56 items-center justify-center rounded-xl bg-black/10">
        <Loader2 className="size-5 animate-spin opacity-70" />
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="block overflow-hidden rounded-xl">
      <img src={src} alt={alt} className="max-h-60 max-w-full object-cover" />
    </button>
  );
}

function AuthorizedVideo({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void authorizedObjectUrl(path).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!src) {
    return (
      <div className="flex h-40 w-56 items-center justify-center rounded-xl bg-black/10">
        <Loader2 className="size-5 animate-spin opacity-70" />
      </div>
    );
  }
  return (
    <video src={src} controls playsInline className="max-h-60 w-full rounded-xl bg-black" />
  );
}

export function SupportChatMessageBubble({
  message,
  mine,
}: {
  message: SupportChatMessage;
  mine: boolean;
}) {
  const t = useT();
  const [lightbox, setLightbox] = useState(false);
  const kind = message.kind || (message.has_attachment ? "file" : "text");
  const path = message.attachment_url || (
    message.has_attachment
      ? supportChatAttachmentPath(message.thread, message.id)
      : null
  );
  const downloadPath = path
    ? (path.includes("?") ? `${path}&download=1` : `${path}?download=1`)
    : null;
  const filename = message.attachment_name || t("chat.file");
  const mime = message.attachment_content_type || "application/octet-stream";

  const save = () => {
    if (!downloadPath) return;
    void downloadAuthorizedAttachment(downloadPath, filename, mime).catch(() => undefined);
  };

  return (
    <>
      <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm",
            mine
              ? "rounded-br-md bg-brand text-primary-foreground"
              : "rounded-bl-md bg-background text-foreground",
          )}
        >
          {!mine && message.sender_display_name ? (
            <p className="mb-1 text-[11px] font-semibold text-brand">
              {message.sender_is_support ? "Super Admin" : message.sender_display_name}
            </p>
          ) : null}
          {kind === "image" && path ? (
            <AuthorizedImage path={path} alt={filename} onOpen={() => setLightbox(true)} />
          ) : null}
          {kind === "video" && path ? <AuthorizedVideo path={path} /> : null}
          {kind === "file" && message.has_attachment ? (
            <div className="flex items-start gap-2 rounded-xl bg-black/10 px-2.5 py-2">
              <FileGlyph kind={kind} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{filename}</p>
                <p className={cn("text-[11px]", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {(filename.split(".").pop() || "FILE").toUpperCase()}
                  {message.attachment_size ? ` · ${formatBytes(message.attachment_size)}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={save}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-black/10"
                aria-label={t("chat.download")}
              >
                <Download className="size-4" />
              </button>
            </div>
          ) : null}
          {message.body ? (
            <p className={cn("whitespace-pre-wrap break-words", message.has_attachment ? "mt-1.5" : "")}>
              {message.body}
            </p>
          ) : null}
          {(kind === "image" || kind === "video") && path ? (
            <button
              type="button"
              onClick={save}
              className={cn(
                "mt-1.5 inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline",
                mine ? "text-primary-foreground/85" : "text-muted-foreground",
              )}
            >
              <Download className="size-3" />
              {t("chat.save")}
            </button>
          ) : null}
          <p
            className={cn(
              "mt-1 flex items-center gap-1 text-[10px]",
              mine ? "text-primary-foreground/80" : "text-muted-foreground",
            )}
          >
            <span>{formatDateTime(message.created_at)}</span>
            {mine ? (
              message.is_read ? (
                <CheckCheck className="size-3" aria-label={t("chat.read")} />
              ) : (
                <Check className="size-3" aria-label={t("chat.sent")} />
              )
            ) : null}
          </p>
        </div>
      </div>
      <Dialog open={lightbox} onOpenChange={setLightbox}>
        <DialogContent className="max-w-[min(96vw,42rem)] border-none bg-black p-2 text-white sm:rounded-xl">
          <DialogTitle className="sr-only">{filename}</DialogTitle>
          {path ? <LightboxImage path={path} alt={filename} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function LightboxImage({ path, alt }: { path: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void authorizedObjectUrl(path).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!src) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }
  return <img src={src} alt={alt} className="max-h-[80vh] w-full object-contain" />;
}
