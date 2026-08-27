import { createFileRoute, Link } from "@tanstack/react-router";
import { PortalShell } from "@/components/layout/PortalShell";
import { useAuth } from "@/lib/auth";
import { formatNPR } from "@/lib/format";
import { roleLabel } from "@/lib/auth-destination";

export const Route = createFileRoute("/dealer/profile")({
  head: () => ({ meta: [{ title: "Profile — Dealer Portal" }] }),
  component: DealerProfilePage,
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 md:grid-cols-[11rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

function DealerProfilePage() {
  const { user, wallet } = useAuth();
  if (!user) return null;
  return (
    <PortalShell title="Profile" description="Account details for your Dealer / Sub-Agent portal">
      <div className="max-w-xl rounded-xl border border-border bg-surface p-4">
        <dl>
          <Row
            label="Name"
            value={[user.first_name, user.last_name].filter(Boolean).join(" ") || "—"}
          />
          <Row label="Phone" value={user.phone} />
          <Row label="Email" value={user.email || "—"} />
          <Row label="Role" value={roleLabel(user)} />
          <Row
            label="Assigned Dealer"
            value={
              user.assigned_dealer
                ? `${user.assigned_dealer.phone}${user.assigned_dealer.name ? ` (${user.assigned_dealer.name})` : ""}`
                : user.role === "dealer"
                  ? "—"
                  : "Unassigned"
            }
          />
          <Row
            label="Assigned Sub-Agent"
            value={
              user.assigned_sub_agent
                ? `${user.assigned_sub_agent.phone}${user.assigned_sub_agent.name ? ` (${user.assigned_sub_agent.name})` : ""}`
                : "—"
            }
          />
          <Row label="Wallet" value={formatNPR(wallet?.balance ?? "0")} />
        </dl>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link to="/app/profile" className="text-brand">
            Open full account settings
          </Link>
          <Link to="/app/profile/password" className="text-brand">
            Change password
          </Link>
        </div>
      </div>
    </PortalShell>
  );
}
