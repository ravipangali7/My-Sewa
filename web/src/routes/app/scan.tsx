import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState, type PointerEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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
      { title: "Scan — MySewa Wallet Transfer" },
      {
        name: "description",
        content: "Scan a MySewa wallet QR to pay, or swipe up to show your QR to receive.",
      },
      { property: "og:title", content: "Scan — MySewa" },
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
  const [myQrOpen, setMyQrOpen] = useState(false);
  const startY = useRef<number | null>(null);

  const openMyQr = useCallback(() => setMyQrOpen(true), []);
  const closeMyQr = useCallback(() => setMyQrOpen(false), []);

  const onPointerDown = (event: PointerEvent) => {
    startY.current = event.clientY;
  };
  const onOpenMyQrPointerUp = (event: PointerEvent) => {
    if (startY.current == null) return;
    const dy = startY.current - event.clientY;
    startY.current = null;
    if (dy > 48) openMyQr();
  };
  const onCloseMyQrPointerUp = (event: PointerEvent) => {
    if (startY.current == null) return;
    const dy = startY.current - event.clientY;
    startY.current = null;
    if (dy < -48) closeMyQr();
  };

  if (myQrOpen) {
    return (
      <UserShell title={t("scan.myQr")} hideHeader hideNav disablePullToRefresh>
        <div
          className="relative flex h-full min-h-0 flex-col bg-ocean max-lg:fixed max-lg:inset-0 max-lg:z-40"
          onPointerDown={onPointerDown}
          onPointerUp={onCloseMyQrPointerUp}
        >
          <button
            type="button"
            onClick={closeMyQr}
            className={cn(
              "flex w-full flex-col items-center gap-1 pt-[max(12px,var(--safe-area-top,env(safe-area-inset-top,0px)))] text-white",
            )}
          >
            <span className="h-1 w-10 rounded-full bg-white/70" />
            <ChevronDown className="size-5" strokeWidth={2.4} />
          </button>

          <div className="flex items-center justify-between px-4 pb-2 pt-1">
            <div className="size-9" />
            <h1 className="text-[16px] font-semibold tracking-tight text-white">{t("scan.myQr")}</h1>
            <button
              type="button"
              onClick={closeMyQr}
              aria-label={t("common.goBack")}
              className="inline-flex size-9 items-center justify-center rounded-full border border-white/85 text-white"
            >
              ×
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-[max(20px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))]">
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
        </div>
      </UserShell>
    );
  }

  return (
    <UserShell title={t("scan.title")} hideHeader hideNav disablePullToRefresh>
      <ScanQrScreen
        onClose={() => navigate({ to: "/app" })}
        onPay={() => navigate({ to: "/app/transfer" })}
        footer={
          <button
            type="button"
            onClick={openMyQr}
            onPointerDown={onPointerDown}
            onPointerUp={onOpenMyQrPointerUp}
            className={cn(
              "flex w-full flex-col items-center gap-1 pb-[max(20px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] pt-3 text-white",
            )}
          >
            <span className="h-1 w-10 rounded-full bg-white/70" />
            <ChevronUp className="size-5" strokeWidth={2.4} />
            <span className="text-[13px] font-semibold tracking-wide">{t("scan.swipeForMyQr")}</span>
          </button>
        }
      />
    </UserShell>
  );
}
