import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { Button } from "@/components/ui/button";
import { MerchantDashboard } from "@/components/merchant/MerchantDashboard";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/app/ggr")({
  component: GgrDashboardScreen,
});

function GgrDashboardScreen() {
  const { user } = useAuth();

  if (!user?.is_api_user) {
    return (
      <UserShell title="GGR Coin & Payment API">
        <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold">API Merchant Access Required</h2>
          <p className="text-sm text-gray-600 max-w-md">
            The GGR Coin service and Payment API are reserved for verified API merchants.
            Only a Super Admin or Shareholder can activate API access for your account.
          </p>
          <Button asChild variant="outline">
            <Link to="/app">Return to Personal Services</Link>
          </Button>
        </div>
      </UserShell>
    );
  }

  return (
    <UserShell title="GGR Gaming Engine" back="/app">
      <MerchantDashboard initialTab="ggr" />
    </UserShell>
  );
}
