import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import jsQR from "jsqr";
import QRCode from "qrcode";
import {
  ArrowLeft,
  Download,
  Flashlight,
  FlashlightOff,
  Image as ImageIcon,
  Share2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  buildMySewaPaymentPayload,
  parsePaymentQr,
  transferSearchFromPrefill,
} from "@/lib/qr-payment";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/qr")({
  head: () => ({
    meta: [
      { title: "Scan Or Share — MySewa" },
      {
        name: "description",
        content: "Scan a payment QR or share your MySewa QR to receive funds.",
      },
      { property: "og:title", content: "Scan Or Share — MySewa" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search["tab"] === "share" ? ("share" as const) : ("scan" as const),
  }),
  component: QrScanSharePage,
});

type Tab = "scan" | "share";

function decodeQrFromImageData(image: ImageData): string | null {
  const code = jsQR(image.data, image.width, image.height, {
    inversionAttempts: "attemptBoth",
  });
  return code?.data?.trim() ? code.data : null;
}

async function decodeQrFromFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return decodeQrFromImageData(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
    );
  } finally {
    bitmap.close();
  }
}

function QrScanSharePage() {
  const navigate = useNavigate();
  const { user, token, isLoading } = useAuth();
  const { tab: initialTab } = Route.useSearch();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [scanRestartKey, setScanRestartKey] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const handledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayName =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
    user?.phone ||
    "MySewa user";
  const payload = user
    ? buildMySewaPaymentPayload(user.phone, displayName)
    : "";

  const goToTransfer = useCallback(
    (raw: string) => {
      if (handledRef.current) return;
      const prefill = parsePaymentQr(raw);
      if (!prefill) {
        toast.error("Unrecognized QR code. Try a MySewa or bank payment QR.");
        return;
      }
      handledRef.current = true;
      toast.success("QR scanned — enter amount to transfer");
      void navigate({
        to: "/app/transfer",
        search: transferSearchFromPrefill(prefill),
      });
    },
    [navigate],
  );

  const stopScanner = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const setTorch = useCallback(async (on: boolean) => {
    const stream = streamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    const trackCaps = track.getCapabilities?.() as { torch?: boolean } | undefined;
    if (!trackCaps?.torch) {
      setTorchSupported(false);
      toast.message("Flash is not available on this camera");
      return;
    }
    setTorchSupported(true);
    try {
      await track.applyConstraints({
        advanced: [{ torch: on } as MediaTrackConstraintSet],
      });
      setTorchOn(on);
    } catch {
      toast.message("Could not toggle flash");
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !token) navigate({ to: "/" });
  }, [isLoading, token, navigate]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: 320,
      margin: 2,
      color: { dark: "#0A7A4B", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  useEffect(() => {
    if (tab !== "scan" || !token || !user) {
      stopScanner();
      setTorchOn(false);
      return;
    }

    handledRef.current = false;
    setCameraError(null);
    let cancelled = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const tick = () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (
        video &&
        ctx &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0
      ) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.drawImage(video, 0, 0, w, h);
        const decoded = decodeQrFromImageData(ctx.getImageData(0, 0, w, h));
        if (decoded) {
          goToTransfer(decoded);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const start = async () => {
      stopScanner();
      if (cancelled) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
        setTorchSupported(!!caps?.torch);
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Unable to open the camera";
        setCameraError(message);
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [tab, goToTransfer, stopScanner, token, user, scanRestartKey]);

  async function onGalleryFile(file: File | undefined) {
    if (!file) return;
    try {
      const decoded = await decodeQrFromFile(file);
      if (!decoded) {
        toast.error("Could not read a QR code from that image");
        if (tab === "scan") setScanRestartKey((k) => k + 1);
        return;
      }
      goToTransfer(decoded);
    } catch {
      toast.error("Could not read a QR code from that image");
      if (tab === "scan") setScanRestartKey((k) => k + 1);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadQr() {
    if (!qrDataUrl || !user) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `mysewa-qr-${user.phone}.png`;
    a.click();
  }

  async function shareQr() {
    if (!qrDataUrl || !user) return;
    try {
      const res = await fetch(qrDataUrl);
      const blob = await res.blob();
      const file = new File([blob], `mysewa-qr-${user.phone}.png`, {
        type: "image/png",
      });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "MySewa payment QR",
          text: `Pay ${displayName} on MySewa`,
          files: [file],
        });
        return;
      }
      if (navigator.share) {
        await navigator.share({
          title: "MySewa payment QR",
          text: `Pay ${displayName} (${user.phone}) on MySewa`,
        });
        return;
      }
      await downloadQr();
      toast.success("QR saved — share it from your gallery");
    } catch {
      // user cancelled share
    }
  }

  function switchTab(next: Tab) {
    setTab(next);
    void navigate({
      to: "/app/qr",
      search: { tab: next },
      replace: true,
    });
  }

  if (!token || isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-sm text-white/70">
        Loading…
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <header className="relative z-20 flex items-center gap-3 bg-brand px-3 pt-[max(10px,env(safe-area-inset-top))] pb-3">
        <Link
          to="/app"
          aria-label="Go back"
          className="inline-flex size-10 items-center justify-center rounded-xl text-white"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="flex-1 text-center text-[17px] font-semibold tracking-wide">
          Scan Or Share
        </h1>
        <span className="size-10" aria-hidden />
      </header>

      <div className="relative z-20 mx-auto mt-4 w-[min(280px,78vw)] rounded-full border border-white/80 p-1">
        <div className="grid grid-cols-2 gap-1">
          {(["scan", "share"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => switchTab(key)}
              className={cn(
                "rounded-full py-2 text-[14px] font-semibold capitalize transition-colors",
                tab === key ? "bg-white text-brand" : "bg-transparent text-white",
              )}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {tab === "scan" ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative z-20 mx-auto mt-4 flex w-[min(320px,86vw)] items-center justify-between rounded-xl bg-black/55 px-5 py-2.5">
            <button
              type="button"
              aria-label={torchOn ? "Turn flash off" : "Turn flash on"}
              className={cn(
                "inline-flex size-10 items-center justify-center text-white",
                !torchSupported && !torchOn && "opacity-70",
              )}
              onClick={() => void setTorch(!torchOn)}
            >
              {torchOn ? (
                <Flashlight className="size-6" />
              ) : (
                <FlashlightOff className="size-6 opacity-90" />
              )}
            </button>
            <button
              type="button"
              aria-label="Scan QR from gallery"
              className="inline-flex size-10 items-center justify-center text-white"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon className="size-6" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onGalleryFile(e.target.files?.[0])}
            />
          </div>

          <div className="relative mx-auto mt-6 flex w-full max-w-md flex-1 flex-col items-center px-6">
            <p className="mb-4 text-center text-[15px] font-medium text-white/95">
              Scan to Pay on Merchant outlets
            </p>

            <div className="relative aspect-square w-[min(280px,72vw)] overflow-hidden rounded-2xl">
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                playsInline
                muted
                autoPlay
              />
              <div className="pointer-events-none absolute inset-0 rounded-2xl border-[3px] border-brand shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              {cameraError ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center">
                  <p className="text-[14px] text-white/90">{cameraError}</p>
                  <button
                    type="button"
                    className="rounded-xl bg-brand px-4 py-2 text-[14px] font-semibold"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose from gallery
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="relative z-20 mt-auto flex items-end justify-center gap-8 px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-6">
            <PartnerMark label="fonepay" accent="#E31C23" />
            <PartnerMark label="NEPALPAY" accent="#1D4ED8" boxed />
            <PartnerMark label="smartQR" accent="#DC2626" />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-linear-to-b from-brand/30 via-black to-black px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-6">
          <div className="mx-auto w-full max-w-sm">
            <div className="rounded-3xl bg-white p-6 text-foreground shadow-xl">
              <div className="flex items-center gap-3">
                <img
                  src="/logo.png"
                  alt=""
                  className="size-11 rounded-full object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-[18px] font-semibold tracking-tight">
                    {displayName}
                  </p>
                  <p className="truncate text-[14px] text-muted-foreground">
                    {user.phone}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex justify-center rounded-2xl bg-brand-soft p-4">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Your MySewa payment QR"
                    className="size-[220px] rounded-xl bg-white"
                  />
                ) : (
                  <div className="flex size-[220px] items-center justify-center text-sm text-muted-foreground">
                    Generating QR…
                  </div>
                )}
              </div>

              <p className="mt-4 text-center text-[13px] text-muted-foreground">
                Others can scan this QR in MySewa to pay you instantly.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void shareQr()}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white"
                >
                  <Share2 className="size-4" />
                  Share
                </button>
                <button
                  type="button"
                  onClick={() => void downloadQr()}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-[15px] font-semibold"
                >
                  <Download className="size-4" />
                  Save
                </button>
              </div>
            </div>

            <p className="mt-5 text-center text-[12px] text-white/55">
              Your QR is created automatically with your MySewa account.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PartnerMark({
  label,
  accent,
  boxed,
}: {
  label: string;
  accent: string;
  boxed?: boolean;
}) {
  return (
    <span
      className={cn(
        "text-[12px] font-bold tracking-wide",
        boxed && "rounded border px-1.5 py-0.5",
      )}
      style={{ color: accent, borderColor: accent }}
    >
      {label}
    </span>
  );
}
