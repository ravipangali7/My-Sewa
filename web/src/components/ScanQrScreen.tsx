import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Flashlight, FlashlightOff, QrCode, X } from "lucide-react";
import { toast } from "sonner";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { parseBankQr, phonesMatch } from "@/lib/bank-qr";
import jsQR from "@/lib/jsqr";
import { waitForNativeCameraPermission } from "@/lib/native-app";
import { stashScannedQr } from "@/lib/scanned-qr";
import { cn } from "@/lib/utils";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

const ZOOM_LEVELS = [1, 2, 3] as const;

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
  footer,
}: {
  onClose: () => void;
  onPay: () => void;
  footer?: ReactNode;
}) {
  const t = useT();
  const { user } = useAuth();
  const { logoUrl } = useSiteBranding();
  const phone = String(user?.phone || "").trim();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const handledRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const [cameraError, setCameraError] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [livePreview, setLivePreview] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoom, setZoom] = useState<1 | 2 | 3>(1);
  const [hwZoom, setHwZoom] = useState<{ min: number; max: number } | null>(null);

  const logoSrc = logoUrl || "/logo.png";

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

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div className="relative z-20 flex items-center justify-between px-4 pt-[max(12px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-2">
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

        <div className="relative z-20 flex flex-col items-center px-4 pt-1">
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
          style={{
            paddingBottom: footer
              ? 8
              : "max(24px, var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)))",
          }}
        >
          <div
            className={cn(
              "relative aspect-square w-[min(68vw,16.5rem)] rounded-[18px] border-[3px] border-brand-accent",
              (!scanning || cameraError) && "bg-black/40",
            )}
            style={
              scanning && !cameraError
                ? { boxShadow: "0 0 0 100vmax rgba(0,0,0,0.3)" }
                : undefined
            }
          >
            {scanning && !cameraError ? (
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[15px]">
                <div className="mysewa-qr-scan-line absolute inset-x-3 h-0.5 rounded-full bg-red-500 shadow-[0_0_12px_2px_rgba(239,68,68,0.85)]" />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-5 text-center text-[13px] leading-5 text-white/85">
                {t("transfer.qrCameraHelp")}
              </div>
            )}
          </div>

          <div className="relative z-20 mt-4 inline-flex items-center rounded-full bg-white p-1 shadow-[0_6px_18px_rgba(0,0,0,0.28)]">
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
        {footer ? <div className="relative z-20">{footer}</div> : null}
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
