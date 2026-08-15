import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, ImageIcon, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { CopyableField } from "@/components/CopyableField";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { buildMySewaAccountQr } from "@/lib/bank-qr";
import { toDataURL as qrToDataURL } from "@/lib/qrcode";
import { useT } from "@/lib/i18n";
import jsQR from "@/lib/jsqr";
import {
  hasNativeFileBridge,
  isMySewaNativeApp,
  waitForNativeCameraPermission,
  waitForNativeFileBridge,
} from "@/lib/native-app";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { cn } from "@/lib/utils";

type ScannerTab = "scanner" | "share";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function getBarcodeDetector(): BarcodeDetectorLike | null {
  const Ctor = (
    window as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

function decodeWithJsQr(image: ImageData): string | null {
  const code = jsQR(image.data, image.width, image.height, {
    inversionAttempts: "attemptBoth",
  });
  return code?.data?.trim() || null;
}

async function decodeFromImageSource(source: CanvasImageSource, width: number, height: number) {
  if (width < 8 || height < 8) return null;
  const canvas = document.createElement("canvas");
  const maxW = 720;
  const scale = width > maxW ? maxW / width : 1;
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return decodeWithJsQr(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

async function decodeFromFile(file: File): Promise<string | null> {
  const detector = getBarcodeDetector();
  if (detector) {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const codes = await detector.detect(bitmap);
        const raw = codes[0]?.rawValue?.trim();
        if (raw) return raw;
      } finally {
        bitmap.close();
      }
    } catch {
      /* fall through to jsqr */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image"));
      el.src = url;
    });
    return decodeFromImageSource(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

function dataUrlBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function sendPngViaNative(dataUrl: string, filename: string, type: "share" | "download"): boolean {
  if (!hasNativeFileBridge()) return false;
  const payload = {
    type,
    filename,
    mime: "image/png",
    base64: dataUrlBase64(dataUrl),
  };
  try {
    if (window.MySewaNative?.downloadFile?.(payload)) return true;
  } catch {
    /* fall through */
  }
  try {
    if (window.MySewaBridge?.postMessage) {
      window.MySewaBridge.postMessage(JSON.stringify(payload));
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function triggerPngDownload(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function BankQrScanner({
  open,
  onOpenChange,
  onScan,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (raw: string) => boolean | void;
  children?: ReactNode;
}) {
  const t = useT();
  const { user } = useAuth();
  const { logoUrl } = useSiteBranding();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const handledRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef(0);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, dx: 0, locked: null as null | "x" | "y" });
  const [tab, setTab] = useState<ScannerTab>("scanner");
  const [page, setPage] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [sharing, setSharing] = useState(false);

  const accountName =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() ||
    (user?.nickname || "").trim() ||
    (user?.business_name || "").trim() ||
    t("profile.fallbackName");
  const accountNumber = (user?.phone || "").replace(/\D/g, "") || user?.phone || "";
  const brandName = "MySewa";
  const qrPayload = useMemo(
    () =>
      accountNumber
        ? buildMySewaAccountQr({ accountName, accountNumber })
        : "",
    [accountName, accountNumber],
  );

  const goToPage = useCallback((next: number) => {
    const clamped = next < 0 ? 0 : next > 1 ? 1 : next;
    pageRef.current = clamped;
    setPage(clamped);
    setDragX(0);
  }, []);

  const emit = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value || handledRef.current) return;
      handledRef.current = true;
      const ok = onScan(value);
      if (ok === false) {
        handledRef.current = false;
        return;
      }
      goToPage(1);
    },
    [goToPage, onScan],
  );

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setScanning(false);
  }, []);

  useEffect(() => {
    if (!open) {
      setTab("scanner");
      setPage(0);
      setDragX(0);
      handledRef.current = false;
      pageRef.current = 0;
      setCameraError(false);
      stopCamera();
      return;
    }
    handledRef.current = false;
    pageRef.current = 0;
    setPage(0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, stopCamera]);

  const scannerActive = open && tab === "scanner" && page === 0;

  useEffect(() => {
    if (!scannerActive) {
      handledRef.current = false;
      setCameraError(false);
      stopCamera();
      return;
    }

    handledRef.current = false;
    detectorRef.current = getBarcodeDetector();
    let cancelled = false;

    const loop = async () => {
      if (cancelled || handledRef.current) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        const detector = detectorRef.current;
        if (detector) {
          try {
            const codes = await detector.detect(video);
            const raw = codes[0]?.rawValue?.trim();
            if (raw) {
              emit(raw);
              return;
            }
          } catch {
            detectorRef.current = null;
          }
        } else {
          const raw = await decodeFromImageSource(
            video,
            video.videoWidth,
            video.videoHeight,
          );
          if (raw) {
            emit(raw);
            return;
          }
        }
      }
      rafRef.current = requestAnimationFrame(() => {
        void loop();
      });
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(true);
        return;
      }
      setCameraError(false);
      setScanning(true);
      try {
        await waitForNativeCameraPermission();
        if (cancelled) return;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        void loop();
      } catch {
        if (!cancelled) {
          setCameraError(true);
          setScanning(false);
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [emit, scannerActive, stopCamera]);

  useEffect(() => {
    if (!open || !qrPayload) {
      setQrDataUrl("");
      return;
    }
    try {
      setQrDataUrl(qrToDataURL(qrPayload, { width: 512 }));
    } catch {
      setQrDataUrl("");
    }
  }, [open, qrPayload]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const raw = await decodeFromFile(file);
    if (raw) {
      emit(raw);
      return;
    }
    setCameraError(true);
    toast.error(t("transfer.qrInvalid"));
  }

  function onPointerDown(event: TouchEvent | MouseEvent) {
    const point = "touches" in event ? event.touches[0] : event;
    if (!point) return;
    dragRef.current = {
      active: true,
      startX: point.clientX,
      startY: point.clientY,
      dx: 0,
      locked: null,
    };
  }

  function onPointerMove(event: TouchEvent | MouseEvent) {
    const drag = dragRef.current;
    if (!drag.active) return;
    const point = "touches" in event ? event.touches[0] : event;
    if (!point) return;
    const dx = point.clientX - drag.startX;
    const dy = point.clientY - drag.startY;
    if (!drag.locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      drag.locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (drag.locked !== "x") return;
    if ("touches" in event) event.preventDefault();
    const width = pagerRef.current?.clientWidth || window.innerWidth;
    let next = dx;
    if (page === 0 && next > 0) next *= 0.25;
    if (page === 1 && next < 0) next *= 0.25;
    next = Math.max(-width, Math.min(width, next));
    drag.dx = next;
    setDragging(true);
    setDragX(next);
  }

  function onPointerUp() {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    const width = pagerRef.current?.clientWidth || window.innerWidth;
    const threshold = Math.min(72, width * 0.18);
    if (drag.locked === "x") {
      if (drag.dx <= -threshold) goToPage(1);
      else if (drag.dx >= threshold) goToPage(0);
      else setDragX(0);
    } else {
      setDragX(0);
    }
    setDragging(false);
    drag.locked = null;
    drag.dx = 0;
  }

  async function shareOrSave(mode: "share" | "download") {
    if (!qrDataUrl) return;
    const filename = `mysewa-qr-${accountNumber || "account"}.png`;
    setSharing(true);
    try {
      if (isMySewaNativeApp()) {
        await waitForNativeFileBridge();
      }
      if (sendPngViaNative(qrDataUrl, filename, mode)) {
        if (mode === "download") toast.success(t("transfer.shareQrSaved"));
        return;
      }
      if (mode === "share" && typeof navigator.share === "function") {
        const res = await fetch(qrDataUrl);
        const blob = await res.blob();
        const file = new File([blob], filename, { type: "image/png" });
        const payload = {
          files: [file],
          title: `${brandName} ${t("transfer.mySewaAccount")}`,
          text: `${accountName}\n${accountNumber}`,
        };
        if (!navigator.canShare || navigator.canShare(payload)) {
          await navigator.share(payload);
          return;
        }
      }
      triggerPngDownload(qrDataUrl, filename);
      toast.success(t("transfer.shareQrSaved"));
    } catch {
      toast.error(t("transfer.shareQrFailed"));
    } finally {
      setSharing(false);
    }
  }

  if (typeof document === "undefined" || !open) return null;

  const scannerPane = (
    <div className="relative flex h-full min-h-0 flex-col bg-black">
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 pt-[max(10px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-2">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label={t("common.goBack")}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur"
        >
          <X className="size-5" />
        </button>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ScannerTab)}
          className="min-w-0 flex-1"
        >
          <TabsList className="grid h-10 w-full grid-cols-2 rounded-full bg-black/45 text-white">
            <TabsTrigger value="scanner" className="rounded-full text-white data-[state=active]:bg-white data-[state=active]:text-foreground">
              {t("transfer.tabScanner")}
            </TabsTrigger>
            <TabsTrigger value="share" className="rounded-full text-white data-[state=active]:bg-white data-[state=active]:text-foreground">
              {t("transfer.tabShare")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "scanner" ? (
        <>
          <div className="relative min-h-0 flex-1 bg-black">
            <video
              ref={videoRef}
              className={cn(
                "absolute inset-0 size-full object-cover",
                cameraError || !scanning ? "opacity-0" : "opacity-100",
              )}
              playsInline
              muted
              autoPlay
            />
            {scanning && !cameraError ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="size-[62%] max-h-[62vw] rounded-3xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]" />
              </div>
            ) : null}
          </div>
          <div className="absolute inset-x-0 bottom-0 z-20 space-y-3 px-4 pb-[max(1.25rem,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))]">
            <p className="text-center text-[13px] text-white/80">{t("transfer.swipeForDetails")}</p>
            <Button
              type="button"
              variant="secondary"
              className="h-12 w-full rounded-xl"
              onClick={() => uploadRef.current?.click()}
            >
              <ImageIcon className="size-4" />
              {t("transfer.uploadQr")}
            </Button>
          </div>
          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void onFile(file);
            }}
          />
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 pb-8 pt-[calc(4.5rem+var(--safe-area-top,env(safe-area-inset-top,0px)))]">
          <div className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
            <div className="flex items-center justify-center gap-2 bg-brand px-4 py-3">
              <img
                src={logoUrl}
                alt=""
                className="size-8 rounded-md bg-white object-contain p-0.5"
              />
              <p className="text-[16px] font-semibold tracking-wide text-white">
                {brandName}
              </p>
            </div>
            <div className="px-5 pb-5 pt-4">
              <div className="mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center overflow-hidden rounded-xl border border-dashed border-separator bg-white p-2">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={t("transfer.mySewaAccount")}
                    className="size-full object-contain"
                  />
                ) : (
                  <div className="size-full animate-pulse rounded-lg bg-muted" />
                )}
              </div>
              <p className="mt-3 text-center text-[16px] font-semibold">{accountName}</p>
              <p className="mt-0.5 text-center text-[12px] text-muted-foreground">
                {t("transfer.mySewaAccount")}
              </p>
              <dl className="mt-4 space-y-2 text-[14px]">
                <CopyableField
                  label={t("load.accountName")}
                  value={accountName}
                  mono={false}
                />
                <CopyableField
                  label={t("load.accountNumber")}
                  value={accountNumber || "—"}
                />
                <CopyableField label={t("load.bankName")} value={brandName} mono={false} />
              </dl>
            </div>
          </div>
          <div className="mx-auto mt-4 grid w-full max-w-sm grid-cols-2 gap-2">
            <Button
              type="button"
              className="h-12 rounded-xl"
              disabled={!qrDataUrl || sharing}
              onClick={() => void shareOrSave("share")}
            >
              <Share2 className="size-4" />
              {t("transfer.shareQr")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-xl"
              disabled={!qrDataUrl || sharing}
              onClick={() => void shareOrSave("download")}
            >
              <Download className="size-4" />
              {t("transfer.saveQr")}
            </Button>
          </div>
          <p className="mt-4 text-center text-[13px] text-muted-foreground">
            {t("transfer.swipeForDetails")}
          </p>
        </div>
      )}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[45] bg-black" role="dialog" aria-modal="true">
      <div
        ref={pagerRef}
        className="h-dvh w-full overflow-hidden touch-pan-y"
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
        onTouchCancel={onPointerUp}
      >
        <div
          className={cn("flex h-full", !dragging && "transition-transform duration-300 ease-out")}
          style={{
            width: "200%",
            transform: `translate3d(calc(${page === 0 ? 0 : -50}% + ${dragX}px), 0, 0)`,
          }}
        >
          <section className="h-full w-1/2 shrink-0">{scannerPane}</section>
          <section className="h-full w-1/2 shrink-0 overflow-y-auto overscroll-y-contain bg-background">
            <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-hero-gradient px-3 pt-[max(10px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-3">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={t("common.goBack")}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 text-primary-foreground"
              >
                <X className="size-5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold text-primary-foreground">
                  {t("transfer.tabManual")}
                </p>
                <p className="truncate text-[12px] text-primary-foreground/75">
                  {t("transfer.swipeForScanner")}
                </p>
              </div>
            </div>
            <div className="px-3 pb-[max(1.5rem,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] pt-4 sm:px-4">
              {children}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
