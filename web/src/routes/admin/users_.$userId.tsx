import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Pencil,
  Trash2,
  FileBarChart2,
  User,
  ShieldCheck,
  KeyRound,
  Coins,
  Wallet,
  Building2,
  Gamepad2,
  Calendar,
  Lock,
  ArrowRight,
  Sparkles,
  MinusCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";
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
import { canWalletAdjust } from "@/lib/account-status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserFeesForm } from "@/components/admin/UserFeesForm";
import { UserTransactionPinForm } from "@/components/admin/UserTransactionPinForm";
import { ServiceCommissionRulesForm } from "@/components/admin/ServiceCommissionRulesForm";
import { MySewaPaymentQrCard } from "@/components/MySewaPaymentQrCard";
import { useMySewaPaymentQr } from "@/hooks/use-mysewa-payment-qr";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { useT } from "@/lib/i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const Route = createFileRoute("/admin/users_/$userId")({
  head: () => ({
    meta: [
      { title: "User Details — MySewa Admin" },
      {
        name: "description",
        content: "View complete MySewa user account details including wallet, role, and permissions.",
      },
      { property: "og:title", content: "User Details — MySewa Admin" },
    ],
  }),
  component: UserDetailPage,
});

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-200/80 py-2.5 last:border-0 md:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)] md:gap-4 items-center">
      <dt className="min-w-0 break-words text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-xs sm:text-sm font-medium text-foreground">{children}</dd>
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

  const [deductModalOpen, setDeductModalOpen] = useState(false);
  const [deductAmount, setDeductAmount] = useState("");
  const [deductReason, setDeductReason] = useState("");

  const allowDeduct = Boolean((currentUser?.is_superuser || currentUser?.is_staff) && canWalletAdjust(currentUser));

  const deductMutation = useMutation({
    mutationFn: () =>
      apiClient.deductShareholderEarnings({
        shareholder_id: id,
        amount: deductAmount,
        reason: deductReason.trim(),
      }),
    onSuccess: (res) => {
      toast.success(res.message || "Deducted shareholder earnings successfully.");
      setDeductModalOpen(false);
      setDeductAmount("");
      setDeductReason("");
      queryClient.invalidateQueries({ queryKey: ["admin", "users", id] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to deduct shareholder earnings.");
    },
  });
  const t = useT();
  const { logoUrl } = useSiteBranding();
  const qr = useMySewaPaymentQr(u);

  const fullName = [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.phone || "User Details";
  const isShareholder = u?.role === "shareholder";
  const isDealer = u?.role === "dealer";

  return (
    <AdminShell
      title={fullName}
      description={u ? `Account #${u.id} · ${u.phone}` : userQuery.isLoading ? "Loading profile…" : "User not found"}
      actions={
        u ? (
          <div className="flex shrink-0 items-center gap-2 [&>*]:shrink-0">
            <Button asChild size="sm" variant="outline" className="h-8 text-xs bg-white shadow-2xs hover:bg-slate-50 ">
              <Link to="/admin/users/$userId/report" params={{ userId }}>
                <FileBarChart2 className="size-3.5 mr-1" />
                Report
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs bg-white shadow-2xs hover:bg-slate-50 ">
              <Link to="/admin/users/$userId/edit" params={{ userId }}>
                <Pencil className="size-3.5 mr-1" />
                Edit Profile
              </Link>
            </Button>
            {u.is_api_user ? (
              <Button asChild size="sm" variant="outline" className="h-8 text-xs bg-white shadow-2xs hover:bg-slate-50  text-teal-700 dark:text-teal-300">
                <Link to="/admin/api-users/$userId" params={{ userId }}>
                  <KeyRound className="size-3.5 mr-1" />
                  API Keys
                </Link>
              </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-slate-200 text-danger hover:bg-red-50 dark:hover:bg-red-950/40"
                  disabled={isSelf || deleteMutation.isPending || !u.is_active}
                >
                  <Trash2 className="size-3.5 mr-1" />
                  {u.is_active ? "Deactivate" : "Deactivated"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Deactivate this account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will disable sign-in access for {u.phone} while retaining all financial history and transaction logs.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-danger text-white hover:bg-danger/90"
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
        <BackButton to="/admin/users" label="Back to user directory" />
      </div>

      {userQuery.isError && (
        <div className="rounded-sm border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {userQuery.error instanceof ApiError ? userQuery.error.message : "User could not be loaded."}
        </div>
      )}

      {u && (
        <div className="space-y-6">
          {/* Executive User Summary Banner */}
          <div className="rounded-md border border-slate-200 bg-white p-5 sm:p-6 shadow-xs ">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <Avatar className="size-14 sm:size-16 ring-2 ring-border/80">
                  {u.avatar_url ? <AvatarImage src={u.avatar_url} alt={fullName} /> : null}
                  <AvatarFallback className="bg-emerald-100 text-lg font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {u.first_name?.[0] || u.phone[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg sm:text-xl font-bold text-foreground">{fullName}</h2>
                    <Badge variant={u.account_status === "approved" ? "default" : "secondary"} className="text-[10px] font-bold">
                      {u.account_status === "approved" ? "Active" : "Pending Approval"}
                    </Badge>
                    <Badge variant={u.is_active ? "default" : "secondary"} className="text-[10px]">
                      {u.is_active ? "Login Allowed" : "Login Locked"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{u.phone} {u.email && `· ${u.email}`}</p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-2">
                    {u.is_superuser && (
                      <span className="rounded-md bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                        Super Administrator
                      </span>
                    )}
                    {u.is_staff && !u.is_superuser && (
                      <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                        Staff Admin
                      </span>
                    )}
                    {isShareholder && (
                      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300 flex items-center gap-1">
                        <Sparkles className="size-2.5 text-amber-600" />
                        Shareholder ({u.share_percent ?? "0"}% Equity)
                      </span>
                    )}
                    {isDealer && (
                      <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                        Dealer Agent Partner
                      </span>
                    )}
                    {!isShareholder && !isDealer && !u.is_staff && !u.is_superuser && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Standard User
                      </span>
                    )}
                    {u.is_api_user && (
                      <span className="rounded-md bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                        REST API Enabled
                      </span>
                    )}
                    {(u.is_ggr_user || u.is_ggr) && (
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center gap-1">
                        <Gamepad2 className="size-2.5" />
                        GGR Gaming
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Wallet Balance Hero Badge */}
              <div className="rounded-sm border border-slate-200/90 bg-slate-50/70 p-4 sm:text-right /60">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Available Wallet Balance</p>
                <div className="text-2xl font-extrabold text-foreground tabular font-mono">
                  {formatNPR(u.wallet_balance ?? "0.00")}
                </div>
                <div className="flex sm:justify-end items-center gap-2 pt-1 text-[11px]">
                  <span className={u.wallet_frozen ? "text-danger font-semibold" : "text-emerald-600 font-semibold"}>
                    {u.wallet_frozen ? "● Wallet Frozen" : "● Active / Unfrozen"}
                  </span>
                  <span className="text-muted-foreground font-mono">#{u.wallet_id ?? "—"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Group 1 & Group 2 Grid */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* GROUP A: Profile & Identity */}
            <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs ">
              <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-slate-200/90">
                <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                  <User className="size-4" />
                </div>
                <h3 className="text-sm font-bold text-foreground">Identity & Profile Information</h3>
              </div>
              <dl>
                <DetailRow label="Account ID">#{u.id}</DetailRow>
                <DetailRow label="Mobile Phone">{u.phone}</DetailRow>
                <DetailRow label="Full Name">{[u.first_name, u.last_name].filter(Boolean).join(" ") || "—"}</DetailRow>
                <DetailRow label="Nickname / Alias">{u.nickname || "—"}</DetailRow>
                <DetailRow label="Business Name">{u.business_name || "—"}</DetailRow>
                <DetailRow label="Email Address">{u.email || "—"}</DetailRow>
                <DetailRow label="KYC Verification Status">
                  <Badge variant={u.kyc_verified ? "default" : "secondary"}>
                    {u.kyc_status ? u.kyc_status.toUpperCase() : u.kyc_verified ? "VERIFIED" : "UNVERIFIED"}
                  </Badge>
                </DetailRow>
                <DetailRow label="Joined Platform">{formatDateTime(u.date_joined)}</DetailRow>
                <DetailRow label="Last Active Session">{u.last_login ? formatDateTime(u.last_login) : "Never logged in"}</DetailRow>
              </dl>
            </div>

            {/* GROUP B: Business Role & Hierarchy */}
            <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs ">
              <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-slate-200/90">
                <div className="flex size-7 items-center justify-center rounded-lg bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400">
                  <Building2 className="size-4" />
                </div>
                <h3 className="text-sm font-bold text-foreground">Role & Network Position</h3>
              </div>
              <dl>
                <DetailRow label="Assigned Role">
                  {isShareholder ? "Shareholder Equity Partner" : isDealer ? "Dealer / Agent Network" : "Standard Customer"}
                </DetailRow>
                {isShareholder && (
                  <>
                    <DetailRow label="Equity Share Ratio">
                      <span className="font-mono font-bold text-amber-700 dark:text-amber-300">
                        {u.share_percent ?? "0.00"}% Equity Pool
                      </span>
                    </DetailRow>
                    <DetailRow label="Share Income Balance">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          {formatNPR(u.shareholder_wallet_balance ?? "0.00")}
                        </span>
                        {allowDeduct && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => setDeductModalOpen(true)}
                            className="h-6 text-[11px] px-2 border-rose-200 text-rose-600 hover:text-rose-700 hover:bg-rose-50 font-medium"
                          >
                            <MinusCircle className="size-3 mr-1" />
                            Deduct Earnings
                          </Button>
                        )}
                      </div>
                    </DetailRow>
                    <DetailRow label="Total Earned Dividends">
                      <span className="font-mono text-slate-600 dark:text-slate-400">
                        {formatNPR(u.shareholder_total_earned ?? "0.00")}
                      </span>
                    </DetailRow>
                    <DetailRow label="Dividend Access">
                      <Button asChild size="xs" variant="outline" className="text-xs">
                        <Link to="/admin/shareholders">
                          <Coins className="size-3 mr-1" />
                          View Shareholder Ledger
                        </Link>
                      </Button>
                    </DetailRow>
                  </>
                )}
                {isDealer && (
                  <>
                    <DetailRow label="Base Commission">{formatNPR(u.commission_rate ?? "0")}</DetailRow>
                    <DetailRow label="TDS Tax Rate">{u.tds_rate ? `${u.tds_rate}%` : "Global Default"}</DetailRow>
                    <DetailRow label="Sub-Agent Rate">{formatNPR(u.sub_agent_commission_rate ?? "0")}</DetailRow>
                    <DetailRow label="Super Admin Rate">{formatNPR(u.super_admin_rate ?? "0")}</DetailRow>
                  </>
                )}
                {!isDealer && !isShareholder && (
                  <DetailRow label="Assigned Dealer">
                    {u.assigned_dealer
                      ? `${u.assigned_dealer.phone}${u.assigned_dealer.name ? ` (${u.assigned_dealer.name})` : ""}`
                      : "Direct Account (No dealer)"}
                  </DetailRow>
                )}
                <DetailRow label="Administrative Staff">
                  <Badge variant={u.is_staff ? "default" : "secondary"}>{u.is_staff ? "Yes — Staff" : "No"}</Badge>
                </DetailRow>
                <DetailRow label="Superuser Privileges">
                  <Badge variant={u.is_superuser ? "default" : "secondary"}>{u.is_superuser ? "Root Superuser" : "Standard"}</Badge>
                </DetailRow>
              </dl>
            </div>
          </div>

          {/* Group 3 & Group 4 Grid */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* GROUP C: Developer API & Gaming Integrations */}
            <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs ">
              <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-slate-200/90">
                <div className="flex size-7 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400">
                  <KeyRound className="size-4" />
                </div>
                <h3 className="text-sm font-bold text-foreground">API & Gaming Integrations</h3>
              </div>
              <dl>
                <DetailRow label="Developer API Key Access">
                  <Badge variant={u.is_api_user ? "default" : "secondary"}>
                    {u.is_api_user ? "Active API Partner" : "Disabled"}
                  </Badge>
                </DetailRow>
                <DetailRow label="Payin / Wallet Load API">
                  <Badge variant={u.can_api_payin ? "default" : "secondary"}>
                    {u.can_api_payin ? "Authorized for Payin" : "Not Permitted"}
                  </Badge>
                </DetailRow>
                <DetailRow label="GGR Gaming Coin Economy">
                  <Badge variant={u.is_ggr_user || u.is_ggr ? "default" : "secondary"}>
                    {u.is_ggr_user || u.is_ggr ? "GGR Gaming Enabled" : "Standard Account"}
                  </Badge>
                </DetailRow>
                {u.is_api_user && (
                  <DetailRow label="Manage Credentials">
                    <Button asChild size="xs" variant="outline" className="text-xs">
                      <Link to="/admin/api-users/$userId" params={{ userId }}>
                        <KeyRound className="size-3 mr-1" />
                        Configure API Keys & Webhooks
                      </Link>
                    </Button>
                  </DetailRow>
                )}
              </dl>
            </div>

            {/* GROUP D: Financial Feature Permissions */}
            <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs ">
              <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-slate-200/90">
                <div className="flex size-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                  <Wallet className="size-4" />
                </div>
                <h3 className="text-sm font-bold text-foreground">Financial Capabilities & Security</h3>
              </div>
              <dl>
                <DetailRow label="Bank Fund Transfers">
                  <Badge variant={u.can_fund_transfer !== false ? "default" : "secondary"}>
                    {u.can_fund_transfer !== false ? "Permitted" : "Revoked"}
                  </Badge>
                </DetailRow>
                <DetailRow label="Remittance Cash Payouts">
                  <Badge variant={u.can_remittance_transfer !== false ? "default" : "secondary"}>
                    {u.can_remittance_transfer !== false ? "Permitted" : "Revoked"}
                  </Badge>
                </DetailRow>
                <DetailRow label="Wallet Adjustments & P2P">
                  <Badge variant={u.can_wallet_adjust !== false ? "default" : "secondary"}>
                    {u.can_wallet_adjust !== false ? "Permitted" : "Revoked"}
                  </Badge>
                </DetailRow>
                <DetailRow label="Transaction PIN Set">
                  <Badge variant={u.has_transaction_pin ? "default" : "secondary"}>
                    {u.has_transaction_pin ? "Active (4 Digits)" : "Not Configured"}
                  </Badge>
                </DetailRow>
              </dl>
            </div>
          </div>

          {/* QR Payment Card */}
          <div className="min-w-0 overflow-x-clip rounded-md border border-slate-200 bg-white shadow-xs ">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <h2 className="text-sm font-bold">{t("scan.myQr")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Digital Payment QR for peer-to-peer transfers into this wallet.
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

          {/* Sub-Forms: Transaction PIN, Custom Fees & Commission Rules */}
          <div className="space-y-5">
            <UserTransactionPinForm
              userId={u.id}
              hasPin={Boolean(u.has_transaction_pin)}
            />
            <UserFeesForm userId={u.id} />
            <ServiceCommissionRulesForm userId={u.id} enabled={u.role === "dealer"} />
          </div>
        </div>
      )}

      {/* DEDUCT SHAREHOLDER EARNINGS DIALOG */}
      {isShareholder && (
        <Dialog open={deductModalOpen} onOpenChange={setDeductModalOpen}>
          <DialogContent className="sm:max-w-md bg-white p-5 rounded-md shadow-lg border border-slate-200">
            <DialogHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-rose-50 text-rose-700 rounded-md border border-rose-200">
                  <MinusCircle className="size-4" />
                </div>
                <DialogTitle className="text-sm font-bold text-slate-900">
                  Deduct Shareholder Share Income
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-slate-500">
                Debit accumulated share income / platform fee earnings from {fullName}'s balance.
              </DialogDescription>
            </DialogHeader>

            {u && (
              <div className="space-y-4 pt-1">
                {/* Summary Info Box */}
                <div className="p-3 rounded-md bg-slate-50 border border-slate-200/90 space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Partner:</span>
                    <span className="font-semibold text-slate-900">{fullName}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Phone / Account:</span>
                    <span className="font-mono text-slate-700 font-semibold">{u.phone}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Equity Share:</span>
                    <span className="font-bold text-amber-700 font-mono">{u.share_percent ?? "0"}%</span>
                  </div>
                  <div className="border-t border-slate-200 pt-1.5 flex justify-between items-center">
                    <span className="text-slate-600 font-bold">Current Available Earnings:</span>
                    <span className="font-bold text-emerald-700 font-mono text-sm">
                      {formatNPR(u.shareholder_wallet_balance ?? "0.00")}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Total Lifetime Earned:</span>
                    <span className="font-mono text-slate-600">{formatNPR(u.shareholder_total_earned ?? "0.00")}</span>
                  </div>
                </div>

                {/* Amount Input */}
                <div className="space-y-1.5">
                  <Label htmlFor="sh-deduct-amount" className="text-xs font-semibold text-slate-800 flex items-center justify-between">
                    <span>Deduction Amount (NPR) *</span>
                    <span className="text-[10px] text-slate-400 font-normal">Max: {formatNPR(u.shareholder_wallet_balance ?? "0.00")}</span>
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 font-mono">
                      Rs.
                    </span>
                    <Input
                      id="sh-deduct-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={u.shareholder_wallet_balance ?? undefined}
                      placeholder="0.00"
                      value={deductAmount}
                      onChange={(e) => setDeductAmount(e.target.value)}
                      className="pl-9 font-mono text-xs h-9 rounded-sm border-slate-200"
                    />
                  </div>
                  {/* Balance Preview */}
                  {Number(deductAmount) > 0 && (
                    <div className="text-[11px] flex justify-between items-center px-1 font-mono">
                      <span className="text-slate-500">Remaining Balance:</span>
                      <span className={`font-bold ${Number(deductAmount) > Number(u.shareholder_wallet_balance || 0) ? "text-rose-600" : "text-slate-700"}`}>
                        {Number(deductAmount) > Number(u.shareholder_wallet_balance || 0)
                          ? "Insufficient Balance!"
                          : formatNPR(Math.max(0, Number(u.shareholder_wallet_balance || 0) - Number(deductAmount)))}
                      </span>
                    </div>
                  )}
                </div>

                {/* Reason Input */}
                <div className="space-y-1.5">
                  <Label htmlFor="sh-deduct-reason" className="text-xs font-semibold text-slate-800">
                    Reason for Deduction *
                  </Label>
                  <Input
                    id="sh-deduct-reason"
                    placeholder="e.g. Reconciliation adjustment, clawback, fee correction"
                    value={deductReason}
                    onChange={(e) => setDeductReason(e.target.value)}
                    className="text-xs h-9 rounded-sm border-slate-200"
                  />
                  <p className="text-[10px] text-slate-400">
                    Required for the audit trail and emailed to the shareholder.
                  </p>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0 pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeductModalOpen(false)}
                className="rounded-sm text-xs h-8 border-slate-200"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => deductMutation.mutate()}
                disabled={
                  deductMutation.isPending ||
                  !deductAmount ||
                  Number(deductAmount) <= 0 ||
                  Number(deductAmount) > Number(u?.shareholder_wallet_balance || 0) ||
                  !deductReason.trim()
                }
                className="bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-sm text-xs h-8 px-4"
              >
                {deductMutation.isPending ? "Deducting..." : "Confirm Deduction"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </AdminShell>
  );
}
