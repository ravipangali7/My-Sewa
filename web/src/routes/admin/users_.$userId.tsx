import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2, FileBarChart2 } from "lucide-react";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiClient, ApiError } from "@/lib/api";
import { adminLiveQueryOptions } from "@/lib/refresh";
import { formatNPR, formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { UserFeesForm } from "@/components/admin/UserFeesForm";
import { UserTransactionPinForm } from "@/components/admin/UserTransactionPinForm";
import { ServiceCommissionRulesForm } from "@/components/admin/ServiceCommissionRulesForm";
import { MySewaPaymentQrCard } from "@/components/MySewaPaymentQrCard";
import { useMySewaPaymentQr } from "@/hooks/use-mysewa-payment-qr";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/admin/users_/$userId")({
  head: () => ({
    meta: [
      { title: "User Details — MySewa Admin" },
      {
        name: "description",
        content: "View complete MySewa user account details including wallet and permissions.",
      },
      { property: "og:title", content: "User Details — MySewa Admin" },
    ],
  }),
  component: UserDetailPage,
});

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border py-3 last:border-0 md:grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)] md:gap-4">
      <dt className="min-w-0 break-words text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-sm font-medium">{children}</dd>
    </div>
  );
}

function UserDetailPage() {
  const { userId } = Route.useParams();
  const id = Number(userId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const userQuery = useQuery({
    queryKey: ["admin", "users", id],
    queryFn: () => apiClient.adminGetUser(id),
    enabled: Number.isFinite(id),
    ...adminLiveQueryOptions(),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.adminDeleteUser(id),
    onSuccess: () => {
      toast.success("User account deactivated");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      navigate({ to: "/admin/users" });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not deactivate user");
    },
  });

  const u = userQuery.data;
  const isSelf = currentUser?.id === id;
  const t = useT();
  const { logoUrl } = useSiteBranding();
  const qr = useMySewaPaymentQr(u);

  return (
    <AdminShell
      title={u ? ([u.first_name, u.last_name].filter(Boolean).join(" ") || u.phone) : "User"}
      description={u ? `User #${u.id}` : userQuery.isLoading ? "Loading…" : "Not found"}
      actions={
        u ? (
          <div className="flex shrink-0 items-center gap-2 [&>*]:shrink-0">
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/users/$userId/report" params={{ userId }}>
                <FileBarChart2 className="size-3.5" />
                View Report
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/users/$userId/edit" params={{ userId }}>
                <Pencil className="size-3.5" />
                Edit
              </Link>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSelf || deleteMutation.isPending || !u.is_active}
                >
                  <Trash2 className="size-3.5" />
                  {u.is_active ? "Deactivate" : "Deactivated"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Deactivate this user?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This disables {u.phone} and keeps their data. They will not be able to
                    log in until an admin re-enables the account.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteMutation.mutate()}
                  >
                    Deactivate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : undefined
      }
    >
      <div className="mb-5">
        <BackButton to="/admin/users" label="Back to users" />
      </div>

      {userQuery.isError && (
        <p className="text-sm text-muted-foreground">
          {userQuery.error instanceof ApiError ? userQuery.error.message : "User not found."}
        </p>
      )}

      {u && (
        <div className="space-y-5">
        <div className="min-w-0 overflow-x-clip rounded-xl border border-border bg-surface p-4 sm:p-5">
          <dl>
              <DetailRow label="ID">{u.id}</DetailRow>
              <DetailRow label="Phone">{u.phone}</DetailRow>
              <DetailRow label="First name">{u.first_name || "—"}</DetailRow>
              <DetailRow label="Last name">{u.last_name || "—"}</DetailRow>
              <DetailRow label="Nickname">{u.nickname || "—"}</DetailRow>
              <DetailRow label="Email">{u.email || "—"}</DetailRow>
              <DetailRow label="Account status">
                <Badge variant={u.account_status === "approved" ? "default" : "secondary"}>
                  {u.account_status === "approved" ? "Active" : "Pending"}
                </Badge>
              </DetailRow>
              <DetailRow label="Login">
                <Badge variant={u.is_active ? "default" : "secondary"}>
                  {u.is_active ? "Enabled" : "Disabled"}
                </Badge>
              </DetailRow>
              <DetailRow label="Role">
                {u.is_superuser ? "Superuser" : u.is_staff ? "Staff" : (u.role || "customer")}
              </DetailRow>
              <DetailRow label="Assigned Dealer">
                {u.assigned_dealer
                  ? `${u.assigned_dealer.phone}${u.assigned_dealer.name ? ` (${u.assigned_dealer.name})` : ""}`
                  : u.role === "dealer"
                    ? "—"
                    : "Unassigned"}
              </DetailRow>
              <DetailRow label="Parent Agent">
                {u.parent_agent
                  ? `${u.parent_agent.phone}${u.parent_agent.name ? ` (${u.parent_agent.name})` : ""}`
                  : "—"}
              </DetailRow>
              <DetailRow label="Assigned Sub-Agent">
                {u.assigned_sub_agent
                  ? `${u.assigned_sub_agent.phone}${u.assigned_sub_agent.name ? ` (${u.assigned_sub_agent.name})` : ""}`
                  : "—"}
              </DetailRow>
              <DetailRow label="Staff">{u.is_staff ? "Yes" : "No"}</DetailRow>
              <DetailRow label="Superuser">{u.is_superuser ? "Yes" : "No"}</DetailRow>
              <DetailRow label="Fund Transfer">
                <Badge variant={u.can_fund_transfer !== false ? "default" : "secondary"}>
                  {u.can_fund_transfer !== false ? "Enabled" : "Disabled"}
                </Badge>
              </DetailRow>
              <DetailRow label="Remittance Transfer">
                <Badge variant={u.can_remittance_transfer !== false ? "default" : "secondary"}>
                  {u.can_remittance_transfer !== false ? "Enabled" : "Disabled"}
                </Badge>
              </DetailRow>
              <DetailRow label="Wallet Transfer">
                <Badge variant={u.can_wallet_adjust !== false ? "default" : "secondary"}>
                  {u.can_wallet_adjust !== false ? "Enabled" : "Disabled"}
                </Badge>
              </DetailRow>
              {u.role === "dealer" || u.role === "sub_agent" ? (
                <>
                  <DetailRow label="Commission rate">{u.commission_rate ?? "0"}%</DetailRow>
                  {u.role === "dealer" ? (
                    <>
                      <DetailRow label="TDS rate">{u.tds_rate ?? "Global default"}%</DetailRow>
                      <DetailRow label="Sub-Agent rate">{u.sub_agent_commission_rate ?? "0"}%</DetailRow>
                      <DetailRow label="Super Admin share">{u.super_admin_rate ?? "0"}%</DetailRow>
                    </>
                  ) : null}
                </>
              ) : null}
              <DetailRow label="Wallet status">
                <Badge variant={u.wallet_frozen ? "secondary" : "default"}>
                  {u.wallet_frozen ? "Frozen" : "Active / Unfrozen"}
                </Badge>
              </DetailRow>
              <DetailRow label="Wallet ID">{u.wallet_id ?? "—"}</DetailRow>
              <DetailRow label="Wallet balance">
                <span className="tabular">{formatNPR(u.wallet_balance ?? "0.00")}</span>
              </DetailRow>
              <DetailRow label="Transaction PIN">
                <Badge variant={u.has_transaction_pin ? "default" : "secondary"}>
                  {u.has_transaction_pin ? "Set" : "Not set"}
                </Badge>
              </DetailRow>
              <DetailRow label="Date joined">{formatDateTime(u.date_joined)}</DetailRow>
              <DetailRow label="Last login">
                {u.last_login ? formatDateTime(u.last_login) : "Never"}
              </DetailRow>
              {u.avatar_url && (
                <DetailRow label="Avatar">
                  <img
                    src={u.avatar_url}
                    alt=""
                    className="size-16 rounded-full object-cover"
                  />
                </DetailRow>
              )}
            </dl>
          </div>
          <div className="min-w-0 overflow-x-clip rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <h2 className="text-sm font-semibold">{t("scan.myQr")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Same payload as the user My QR. HimalPay Reseller API cannot accept
                interoperable bank-app QR payments into this wallet.
              </p>
            </div>
            <MySewaPaymentQrCard
              qrSrc={qr.qrSrc}
              logoUrl={logoUrl || "/logo.png"}
              name={qr.displayName}
              username={qr.username}
              phone={qr.phone}
              hint={t("scan.showToReceive")}
              qrAlt={t("scan.myQr")}
              emptyLabel={userQuery.isLoading ? t("common.loading") : "—"}
            />
          </div>
          <UserTransactionPinForm
            userId={u.id}
            hasPin={Boolean(u.has_transaction_pin)}
          />
          <UserFeesForm userId={u.id} />
          <ServiceCommissionRulesForm userId={u.id} enabled={u.role === "dealer"} />
        </div>
      )}
    </AdminShell>
  );
}
