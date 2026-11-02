import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Coins,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  Percent,
  Sliders,
  Landmark,
  RotateCcw,
  Users,
  History,
  CheckCircle2,
  Calendar,
  Sparkles,
  ShieldCheck,
  CreditCard,
  Building,
  RefreshCw,
  Clock,
  ArrowRight,
  DollarSign,
  AlertCircle,
  Plus,
} from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiClient } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin/shareholders")({
  head: () => ({
    meta: [
      { title: "Shareholder Revenue & Governance — MySewa Admin" },
      {
        name: "description",
        content:
          "Platform fee settlement portal, equity cap table distribution, GGR cuts, and shareholder payouts.",
      },
    ],
  }),
  component: ShareholderAdminScreen,
});

function ShareholderAdminScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Withdraw Modal State
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("bank");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");

  // Fee Config Modal State
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [ggrPercent, setGgrPercent] = useState("10.00");
  const [depPercent, setDepPercent] = useState("1.50");
  const [wthPercent, setWthPercent] = useState("2.00");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["shareholder-dashboard"],
    queryFn: () => apiClient.getShareholderDashboard(),
  });

  const withdrawMutation = useMutation({
    mutationFn: () =>
      apiClient.shareholderWithdraw({
        amount: withdrawAmount,
        payout_method: payoutMethod,
        account_name: accountName,
        account_number: accountNumber,
        bank_name: payoutMethod === "bank" ? bankName : undefined,
      }),
    onSuccess: (res) => {
      toast.success(res.message);
      setWithdrawModalOpen(false);
      setWithdrawAmount("");
      setAccountName("");
      setAccountNumber("");
      setBankName("");
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Withdrawal failed.");
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: () =>
      apiClient.updatePlatformFeeConfig({
        ggr_monthly_profit_percent: ggrPercent,
        payment_api_deposit_percent: depPercent,
        payment_api_withdraw_percent: wthPercent,
      }),
    onSuccess: (res) => {
      toast.success(res.message || "Fee rates updated successfully!");
      setConfigModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update rates.");
    },
  });

  const settleMutation = useMutation({
    mutationFn: () => apiClient.settleMonthlyGgr({}),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to run settlement.");
    },
  });

  const openConfigDialog = () => {
    if (data?.service_fee_config) {
      setGgrPercent(String(data.service_fee_config.ggr_monthly_profit_percent));
      setDepPercent(String(data.service_fee_config.payment_api_deposit_percent));
      setWthPercent(String(data.service_fee_config.payment_api_withdraw_percent));
    }
    setConfigModalOpen(true);
  };

  const handleMaxWithdraw = () => {
    if (data?.my_wallet?.balance) {
      setWithdrawAmount(data.my_wallet.balance);
    }
  };

  return (
    <AdminShell
      title="Shareholder Governance & Revenue"
      description="Automated dividend distribution, equity cap table, and platform fee settlement"
    >
      <div className="space-y-6 pb-12">
        {/* Executive Banner Header in Classic Clean White */}
        <div className="rounded-2xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/70 via-white to-slate-50 p-6 shadow-xs relative overflow-hidden dark:bg-card dark:border-border dark:from-card dark:to-card">
          <div className="absolute right-0 top-0 bottom-0 w-96 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-emerald-500/10 via-teal-500/5 to-transparent pointer-events-none" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 relative z-10">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] font-bold tracking-wider uppercase text-emerald-800 font-mono dark:text-emerald-400">
                  Platform Equity Governance
                </span>
                {data?.is_shareholder && (
                  <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-300 font-bold dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700">
                    {data.my_wallet?.share_percent || "0"}% Equity Partner
                  </span>
                )}
                {user?.is_superuser && (
                  <span className="text-[10px] bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full border border-purple-300 font-bold dark:bg-purple-950 dark:text-purple-300 dark:border-purple-700">
                    Superadmin Authority
                  </span>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
                <Building className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                Shareholder Revenue & Fee Settlement Portal
              </h1>
              <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
                Automated equity distribution from monthly 10% GGR game profits and Payment API transaction fees.
                Platform cuts are credited directly into shareholder equity wallets.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className="h-8 text-xs bg-white border-border shadow-2xs hover:bg-slate-50 dark:bg-card"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={openConfigDialog}
                className="h-8 text-xs bg-white border-border shadow-2xs hover:bg-slate-50 dark:bg-card text-amber-800 dark:text-amber-300"
              >
                <Sliders className="h-3.5 w-3.5 mr-1.5 text-amber-600" />
                Configure Rates
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => settleMutation.mutate()}
                disabled={settleMutation.isPending}
                className="h-8 text-xs bg-white border-border shadow-2xs hover:bg-slate-50 dark:bg-card text-blue-700 dark:text-blue-300"
              >
                <Calendar className="h-3.5 w-3.5 mr-1.5 text-blue-600" />
                {settleMutation.isPending ? "Settling..." : "Run Monthly Settlement"}
              </Button>

              {data?.is_shareholder && (
                <Button
                  size="sm"
                  onClick={() => setWithdrawModalOpen(true)}
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-xs"
                >
                  <Landmark className="h-3.5 w-3.5 mr-1.5" />
                  Withdraw My Balance
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Executive Top Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-border bg-white p-5 shadow-xs space-y-2 dark:bg-card">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="h-4 w-4 text-amber-500" />
              Total Platform Fee Pool
            </span>
            <div className="text-2xl font-extrabold text-foreground tabular font-mono">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.total_platform_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">Cumulative service revenue across all services</p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-5 shadow-xs space-y-2 dark:bg-card">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              GGR Monthly Cuts
            </span>
            <div className="text-2xl font-extrabold text-emerald-600 tabular font-mono">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.ggr_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Current Rate: {data?.service_fee_config?.ggr_monthly_profit_percent || 10}% of net profit
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-5 shadow-xs space-y-2 dark:bg-card">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ArrowDownLeft className="h-4 w-4 text-blue-500" />
              Deposit API Revenue
            </span>
            <div className="text-2xl font-extrabold text-blue-600 tabular font-mono">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.api_deposit_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Current Rate: {data?.service_fee_config?.payment_api_deposit_percent || 1.5}% per deposit
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-white p-5 shadow-xs space-y-2 dark:bg-card">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ArrowUpRight className="h-4 w-4 text-indigo-500" />
              Withdraw API Revenue
            </span>
            <div className="text-2xl font-extrabold text-indigo-600 tabular font-mono">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.api_withdraw_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Current Rate: {data?.service_fee_config?.payment_api_withdraw_percent || 2.0}% per payout
            </p>
          </div>
        </div>

        {/* Shareholder Wallet Card (If logged in user is shareholder) */}
        {data?.is_shareholder && (
          <div className="rounded-2xl border border-emerald-300/80 bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/30 p-6 shadow-xs relative overflow-hidden dark:bg-card dark:border-emerald-800 dark:from-card dark:to-card">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="space-y-1.5">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-2 dark:text-emerald-400">
                  <Wallet className="h-4 w-4" />
                  My Withdrawable Equity Balance
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-foreground tabular font-mono">
                  {formatNPR(Number(data?.my_wallet?.balance || 0))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
                  <span>Total Earned: <strong className="text-foreground">{formatNPR(Number(data?.my_wallet?.total_earned || 0))}</strong></span>
                  <span>•</span>
                  <span>Total Withdrawn: <strong className="text-foreground">{formatNPR(Number(data?.my_wallet?.total_withdrawn || 0))}</strong></span>
                  <span>•</span>
                  <span>Allocated Share: <strong className="text-emerald-600">{data?.my_wallet?.share_percent}%</strong></span>
                </div>
              </div>

              <Button
                onClick={() => setWithdrawModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 h-10 shadow-xs text-xs"
              >
                <Landmark className="h-4 w-4 mr-1.5" />
                Request Profit Withdrawal
              </Button>
            </div>
          </div>
        )}

        {/* Tabbed Views: Cap Table, Revenue Audit Stream, Withdrawals */}
        <Tabs defaultValue="shareholders" className="space-y-4">
          <TabsList className="grid grid-cols-3 w-full bg-slate-100/80 p-1 rounded-xl dark:bg-card">
            <TabsTrigger value="shareholders" className="text-xs font-semibold">
              <Users className="h-3.5 w-3.5 mr-1.5" />
              Cap Table & Equity ({data?.shareholders?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="audit-stream" className="text-xs font-semibold">
              <History className="h-3.5 w-3.5 mr-1.5" />
              Live Revenue Stream
            </TabsTrigger>
            <TabsTrigger value="withdrawals" className="text-xs font-semibold">
              <Landmark className="h-3.5 w-3.5 mr-1.5" />
              Withdrawal History
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: SHAREHOLDERS CAP TABLE */}
          <TabsContent value="shareholders" className="rounded-2xl border border-border bg-white p-5 space-y-4 shadow-xs dark:bg-card">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/80 pb-3">
              <div>
                <h3 className="font-bold text-sm flex items-center gap-2 text-foreground">
                  <Users className="h-4 w-4 text-emerald-600" />
                  Shareholder Equity Partners
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Accounts configured with the "Shareholder" role. Fee allocations are divided automatically by equity %.
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="text-xs self-start sm:self-auto bg-white hover:bg-slate-50 dark:bg-card">
                <Link to="/admin/users/new">
                  <Plus className="size-3.5 mr-1" />
                  Add Shareholder
                </Link>
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-muted-foreground uppercase text-[10px] font-mono border-b border-border/70 dark:bg-card/70">
                  <tr>
                    <th className="p-3">Partner</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">Equity Share %</th>
                    <th className="p-3">Withdrawable Balance</th>
                    <th className="p-3">Total Earned</th>
                    <th className="p-3">Total Withdrawn</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {data?.shareholders && data.shareholders.length > 0 ? (
                    data.shareholders.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/70 transition-colors dark:hover:bg-muted/30">
                        <td className="p-3 font-semibold text-foreground">
                          {s.first_name || s.last_name ? `${s.first_name} ${s.last_name}` : "Shareholder Partner"}
                          {s.id === user?.id && (
                            <span className="ml-2 px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] rounded font-bold dark:bg-emerald-950 dark:text-emerald-300">
                              YOU
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-mono">{s.phone}</td>
                        <td className="p-3 font-mono font-bold text-amber-700 dark:text-amber-400">
                          {s.share_percent}%
                        </td>
                        <td className="p-3 font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          {formatNPR(Number(s.balance))}
                        </td>
                        <td className="p-3 font-mono">{formatNPR(Number(s.total_earned))}</td>
                        <td className="p-3 font-mono text-muted-foreground">{formatNPR(Number(s.total_withdrawn))}</td>
                        <td className="p-3">
                          <Button asChild size="xs" variant="outline" className="h-7 text-[11px] bg-white hover:bg-slate-50 dark:bg-card">
                            <Link to="/admin/users/$userId" params={{ userId: String(s.id) }}>
                              View Account
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">
                        No shareholder partners created yet. Superadmin can designate any user as a Shareholder in the User Directory.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* TAB 2: LIVE REVENUE AUDIT STREAM */}
          <TabsContent value="audit-stream" className="rounded-2xl border border-border bg-white p-5 space-y-4 shadow-xs dark:bg-card">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <div>
                <h3 className="font-bold text-sm flex items-center gap-2 text-foreground">
                  <History className="h-4 w-4 text-amber-500" />
                  Platform Revenue Audit Stream
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Real-time log of every incoming service fee distributed into shareholder wallets.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-muted-foreground uppercase text-[10px] font-mono border-b border-border/70 dark:bg-card/70">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Shareholder</th>
                    <th className="p-3">Revenue Source</th>
                    <th className="p-3">Fee Amount</th>
                    <th className="p-3">Reference</th>
                    <th className="p-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {data?.recent_logs && data.recent_logs.length > 0 ? (
                    data.recent_logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70 transition-colors dark:hover:bg-muted/30">
                        <td className="p-3 font-mono text-muted-foreground">
                          {formatDateTime(log.created_at)}
                        </td>
                        <td className="p-3 font-mono">{log.shareholder_phone}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              log.source === "ggr"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                : log.source === "api_deposit"
                                  ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                                  : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
                            }`}
                          >
                            {log.source_label}
                          </span>
                        </td>
                        <td className="p-3 font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          +{formatNPR(Number(log.amount))}
                        </td>
                        <td className="p-3 font-mono text-muted-foreground">{log.reference}</td>
                        <td className="p-3 text-muted-foreground max-w-sm truncate">{log.notes}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted-foreground">
                        No revenue events logged yet. Platform fees will stream here automatically upon API transactions.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* TAB 3: WITHDRAWAL HISTORY */}
          <TabsContent value="withdrawals" className="rounded-2xl border border-border bg-white p-5 space-y-4 shadow-xs dark:bg-card">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <div>
                <h3 className="font-bold text-sm flex items-center gap-2 text-foreground">
                  <Landmark className="h-4 w-4 text-emerald-600" />
                  Shareholder Withdrawal History
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Record of all shareholder profit payouts to bank accounts and wallets.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-muted-foreground uppercase text-[10px] font-mono border-b border-border/70 dark:bg-card/70">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Shareholder</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Method</th>
                    <th className="p-3">Account Details</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {data?.recent_withdrawals && data.recent_withdrawals.length > 0 ? (
                    data.recent_withdrawals.map((w) => (
                      <tr key={w.id} className="hover:bg-slate-50/70 transition-colors dark:hover:bg-muted/30">
                        <td className="p-3 font-mono text-muted-foreground">
                          {formatDateTime(w.created_at)}
                        </td>
                        <td className="p-3 font-mono">{w.shareholder_phone}</td>
                        <td className="p-3 font-mono font-bold text-foreground">
                          {formatNPR(Number(w.amount))}
                        </td>
                        <td className="p-3 uppercase font-medium">{w.payout_method}</td>
                        <td className="p-3 text-xs">
                          <div className="font-medium">{w.account_name}</div>
                          <div className="text-muted-foreground font-mono">
                            {w.account_number} {w.bank_name ? `(${w.bank_name})` : ""}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            {w.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted-foreground">
                        No shareholder withdrawals recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>

        {/* MODAL: WITHDRAW SHAREHOLDER BALANCE */}
        <Dialog open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen}>
          <DialogContent className="sm:max-w-md bg-white dark:bg-card border-border shadow-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold">
                <Landmark className="h-5 w-5" />
                Withdraw Shareholder Revenue
              </DialogTitle>
              <DialogDescription className="text-xs">
                Transfer your accumulated service fee balance directly to your bank account or digital wallet.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="p-3.5 bg-slate-50 rounded-xl flex items-center justify-between border border-border/80 dark:bg-card/80">
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase">Available to Withdraw</div>
                  <div className="text-lg font-extrabold text-emerald-700 font-mono tabular dark:text-emerald-400">
                    {formatNPR(Number(data?.my_wallet?.balance || 0))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleMaxWithdraw}
                  className="text-xs h-7 bg-white hover:bg-slate-50 dark:bg-card"
                >
                  Use Max
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="with-amount" className="text-xs font-semibold">Withdrawal Amount (NPR)</Label>
                <Input
                  id="with-amount"
                  type="number"
                  placeholder="e.g. 5000"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Payout Destination</Label>
                <Select value={payoutMethod} onValueChange={setPayoutMethod}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Commercial Bank Transfer</SelectItem>
                    <SelectItem value="esewa">eSewa Wallet</SelectItem>
                    <SelectItem value="khalti">Khalti Wallet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {payoutMethod === "bank" && (
                <div className="space-y-1.5">
                  <Label htmlFor="bank-name" className="text-xs font-semibold">Bank Name</Label>
                  <Input
                    id="bank-name"
                    placeholder="e.g. Nabil Bank, Global IME, NIC Asia"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    className="text-sm"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="acc-name" className="text-xs font-semibold">Account Holder Name</Label>
                <Input
                  id="acc-name"
                  placeholder="Official name matching bank account"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="acc-num" className="text-xs font-semibold">Account / Mobile Number</Label>
                <Input
                  id="acc-num"
                  placeholder="Bank account number or registered phone"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setWithdrawModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => withdrawMutation.mutate()}
                disabled={
                  withdrawMutation.isPending ||
                  !withdrawAmount ||
                  Number(withdrawAmount) <= 0 ||
                  Number(withdrawAmount) > Number(data?.my_wallet?.balance || 0) ||
                  !accountName ||
                  !accountNumber
                }
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              >
                {withdrawMutation.isPending ? "Processing..." : "Confirm Withdrawal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL: CONFIGURE SERVICE FEES */}
        <Dialog open={configModalOpen} onOpenChange={setConfigModalOpen}>
          <DialogContent className="sm:max-w-md bg-white dark:bg-card border-border shadow-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground font-bold">
                <Sliders className="h-5 w-5 text-amber-600" />
                Configure Platform Service Fee Rates
              </DialogTitle>
              <DialogDescription className="text-xs">
                Adjust the platform fee rates applied to GGR monthly net profit and Payment API operations.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="ggr-pct" className="text-xs font-semibold">GGR Monthly Net Profit Cut (%)</Label>
                <Input
                  id="ggr-pct"
                  type="number"
                  step="0.1"
                  value={ggrPercent}
                  onChange={(e) => setGgrPercent(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Standard 10.0%. Platform dividend taken on positive net monthly profit.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dep-pct" className="text-xs font-semibold">Payment API Deposit Fee (%)</Label>
                <Input
                  id="dep-pct"
                  type="number"
                  step="0.1"
                  value={depPercent}
                  onChange={(e) => setDepPercent(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Default 1.5%. Deducted from player gross deposit, credited into fee pool.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wth-pct" className="text-xs font-semibold">Payment API Withdraw Fee (%)</Label>
                <Input
                  id="wth-pct"
                  type="number"
                  step="0.1"
                  value={wthPercent}
                  onChange={(e) => setWthPercent(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Default 2.0%. Added to player withdrawal payout, credited into fee pool.
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setConfigModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => updateConfigMutation.mutate()}
                disabled={updateConfigMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              >
                {updateConfigMutation.isPending ? "Saving..." : "Save Rate Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminShell>
  );
}
