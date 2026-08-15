import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ImageIcon, Share2 } from "lucide-react";
import { toast } from "sonner";
import { CopyableField } from "@/components/CopyableField";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (raw: string) => void;
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
  const [tab, setTab] = useState<ScannerTab>("scanner");
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

  const emit = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value || handledRef.current) return;
      handledRef.current = true;
      onScan(value);
      onOpenChange(false);
    },
    [onOpenChange, onScan],
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
      handledRef.current = false;
      setCameraError(false);
      stopCamera();
    }
  }, [open, stopCamera]);

  const scannerActive = open && tab === "scanner";

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] overflow-y-auto overscroll-y-contain rounded-t-2xl px-4 pb-[max(2rem,calc(1rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))))] pt-5"
      >
        <SheetTitle className="sr-only">{t("transfer.scanQr")}</SheetTitle>
        <SheetDescription className="sr-only">{t("transfer.tabScanner")}</SheetDescription>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ScannerTab)}
          className="pr-8"
        >
          <TabsList className="mb-4 grid h-11 w-full grid-cols-2 rounded-xl">
            <TabsTrigger value="scanner" className="rounded-lg">
              {t("transfer.tabScanner")}
            </TabsTrigger>
            <TabsTrigger value="share" className="rounded-lg">
              {t("transfer.tabShare")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scanner" className="mt-0">
            <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-black">
              <video
                ref={videoRef}
                className={cn(
                  "size-full object-cover",
                  cameraError || !scanning ? "opacity-0" : "opacity-100",
                )}
                playsInline
                muted
                autoPlay
              />
              {scanning && !cameraError ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="size-[68%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
                </div>
              ) : null}
            </div>

            <div className="mx-auto mt-4 w-full max-w-sm">
              <Button
                type="button"
                variant="outline"
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
          </TabsContent>

          <TabsContent value="share" className="mt-0">
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
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
