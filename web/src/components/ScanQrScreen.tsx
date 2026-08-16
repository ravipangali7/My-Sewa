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
import { dataUrlToBytes, renderMyQrCardPng } from "@/lib/my-qr-card";
import { toDataURL } from "@/lib/qrcode";
import { stashScannedQr } from "@/lib/scanned-qr";
import { cn } from "@/lib/utils";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

const ZOOM_LEVELS = [1, 2, 3] as const;
const COLLAPSED_SHEET = 64;
const SHEET_EASE = "transform 380ms cubic-bezier(0.32, 0.72, 0, 1)";
const DRAG_ARM = 8;

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

function bindScanVideo(el: HTMLVideoElement | null) {
  if (!el) return;
  el.muted = true;
  el.defaultMuted = true;
  el.controls = false;
  el.playsInline = true;
  el.disablePictureInPicture = true;
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.setAttribute("x-webkit-airplay", "deny");
  el.setAttribute("disablepictureinpicture", "true");
  el.setAttribute("controlslist", "nodownload nofullscreen noremoteplayback");
  if ("disableRemotePlayback" in el) {
    (el as HTMLVideoElement & { disableRemotePlayback: boolean }).disableRemotePlayback = true;
  }
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
  const sheetYRef = useRef(0);
  const dragRef = useRef({
    active: false,
    armed: false,
    startY: 0,
    startOffset: 0,
  });
  const cardCacheRef = useRef<string | null>(null);

  const [cameraError, setCameraError] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [livePreview, setLivePreview] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoom, setZoom] = useState<1 | 2 | 3>(1);
  const [hwZoom, setHwZoom] = useState<{ min: number; max: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewportH, setViewportH] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 800,
  );

  const legalName = [user?.first_name, user?.last_name].filter(Boolean).join(" ");
  const nickname = (user?.nickname || "").trim();
  const displayName = nickname || legalName || user?.phone || t("common.user");
  const username = nickname && legalName && nickname !== legalName ? nickname : "";
  const phone = user?.phone || "";
  const logoSrc = logoUrl || "/logo.png";
  const hint = t("scan.showToReceive");

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

  useEffect(() => {
    cardCacheRef.current = null;
  }, [qrSrc, logoSrc, displayName, username, phone, hint]);

  const expandedH = Math.round(
    Math.min(Math.max(viewportH * 0.58, 420), viewportH - 96),
  );
  const closedOffset = Math.max(0, expandedH - COLLAPSED_SHEET);

  const applySheetY = useCallback((y: number, animate: boolean) => {
    const el = sheetRef.current;
    const next = Math.max(0, Math.min(closedOffset, y));
    sheetYRef.current = next;
    if (!el) return;
    el.style.transition = animate ? SHEET_EASE : "none";
    el.style.transform = `translate3d(0, ${next}px, 0)`;
  }, [closedOffset]);

  useEffect(() => {
    const update = () => setViewportH(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    applySheetY(sheetOpen ? 0 : closedOffset, false);
    // Only re-clamp when the viewport size changes — never cancel an in-flight snap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedOffset]);

  const openSheet = useCallback((animate = true) => {
    setSheetOpen(true);
    applySheetY(0, animate);
  }, [applySheetY]);

  const closeSheet = useCallback((animate = true) => {
    setSheetOpen(false);
    applySheetY(closedOffset, animate);
  }, [applySheetY, closedOffset]);

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
    setLivePreview(false);
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
          bindScanVideo(video);
          video.srcObject = stream;
          try {
            await video.play();
          } catch {
            /* overlay stays until onPlaying */
          }
        }
        setScanning(true);
        void loop();
      } catch {
        if (!cancelled) {
          setCameraError(true);
          setScanning(false);
          setLivePreview(false);
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

  function onSheetPointerDown(event: React.PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, a")) return;
    dragRef.current = {
      active: true,
      armed: false,
      startY: event.clientY,
      startOffset: sheetYRef.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onSheetPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag.active) return;
    const dy = event.clientY - drag.startY;
    if (!drag.armed) {
      if (Math.abs(dy) < DRAG_ARM) return;
      drag.armed = true;
    }
    applySheetY(drag.startOffset + dy, false);
  }

  function onSheetPointerUp() {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    if (!drag.armed) return;
    const mid = closedOffset * 0.45;
    if (sheetYRef.current <= mid) openSheet(true);
    else closeSheet(true);
  }

  async function cardPng(): Promise<string> {
    if (cardCacheRef.current) return cardCacheRef.current;
    if (!qrSrc) throw new Error("qr");
    const png = await renderMyQrCardPng({
      qrSrc,
      logoUrl: logoSrc,
      name: displayName,
      username,
      phone,
      hint,
    });
    cardCacheRef.current = png;
    return png;
  }

  async function downloadQr() {
    try {
      const png = await cardPng();
      const filename = "mysewa-qr.png";
      const bytes = dataUrlToBytes(png);
      if (isMySewaNativeApp()) await waitForNativeFileBridge();
      if (sendViaNativeBridge(bytes, filename, "image/png", "download")) {
        toast.success(t("transfer.shareQrSaved"));
        return;
      }
      const a = document.createElement("a");
      a.href = png;
      a.download = filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(t("transfer.shareQrSaved"));
    } catch {
      toast.error(t("transfer.shareQrFailed"));
    }
  }

  async function shareQr() {
    try {
      const png = await cardPng();
      const bytes = dataUrlToBytes(png);
      if (isMySewaNativeApp()) await waitForNativeFileBridge();
      if (sendViaNativeBridge(bytes, "mysewa-qr.png", "image/png", "share")) return;
      const blob = await (await fetch(png)).blob();
      const file = new File([blob], "mysewa-qr.png", { type: "image/png" });
      const title = t("scan.shareTitle");
      const text = t("scan.shareText", { name: displayName, phone });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (typeof nav.share === "function") {
        if (!nav.canShare || nav.canShare({ files: [file] })) {
          await nav.share({ title, text, files: [file] });
          return;
        }
        await nav.share({ title, text, files: [file] });
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
        ref={(el) => {
          videoRef.current = el;
          bindScanVideo(el);
        }}
        className={cn(
          "mysewa-scan-video absolute inset-0 size-full object-cover",
          livePreview ? "opacity-100" : "opacity-0",
        )}
        style={hwZoom ? undefined : { transform: `scale(${zoom})` }}
        playsInline
        muted
        autoPlay={false}
        controls={false}
        disablePictureInPicture
        preload="none"
        tabIndex={-1}
        aria-hidden
        onPlaying={() => setLivePreview(true)}
        onCanPlay={(event) => {
          if (!event.currentTarget.paused) setLivePreview(true);
        }}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-black",
          livePreview && !cameraError && "hidden",
        )}
      />
      <div className="pointer-events-none absolute inset-0 bg-black/30" />

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
                src={logoSrc}
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
          <div className="relative aspect-square w-[min(68vw,16.5rem)] overflow-hidden rounded-[18px] border-[3px] border-brand-accent bg-black">
            {scanning && !cameraError ? (
              <div className="mysewa-qr-scan-line absolute inset-x-3 h-0.5 rounded-full bg-red-500 shadow-[0_0_12px_2px_rgba(239,68,68,0.85)]" />
            ) : (
              <div className="flex h-full items-center justify-center px-5 text-center text-[13px] leading-5 text-white/85">
                {t("transfer.qrCameraHelp")}
              </div>
            )}
          </div>

          <div className="mt-4 inline-flex items-center rounded-full bg-white p-1 shadow-[0_6px_18px_rgba(0,0,0,0.28)]">
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
          className="absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-[22px] bg-white will-change-transform shadow-[0_-12px_40px_rgba(0,0,0,0.28)]"
          style={{
            height: expandedH,
            transform: `translate3d(0, ${closedOffset}px, 0)`,
          }}
        >
          <div
            className="flex shrink-0 touch-none items-center px-5"
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={onSheetPointerUp}
            onPointerCancel={onSheetPointerUp}
          >
            <button
              type="button"
              onClick={() => (sheetOpen ? undefined : openSheet(true))}
              className="border-b-[3px] border-brand-accent pb-2 pt-3 text-[15px] font-semibold text-brand-accent"
            >
              {t("scan.myQr")}
            </button>
            <button
              type="button"
              onClick={() => (sheetOpen ? closeSheet(true) : openSheet(true))}
              aria-label={sheetOpen ? t("scan.collapse") : t("scan.expand")}
              className="mb-1 ml-auto inline-flex size-8 items-center justify-center rounded-full bg-brand-accent text-white shadow-sm"
            >
              {sheetOpen ? (
                <ChevronDown className="size-4" strokeWidth={2.6} />
              ) : (
                <ChevronUp className="size-4" strokeWidth={2.6} />
              )}
            </button>
          </div>

          <div
            className="flex min-h-0 flex-1 flex-col"
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={onSheetPointerUp}
            onPointerCancel={onSheetPointerUp}
          >
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 px-6 py-3">
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt={t("scan.myQr")}
                  className="size-[min(48vw,13.5rem)] bg-white"
                />
              ) : (
                <div className="flex size-[min(48vw,13.5rem)] items-center justify-center bg-muted text-sm text-muted-foreground">
                  {t("common.loading")}
                </div>
              )}
              <div className="flex items-center gap-2">
                <img
                  src={logoSrc}
                  alt="Mysewa"
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
              <div className="text-center">
                <p className="text-[17px] font-semibold text-zinc-800">{displayName}</p>
                {username ? (
                  <p className="mt-0.5 text-[13px] font-medium text-zinc-500">{username}</p>
                ) : null}
                <p className="mt-0.5 text-[14px] text-zinc-500">{phone}</p>
                <p className="mt-2 text-[12px] text-zinc-400">{hint}</p>
              </div>
            </div>
            <div
              className="mt-1 flex w-full shrink-0 items-stretch border-t border-zinc-200"
              style={{
                paddingBottom: "max(4px, var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)))",
              }}
            >
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
