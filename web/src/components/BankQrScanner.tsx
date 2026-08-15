import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n";
import jsQR from "@/lib/jsqr";
import { waitForNativeCameraPermission } from "@/lib/native-app";
import { cn } from "@/lib/utils";

type ScannerTab = "scanner" | "manual";

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

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], [role='combobox']"),
  );
}

function touchPoint(event: TouchEvent | React.TouchEvent) {
  return event.touches[0] || event.changedTouches[0] || null;
}

export function BankQrScanner({
  onScan,
  onClose,
  children,
}: {
  onScan: (raw: string) => boolean | void;
  onClose: () => void;
  children: ReactNode | ((api: { showScanner: () => void; showForm: () => void }) => ReactNode);
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const handledRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef(0);
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    dx: 0,
    locked: null as null | "x" | "y",
  });
  const [tab, setTab] = useState<ScannerTab>("scanner");
  const [page, setPage] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [scanning, setScanning] = useState(false);

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const goToPage = useCallback((next: number) => {
    const clamped = next < 0 ? 0 : next > 1 ? 1 : next;
    pageRef.current = clamped;
    setPage(clamped);
    setTab(clamped === 0 ? "scanner" : "manual");
    setDragX(0);
  }, []);

  const emit = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value || handledRef.current) return;
      handledRef.current = true;
      const ok = onScanRef.current(value);
      if (ok === false) {
        handledRef.current = false;
        return;
      }
      goToPage(1);
    },
    [goToPage],
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
    if (page !== 0) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [page]);

  const scannerActive = page === 0;

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

  function onPointerDown(event: React.TouchEvent | TouchEvent) {
    if (pageRef.current === 1 && isInteractiveTarget(event.target)) return;
    const point = touchPoint(event);
    if (!point) return;
    dragRef.current = {
      active: true,
      startX: point.clientX,
      startY: point.clientY,
      dx: 0,
      locked: null,
    };
  }

  function onPointerMove(event: React.TouchEvent | TouchEvent) {
    const drag = dragRef.current;
    if (!drag.active) return;
    const point = touchPoint(event);
    if (!point) return;
    const dx = point.clientX - drag.startX;
    const dy = point.clientY - drag.startY;
    if (!drag.locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      drag.locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (drag.locked !== "x") return;
    event.preventDefault();
    const width = window.innerWidth;
    const currentPage = pageRef.current;
    let next = dx;
    if (currentPage === 0 && next > 0) next *= 0.25;
    if (currentPage === 1 && next < 0) next *= 0.25;
    next = Math.max(-width, Math.min(width, next));
    drag.dx = next;
    setDragging(true);
    setDragX(next);
  }

  function onPointerUp() {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    const width = window.innerWidth;
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

  useEffect(() => {
    const nodes = [formRef.current, overlayRef.current].filter(
      (node): node is HTMLDivElement => Boolean(node),
    );
    const onMove = (event: TouchEvent) => onPointerMove(event);
    for (const node of nodes) {
      node.addEventListener("touchmove", onMove, { passive: false });
    }
    return () => {
      for (const node of nodes) {
        node.removeEventListener("touchmove", onMove);
      }
    };
  }, []);

  if (typeof document === "undefined") {
    return typeof children === "function"
      ? children({ showScanner: () => goToPage(0), showForm: () => goToPage(1) })
      : children;
  }

  const scannerPane = (
    <div className="relative flex h-full min-h-0 flex-col bg-black">
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 pt-[max(10px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.goBack")}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur"
        >
          <X className="size-5" />
        </button>
        <Tabs
          value={tab}
          onValueChange={(value) => goToPage(value === "manual" ? 1 : 0)}
          className="min-w-0 flex-1"
        >
          <TabsList className="grid h-10 w-full grid-cols-2 rounded-full bg-black/45 text-white">
            <TabsTrigger value="scanner" className="rounded-full text-white data-[state=active]:bg-white data-[state=active]:text-foreground">
              {t("transfer.tabScanner")}
            </TabsTrigger>
            <TabsTrigger value="manual" className="rounded-full text-white data-[state=active]:bg-white data-[state=active]:text-foreground">
              {t("transfer.tabManual")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

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
        <button
          type="button"
          className="w-full text-center text-[13px] text-white/80"
          onClick={() => goToPage(1)}
        >
          {t("transfer.swipeForDetails")}
        </button>
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
    </div>
  );

  return (
    <>
      <div
        ref={formRef}
        aria-hidden={page === 0}
        className="touch-pan-y"
        onTouchStart={onPointerDown}
        onTouchEnd={onPointerUp}
        onTouchCancel={onPointerUp}
      >
        {typeof children === "function"
          ? children({ showScanner: () => goToPage(0), showForm: () => goToPage(1) })
          : children}
      </div>
      {createPortal(
        <div
          ref={overlayRef}
          className={cn(
            "fixed inset-0 z-[45] bg-black",
            !dragging && "transition-transform duration-300 ease-out",
          )}
          aria-hidden={page !== 0 && !dragging}
          style={{
            transform: `translate3d(calc(${page === 0 ? "0%" : "-100%"} + ${dragX}px), 0, 0)`,
            pointerEvents: page === 0 || dragging ? "auto" : "none",
          }}
          onTouchStart={onPointerDown}
          onTouchEnd={onPointerUp}
          onTouchCancel={onPointerUp}
        >
          {scannerPane}
        </div>,
        document.body,
      )}
    </>
  );
}
