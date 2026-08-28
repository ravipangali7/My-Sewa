import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState, type PointerEvent } from "react";
import { ChevronUp } from "lucide-react";
import { ScanQrScreen } from "@/components/ScanQrScreen";
import { MySewaPaymentQrCard } from "@/components/MySewaPaymentQrCard";
import { UserShell } from "@/components/layout/UserShell";
import { useMySewaPaymentQr } from "@/hooks/use-mysewa-payment-qr";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/scan")({
  head: () => ({
    meta: [
      { title: "My QR — MySewa Wallet Transfer" },
      {
        name: "description",
        content: "Show your MySewa QR to receive, or swipe up to scan another MySewa wallet.",
      },
      { property: "og:title", content: "My QR — MySewa" },
    ],
  }),
  component: ScanPage,
});

function ScanPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { logoUrl } = useSiteBranding();
  const qr = useMySewaPaymentQr(user);
  const [scannerOpen, setScannerOpen] = useState(false);
  const startY = useRef<number | null>(null);

  const openScanner = useCallback(() => setScannerOpen(true), []);

  const onPointerDown = (event: PointerEvent) => {
    startY.current = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (startY.current == null) return;
    const dy = startY.current - event.clientY;
    startY.current = null;
    if (dy > 48) openScanner();
  };

  if (scannerOpen) {
    return (
      <UserShell title={t("scan.title")} hideHeader hideNav disablePullToRefresh>
        <ScanQrScreen
          onClose={() => setScannerOpen(false)}
          onPay={() => navigate({ to: "/app/transfer" })}
        />
      </UserShell>
    );
  }

  return (
    <UserShell title={t("scan.myQr")} hideHeader hideNav disablePullToRefresh>
      <div className="relative flex h-full min-h-0 flex-col bg-ocean max-lg:fixed max-lg:inset-0 max-lg:z-40">
        <div className="flex items-center justify-between px-4 pt-[max(12px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-2">
          <div className="size-9" />
          <h1 className="text-[16px] font-semibold tracking-tight text-white">{t("scan.myQr")}</h1>
          <button
            type="button"
            onClick={() => navigate({ to: "/app" })}
            aria-label={t("common.goBack")}
            className="inline-flex size-9 items-center justify-center rounded-full border border-white/85 text-white"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
          <div className="w-full max-w-sm overflow-hidden rounded-[22px] shadow-[0_12px_40px_rgba(0,0,0,0.28)]">
            <MySewaPaymentQrCard
              qrSrc={qr.qrSrc}
              logoUrl={logoUrl || "/logo.png"}
              name={qr.displayName}
              username={qr.username}
              phone={qr.phone}
              hint={t("scan.showToReceive")}
              qrAlt={t("scan.myQr")}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={openScanner}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          className={cn(
            "flex w-full flex-col items-center gap-1 pb-[max(20px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] pt-3 text-white",
          )}
        >
          <span className="h-1 w-10 rounded-full bg-white/70" />
          <ChevronUp className="size-5" strokeWidth={2.4} />
          <span className="text-[13px] font-semibold tracking-wide">{t("transfer.swipeForScanner")}</span>
        </button>
      </div>
    </UserShell>
  );
}
