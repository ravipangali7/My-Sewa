import { createFileRoute } from "@tanstack/react-router";
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
      apiClient.updateServiceFeeConfig({
        ggr_monthly_profit_percent: ggrPercent,
        payment_api_deposit_percent: depPercent,
        payment_api_withdraw_percent: wthPercent,
      }),
    onSuccess: () => {
      toast.success("Platform service fee percentages updated successfully.");
      setConfigModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update fee configuration.");
    },
  });

  const settleMutation = useMutation({
    mutationFn: () => apiClient.settleMonthlyGgr(),
    onSuccess: (res) => {
      toast.success(`Settlement completed for ${res.count} API user accounts.`);
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Settlement failed.");
    },
  });

  const openConfigDialog = () => {
    if (data?.service_fee_config) {
      setGgrPercent(data.service_fee_config.ggr_monthly_profit_percent);
      setDepPercent(data.service_fee_config.payment_api_deposit_percent);
      setWthPercent(data.service_fee_config.payment_api_withdraw_percent);
    }
    setConfigModalOpen(true);
  };

  const handleMaxWithdraw = () => {
    if (data?.my_wallet?.balance) {
      setWithdrawAmount(data.my_wallet.balance);
    }
  };

  return (
    <AdminShell title="Shareholder Governance & Revenue">
      <div className="space-y-6 pb-12">
        {/* Executive Banner Header */}
        <div className="rounded-2xl border border-zinc-800 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 text-white p-6 shadow-xl relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 w-96 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-amber-500/10 via-emerald-500/5 to-transparent pointer-events-none" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[11px] font-semibold tracking-wider uppercase text-emerald-400 font-mono">
                  Platform Equity Governance
                </span>
                {data?.is_shareholder && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 font-semibold">
                    {data.my_wallet?.share_percent || "0"}% Equity Partner
                  </span>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white flex items-center gap-2.5">
                <Building className="h-6 w-6 text-amber-400" />
                Shareholder Revenue & Fee Settlement Portal
              </h1>
              <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
                Automatic dividend distribution from GGR monthly 10% profit cuts and Payment API transaction fees.
                Platform fees are credited directly into shareholder equity wallets.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className="h-8 text-xs bg-zinc-800/80 border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:text-white"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={openConfigDialog}
                className="h-8 text-xs bg-zinc-800/80 border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:text-white"
              >
                <Sliders className="h-3.5 w-3.5 mr-1.5 text-amber-400" />
                Configure Rates
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => settleMutation.mutate()}
                disabled={settleMutation.isPending}
                className="h-8 text-xs bg-zinc-800/80 border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:text-white"
              >
                <Calendar className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
                {settleMutation.isPending ? "Settling..." : "Run Monthly GGR Settlement"}
              </Button>

              {data?.is_shareholder && (
                <Button
                  size="sm"
                  onClick={() => setWithdrawModalOpen(true)}
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md"
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
          <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="h-4 w-4 text-amber-500" />
              Total Platform Fee Pool
            </span>
            <div className="text-2xl font-extrabold text-foreground">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.total_platform_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">Cumulative service revenue across all services</p>
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              GGR Monthly Cuts
            </span>
            <div className="text-2xl font-extrabold text-emerald-600">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.ggr_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Current Rate: {data?.service_fee_config?.ggr_monthly_profit_percent || 10}% of net profit
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ArrowDownLeft className="h-4 w-4 text-blue-500" />
              Deposit API Revenue
            </span>
            <div className="text-2xl font-extrabold text-blue-600">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.api_deposit_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Current Rate: {data?.service_fee_config?.payment_api_deposit_percent || 1.5}% per deposit
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ArrowUpRight className="h-4 w-4 text-indigo-500" />
              Withdraw API Revenue
            </span>
            <div className="text-2xl font-extrabold text-indigo-600">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.api_withdraw_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Current Rate: {data?.service_fee_config?.payment_api_withdraw_percent || 2.0}% per payout
            </p>
          </div>
        </div>

        {/* Shareholder Wallet Card (If logged in user is shareholder) */}
        {data?.is_shareholder && (
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950 via-teal-900 to-emerald-950 text-white p-6 shadow-xl relative overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="space-y-1.5">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                  <Wallet className="h-4 w-4" />
                  My Withdrawable Equity Balance
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  {formatNPR(Number(data?.my_wallet?.balance || 0))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-emerald-200/80 pt-1">
                  <span>Total Earned: <strong>{formatNPR(Number(data?.my_wallet?.total_earned || 0))}</strong></span>
                  <span>•</span>
                  <span>Total Withdrawn: <strong>{formatNPR(Number(data?.my_wallet?.total_withdrawn || 0))}</strong></span>
                  <span>•</span>
                  <span>Allocated Share: <strong>{data?.my_wallet?.share_percent}%</strong></span>
                </div>
              </div>

              <Button
                onClick={() => setWithdrawModalOpen(true)}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-6 h-10 shadow-lg text-xs"
              >
                <Landmark className="h-4 w-4 mr-1.5" />
                Request Profit Withdrawal
              </Button>
            </div>
          </div>
        )}

        {/* Tabbed Views: Cap Table, Revenue Audit Stream, Withdrawals */}
        <Tabs defaultValue="shareholders" className="space-y-4">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="shareholders">
              <Users className="h-3.5 w-3.5 mr-1.5" />
              Cap Table & Equity ({data?.shareholders?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="audit-stream">
              <History className="h-3.5 w-3.5 mr-1.5" />
              Live Revenue Inflow Stream
            </TabsTrigger>
            <TabsTrigger value="withdrawals">
              <Landmark className="h-3.5 w-3.5 mr-1.5" />
              Withdrawal History
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: SHAREHOLDERS CAP TABLE */}
          <TabsContent value="shareholders" className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-emerald-600" />
                  Shareholder Equity Partners
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Partners registered with role "Shareholder". Platform fee cuts are distributed automatically by equity %.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Partner</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">Equity Share %</th>
                    <th className="p-3">Withdrawable Balance</th>
                    <th className="p-3">Total Earned</th>
                    <th className="p-3">Total Withdrawn</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.shareholders && data.shareholders.length > 0 ? (
                    data.shareholders.map((s) => (
                      <tr key={s.id} className="hover:bg-muted/30">
                        <td className="p-3 font-semibold text-foreground">
                          {s.first_name || s.last_name ? `${s.first_name} ${s.last_name}` : "Shareholder Partner"}
                          {s.id === user?.id && (
                            <span className="ml-2 px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] rounded font-bold">
                              YOU
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-mono">{s.phone}</td>
                        <td className="p-3 font-mono font-bold text-amber-600">
                          {s.share_percent}%
                        </td>
                        <td className="p-3 font-mono font-bold text-emerald-600">
                          {formatNPR(Number(s.balance))}
                        </td>
                        <td className="p-3 font-mono">{formatNPR(Number(s.total_earned))}</td>
                        <td className="p-3 font-mono text-muted-foreground">{formatNPR(Number(s.total_withdrawn))}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            ACTIVE
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-muted-foreground">
                        No shareholder partners created yet. You can assign the "Shareholder" role to any user in the Users Admin.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* TAB 2: LIVE REVENUE AUDIT STREAM */}
          <TabsContent value="audit-stream" className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2">
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
                <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Shareholder</th>
                    <th className="p-3">Revenue Source</th>
                    <th className="p-3">Fee Amount</th>
                    <th className="p-3">Reference</th>
                    <th className="p-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.recent_logs && data.recent_logs.length > 0 ? (
                    data.recent_logs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30">
                        <td className="p-3 font-mono text-muted-foreground">
                          {formatDateTime(log.created_at)}
                        </td>
                        <td className="p-3 font-mono">{log.shareholder_phone}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              log.source === "ggr"
                                ? "bg-amber-100 text-amber-800"
                                : log.source === "api_deposit"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-indigo-100 text-indigo-800"
                            }`}
                          >
                            {log.source_label}
                          </span>
                        </td>
                        <td className="p-3 font-mono font-bold text-emerald-600">
                          +{formatNPR(Number(log.amount))}
                        </td>
                        <td className="p-3 font-mono text-muted-foreground">{log.reference}</td>
                        <td className="p-3 text-muted-foreground max-w-sm truncate">{log.notes}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-muted-foreground">
                        No revenue events logged yet. Platform fees will stream here automatically upon API transactions.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* TAB 3: WITHDRAWAL HISTORY */}
          <TabsContent value="withdrawals" className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2">
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
                <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Shareholder</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Method</th>
                    <th className="p-3">Account Details</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.recent_withdrawals && data.recent_withdrawals.length > 0 ? (
                    data.recent_withdrawals.map((w) => (
                      <tr key={w.id} className="hover:bg-muted/30">
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
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            {w.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-muted-foreground">
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
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-600">
                <Landmark className="h-5 w-5" />
                Withdraw Shareholder Revenue
              </DialogTitle>
              <DialogDescription>
                Transfer your accumulated service fee balance directly to your bank account or wallet.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="p-3 bg-muted/40 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Available to Withdraw</div>
                  <div className="text-lg font-bold text-emerald-600">
                    {formatNPR(Number(data?.my_wallet?.balance || 0))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleMaxWithdraw}
                  className="text-xs h-7"
                >
                  Use Max
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="with-amount">Withdrawal Amount (NPR)</Label>
                <Input
                  id="with-amount"
                  type="number"
                  placeholder="5000"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Payout Method</Label>
                <Select value={payoutMethod} onValueChange={setPayoutMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                    <SelectItem value="esewa">eSewa</SelectItem>
                    <SelectItem value="khalti">Khalti</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {payoutMethod === "bank" && (
                <div className="space-y-1.5">
                  <Label htmlFor="bank-name">Bank Name</Label>
                  <Input
                    id="bank-name"
                    placeholder="e.g. Nabil Bank, Global IME"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="acc-name">Account Holder Name</Label>
                <Input
                  id="acc-name"
                  placeholder="e.g. Ravi Sharma"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="acc-num">Account / Wallet Number</Label>
                <Input
                  id="acc-num"
                  placeholder="Account number or mobile number"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
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
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {withdrawMutation.isPending ? "Processing..." : "Confirm Withdrawal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL: CONFIGURE SERVICE FEES */}
        <Dialog open={configModalOpen} onOpenChange={setConfigModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-amber-500" />
                Configure Platform Service Fee Rates
              </DialogTitle>
              <DialogDescription>
                Adjust the platform fee rates applied to GGR monthly net profit and Payment API operations.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="ggr-pct">GGR Monthly Net Profit Fee (%)</Label>
                <Input
                  id="ggr-pct"
                  type="number"
                  step="0.1"
                  value={ggrPercent}
                  onChange={(e) => setGgrPercent(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Default 10.0%. Platform cut taken on positive net monthly profit.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dep-pct">Payment API Deposit Fee (%)</Label>
                <Input
                  id="dep-pct"
                  type="number"
                  step="0.1"
                  value={depPercent}
                  onChange={(e) => setDepPercent(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Default 1.5%. Deducted from player gross deposit, distributed to shareholders.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wth-pct">Payment API Withdraw Fee (%)</Label>
                <Input
                  id="wth-pct"
                  type="number"
                  step="0.1"
                  value={wthPercent}
                  onChange={(e) => setWthPercent(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Default 2.0%. Added to player withdrawal payout, distributed to shareholders.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setConfigModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => updateConfigMutation.mutate()}
                disabled={updateConfigMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
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
