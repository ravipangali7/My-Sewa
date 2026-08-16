import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ScanQrScreen } from "@/components/ScanQrScreen";
import { UserShell } from "@/components/layout/UserShell";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/app/scan")({
  head: () => ({
    meta: [
      { title: "Scan QR — Pay or Receive | MySewa" },
      {
        name: "description",
        content:
          "Scan a bank or wallet QR to pay, or show your Mysewa QR so others can load money into your wallet.",
      },
      { property: "og:title", content: "Scan QR — MySewa" },
    ],
  }),
  component: ScanPage,
});

function ScanPage() {
  const t = useT();
  const navigate = useNavigate();

  return (
    <UserShell title={t("scan.title")} hideHeader hideNav disablePullToRefresh>
      <ScanQrScreen
        onClose={() => navigate({ to: "/app" })}
        onPay={() => navigate({ to: "/app/transfer" })}
      />
    </UserShell>
  );
}
