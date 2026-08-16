import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Flashlight,
  FlashlightOff,
  QrCode,
  Share2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import {
  buildMySewaAccountQr,
  parseBankQr,
  phonesMatch,
} from "@/lib/bank-qr";
import jsQR from "@/lib/jsqr";
import {
  hasNativeFileBridge,
  isMySewaNativeApp,
  waitForNativeCameraPermission,
  waitForNativeFileBridge,
} from "@/lib/native-app";
import { toDataURL } from "@/lib/qrcode";
import { stashScannedQr } from "@/lib/scanned-qr";
import { cn } from "@/lib/utils";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

const ZOOM_LEVELS = [1, 2, 3] as const;
const COLLAPSED_SHEET = 92;
const MY_QR_TAB = "mine" as const;
const FAVORITE_TAB = "favorite" as const;

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

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sendViaNativeBridge(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  type: "download" | "share",
): boolean {
  if (!hasNativeFileBridge()) return false;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const payload = {
    type,
    filename,
    mime,
    base64: btoa(binary),
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

function ScanPhoneMark() {
  return (
    <svg viewBox="0 0 36 36" className="size-8 shrink-0" aria-hidden>
      <rect x="14" y="4" width="14" height="24" rx="2.5" fill="none" stroke="white" strokeWidth="1.7" />
      <rect x="16.2" y="7.2" width="9.6" height="14" rx="0.6" fill="white" opacity="0.22" />
      <path
        d="M6 22.5h7.5M6 22.5v-7.5"
        fill="none"
        stroke="#20C36A"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <rect x="4.5" y="13.5" width="7" height="7" rx="1" fill="none" stroke="white" strokeWidth="1.4" />
    </svg>
  );
}

export function ScanQrScreen({
  onClose,
  onPay,
}: {
  onClose: () => void;
  onPay: () => void;
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
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({
    active: false,
    startY: 0,
    startH: COLLAPSED_SHEET,
  });

  const [cameraError, setCameraError] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoom, setZoom] = useState<1 | 2 | 3>(1);
  const [hwZoom, setHwZoom] = useState<{ min: number; max: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetH, setSheetH] = useState(COLLAPSED_SHEET);
  const [dragging, setDragging] = useState(false);
  const [viewportH, setViewportH] = useState(800);
  const [sheetTab, setSheetTab] = useState<typeof MY_QR_TAB | typeof FAVORITE_TAB>(MY_QR_TAB);

  const displayName =
    (user?.nickname || "").trim() ||
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
    user?.phone ||
    t("common.user");
  const phone = user?.phone || "";

  const qrPayload = useMemo(() => {
    if (!phone) return "";
    return buildMySewaAccountQr({
      accountName: displayName,
      accountNumber: phone,
    });
  }, [displayName, phone]);

  const qrSrc = useMemo(() => {
    if (!qrPayload) return "";
    try {
      return toDataURL(qrPayload, { width: 640, color: { dark: "#1C1C1E", light: "#FFFFFF" } });
    } catch {
      return "";
    }
  }, [qrPayload]);

  const expandedH = Math.max(
    360,
    Math.round(Math.min(viewportH * 0.74, viewportH - 88)),
  );

  useEffect(() => {
    const update = () => setViewportH(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (dragging) return;
    setSheetH(sheetOpen ? expandedH : COLLAPSED_SHEET);
  }, [dragging, expandedH, sheetOpen]);

  const emit = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value || handledRef.current) return;
      const parsed = parseBankQr(value);
      if (!parsed.ok) {
        toast.error(
          parsed.reason === "not_bank" ? t("transfer.qrNotBank") : t("transfer.qrInvalid"),
        );
        return;
      }
      if (parsed.data.isMySewaWallet && phone && phonesMatch(parsed.data.accountNumber, phone)) {
        toast.message(t("scan.ownQr"));
        return;
      }
      handledRef.current = true;
      stashScannedQr(value);
      onPay();
    },
    [onPay, phone, t],
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
    setTorchOn(false);
    setTorchSupported(false);
    setHwZoom(null);
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
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
          const raw = await decodeFromImageSource(video, video.videoWidth, video.videoHeight);
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
        const track = stream.getVideoTracks()[0];
        const caps =
          typeof track?.getCapabilities === "function" ? track.getCapabilities() : undefined;
        setTorchSupported(Boolean((caps as { torch?: boolean } | undefined)?.torch));
        const zoomCap = caps as { zoom?: { min?: number; max?: number } } | undefined;
        if (zoomCap?.zoom && typeof zoomCap.zoom.max === "number" && zoomCap.zoom.max > 1) {
          setHwZoom({
            min: zoomCap.zoom.min ?? 1,
            max: zoomCap.zoom.max,
          });
        }
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
  }, [emit, stopCamera]);

  const applyZoom = useCallback(
    async (level: 1 | 2 | 3) => {
      setZoom(level);
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || !hwZoom) return;
      const tValue =
        level === 1
          ? hwZoom.min
          : Math.min(hwZoom.max, hwZoom.min + ((level - 1) / 2) * (hwZoom.max - hwZoom.min));
      try {
        await track.applyConstraints({ advanced: [{ zoom: tValue }] } as never);
      } catch {
        /* visual CSS zoom remains */
      }
    },
    [hwZoom],
  );

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as never);
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
      setTorchOn(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const raw = await decodeFromFile(file);
    if (raw) {
      emit(raw);
      return;
    }
    toast.error(t("transfer.qrInvalid"));
  }

  function snapSheet(height: number) {
    const mid = (COLLAPSED_SHEET + expandedH) / 2;
    const open = height >= mid;
    setSheetOpen(open);
    setSheetH(open ? expandedH : COLLAPSED_SHEET);
  }

  function onSheetPointerDown(event: React.PointerEvent) {
    dragRef.current = {
      active: true,
      startY: event.clientY,
      startH: sheetH,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onSheetPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag.active) return;
    const next = Math.max(
      COLLAPSED_SHEET,
      Math.min(expandedH, drag.startH + (drag.startY - event.clientY)),
    );
    setSheetH(next);
  }

  function onSheetPointerUp() {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setDragging(false);
    snapSheet(sheetH);
  }

  async function downloadQr() {
    if (!qrSrc) return;
    const filename = "mysewa-qr.png";
    try {
      const bytes = dataUrlToBytes(qrSrc);
      if (isMySewaNativeApp()) await waitForNativeFileBridge();
      if (sendViaNativeBridge(bytes, filename, "image/png", "download")) {
        toast.success(t("transfer.shareQrSaved"));
        return;
      }
      const a = document.createElement("a");
      a.href = qrSrc;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(t("transfer.shareQrSaved"));
    } catch {
      toast.error(t("transfer.shareQrFailed"));
    }
  }

  async function shareQr() {
    if (!qrSrc) return;
    try {
      const bytes = dataUrlToBytes(qrSrc);
      if (isMySewaNativeApp()) await waitForNativeFileBridge();
      if (sendViaNativeBridge(bytes, "mysewa-qr.png", "image/png", "share")) return;
      const blob = await (await fetch(qrSrc)).blob();
      const file = new File([blob], "mysewa-qr.png", { type: "image/png" });
      const title = t("scan.shareTitle");
      const text = t("scan.shareText", { name: displayName, phone });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (typeof nav.share === "function") {
        const withFile: ShareData = { title, text, files: [file] };
        if (!nav.canShare || nav.canShare({ files: [file] })) {
          await nav.share(withFile);
          return;
        }
        await nav.share({ title, text });
        return;
      }
      await downloadQr();
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") return;
      toast.error(t("transfer.shareQrFailed"));
    }
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-black max-lg:fixed max-lg:inset-0 max-lg:z-40">
      <video
        ref={videoRef}
        className={cn(
          "absolute inset-0 size-full object-cover transition-transform duration-200",
          cameraError || !scanning ? "opacity-0" : "opacity-100",
        )}
        style={hwZoom ? undefined : { transform: `scale(${zoom})` }}
        playsInline
        muted
        autoPlay
      />
      <div className="absolute inset-0 bg-black/35" />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between px-4 pt-[max(12px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-2">
          <button
            type="button"
            onClick={() => void toggleTorch()}
            disabled={!torchSupported}
            aria-label={torchOn ? t("transfer.torchOff") : t("transfer.torchOn")}
            className={cn(
              "inline-flex size-10 items-center justify-center text-white",
              !torchSupported && "opacity-50",
              torchOn && "text-brand-accent",
            )}
          >
            {torchOn ? (
              <Flashlight className="size-6" strokeWidth={2} />
            ) : (
              <FlashlightOff className="size-6" strokeWidth={2} />
            )}
          </button>
          <h1 className="text-[16px] font-semibold tracking-tight text-white">
            {t("scan.title")}
          </h1>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.goBack")}
            className="inline-flex size-9 items-center justify-center rounded-full border border-white/85 text-white"
          >
            <X className="size-4" strokeWidth={2.4} />
          </button>
        </div>

        <div className="flex flex-col items-center px-4 pt-1">
          <div className="relative flex flex-col items-center">
            <p className="text-[13px] font-semibold tracking-wide text-white">
              {t("scan.sloganLeave")}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <img
                src={logoUrl || "/logo.png"}
                alt="Mysewa"
                className="size-9 rounded-md object-cover shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
                onError={(event) => {
                  event.currentTarget.src = "/logo.png";
                }}
              />
              <span className="text-[26px] font-bold leading-none tracking-tight">
                <span className="text-white">My</span>
                <span className="text-brand-accent">sewa</span>
              </span>
              <ScanPhoneMark />
            </div>
            <p className="-mt-0.5 self-end pr-10 text-[13px] font-semibold text-white">
              {t("scan.sloganDo")}
            </p>
          </div>

          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/85 px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.04em] text-white"
          >
            <QrCode className="size-3.5" strokeWidth={2.1} />
            {t("scan.gallery")}
          </button>
        </div>

        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center px-8"
          style={{ paddingBottom: COLLAPSED_SHEET + 12 }}
        >
          <div className="relative aspect-square w-[min(72vw,17.5rem)] overflow-hidden rounded-[18px] border-[3px] border-brand-accent bg-black/25">
            {scanning && !cameraError ? (
              <div className="mysewa-qr-scan-line absolute inset-x-3 h-[2px] rounded-full bg-red-500 shadow-[0_0_12px_2px_rgba(239,68,68,0.85)]" />
            ) : (
              <div className="flex h-full items-center justify-center px-5 text-center text-[13px] leading-5 text-white/85">
                {t("transfer.qrCameraHelp")}
              </div>
            )}
          </div>

          <div className="mt-5 inline-flex items-center rounded-full bg-white p-1 shadow-[0_6px_18px_rgba(0,0,0,0.28)]">
            {ZOOM_LEVELS.map((level) => {
              const active = zoom === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => void applyZoom(level)}
                  aria-label={t("scan.zoom", { n: level })}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-[12px] font-semibold transition-colors",
                    active ? "bg-brand-accent text-white" : "text-zinc-900",
                  )}
                >
                  {level === 1 ? "1X" : level}
                </button>
              );
            })}
          </div>
        </div>

        <div
          ref={sheetRef}
          className={cn(
            "absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-[22px] bg-white shadow-[0_-12px_40px_rgba(0,0,0,0.28)]",
            !dragging && "transition-[height] duration-300 ease-out",
          )}
          style={{
            height: sheetH + 8,
            paddingBottom: "max(8px, var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)))",
          }}
        >
          <div
            className="flex shrink-0 touch-none items-end gap-5 px-5 pt-1"
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={onSheetPointerUp}
            onPointerCancel={onSheetPointerUp}
          >
            <button
              type="button"
              onClick={() => {
                setSheetTab(MY_QR_TAB);
                if (!sheetOpen) {
                  setSheetOpen(true);
                  setSheetH(expandedH);
                }
              }}
              className={cn(
                "border-b-[3px] pb-2 pt-3 text-[15px] font-semibold",
                sheetTab === MY_QR_TAB
                  ? "border-brand-accent text-brand-accent"
                  : "border-transparent text-zinc-700",
              )}
            >
              {t("scan.myQr")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSheetTab(FAVORITE_TAB);
                if (!sheetOpen) {
                  setSheetOpen(true);
                  setSheetH(expandedH);
                }
              }}
              className={cn(
                "border-b-[3px] pb-2 pt-3 text-[15px] font-semibold",
                sheetTab === FAVORITE_TAB
                  ? "border-brand-accent text-brand-accent"
                  : "border-transparent text-zinc-700",
              )}
            >
              {t("scan.favoriteQr")}
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !sheetOpen;
                setSheetOpen(next);
                setSheetH(next ? expandedH : COLLAPSED_SHEET);
              }}
              aria-label={sheetOpen ? t("scan.collapse") : t("scan.expand")}
              className="mb-2 ml-auto inline-flex size-8 items-center justify-center rounded-full bg-brand-accent text-white shadow-sm"
            >
              {sheetOpen ? (
                <ChevronDown className="size-4" strokeWidth={2.6} />
              ) : (
                <ChevronUp className="size-4" strokeWidth={2.6} />
              )}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {sheetTab === MY_QR_TAB ? (
              <div className="flex min-h-full flex-col items-center px-6 pb-2 pt-4">
                {qrSrc ? (
                  <img
                    src={qrSrc}
                    alt={t("scan.myQr")}
                    className="size-[min(58vw,16.5rem)] bg-white"
                  />
                ) : (
                  <div className="flex size-[min(58vw,16.5rem)] items-center justify-center bg-muted text-sm text-muted-foreground">
                    {t("common.loading")}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <img
                    src={logoUrl || "/logo.png"}
                    alt=""
                    className="size-7 rounded-full object-cover"
                    onError={(event) => {
                      event.currentTarget.src = "/logo.png";
                    }}
                  />
                  <span className="text-[18px] font-bold leading-none">
                    <span className="text-ocean">My</span>
                    <span className="text-brand">sewa</span>
                  </span>
                </div>
                <p className="mt-3 text-[17px] font-semibold text-zinc-800">{displayName}</p>
                <p className="mt-0.5 text-[14px] text-zinc-500">{phone}</p>
                <p className="mt-3 text-center text-[12px] text-zinc-400">
                  {t("scan.showToReceive")}
                </p>
                <div className="mt-auto flex w-full items-stretch border-t border-zinc-200 pt-1">
                  <button
                    type="button"
                    onClick={() => void downloadQr()}
                    className="flex flex-1 items-center justify-center gap-2 py-3 text-[12px] font-semibold tracking-[0.04em] text-brand-accent"
                  >
                    <Download className="size-4" strokeWidth={2.2} />
                    {t("scan.downloadQr")}
                  </button>
                  <span className="w-px bg-zinc-200" />
                  <button
                    type="button"
                    onClick={() => void shareQr()}
                    className="flex flex-1 items-center justify-center gap-2 py-3 text-[12px] font-semibold tracking-[0.04em] text-brand-accent"
                  >
                    <Share2 className="size-4" strokeWidth={2.2} />
                    {t("scan.share")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[16rem] flex-col items-center justify-center px-8 text-center">
                <div className="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <QrCode className="size-5" />
                </div>
                <p className="text-[15px] font-medium text-zinc-800">{t("scan.favoriteEmpty")}</p>
                <p className="mt-1 text-[13px] text-zinc-500">{t("scan.favoriteEmptyHint")}</p>
              </div>
            )}
          </div>
        </div>
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
    </div>
  );
}
