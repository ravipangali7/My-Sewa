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

  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("bank");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");

  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [ggrPercent, setGgrPercent] = useState("10.00");
  const [depPercent, setDepPercent] = useState("1.50");
  const [wthPercent, setWthPercent] = useState("2.00");

  const { data, isLoading, refetch } = useQuery({
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
        bank_name: bankName,
      }),
    onSuccess: (res) => {
      toast.success(res.message);
      setWithdrawModalOpen(false);
      setWithdrawAmount("");
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
      toast.success("Service fee percentages updated successfully.");
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

  return (
    <AdminShell title="Shareholder & Platform Revenue">
      <div className="space-y-6 pb-12">
        {/* Top Header & Quick Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Coins className="h-6 w-6 text-amber-500" />
              Shareholder Revenue Management
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Service fee earnings from GGR monthly 10% profit cuts and Payment API transaction percentages.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={openConfigDialog}
              className="h-9 text-xs"
            >
              <Sliders className="h-3.5 w-3.5 mr-1.5" />
              Fee Config
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => settleMutation.mutate()}
              disabled={settleMutation.isPending}
              className="h-9 text-xs"
            >
              <Calendar className="h-3.5 w-3.5 mr-1.5" />
              Settle Monthly GGR
            </Button>

            {data?.is_shareholder && (
              <Button
                size="sm"
                onClick={() => setWithdrawModalOpen(true)}
                className="h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Landmark className="h-3.5 w-3.5 mr-1.5" />
                Withdraw My Balance
              </Button>
            )}
          </div>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="h-4 w-4 text-amber-500" />
              Total Platform Revenue
            </span>
            <div className="text-2xl font-bold text-foreground">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.total_platform_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">All historical platform fee cuts distributed</p>
          </div>

          <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              GGR Monthly Cuts
            </span>
            <div className="text-2xl font-bold text-foreground">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.ggr_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Rate: {data?.service_fee_config?.ggr_monthly_profit_percent || 10}% of net profit
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ArrowDownLeft className="h-4 w-4 text-blue-500" />
              Deposit API Revenue
            </span>
            <div className="text-2xl font-bold text-foreground">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.api_deposit_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Rate: {data?.service_fee_config?.payment_api_deposit_percent || 1.5}% per deposit
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ArrowUpRight className="h-4 w-4 text-indigo-500" />
              Withdraw API Revenue
            </span>
            <div className="text-2xl font-bold text-foreground">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.api_withdraw_revenue || 0))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Rate: {data?.service_fee_config?.payment_api_withdraw_percent || 2.0}% per payout
            </p>
          </div>
        </div>

        {/* My Shareholder Wallet Card (If logged in user is a shareholder) */}
        {data?.is_shareholder && (
          <div className="rounded-2xl border bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-100 flex items-center gap-1.5">
                <Wallet className="h-4 w-4" />
                My Shareholder Balance (Withdrawable)
              </div>
              <div className="text-3xl font-extrabold">
                {formatNPR(Number(data?.my_wallet?.balance || 0))}
              </div>
              <div className="flex items-center gap-3 text-xs text-emerald-100/90 pt-1">
                <span>Total Earned: {formatNPR(Number(data?.my_wallet?.total_earned || 0))}</span>
                <span>•</span>
                <span>Total Withdrawn: {formatNPR(Number(data?.my_wallet?.total_withdrawn || 0))}</span>
                <span>•</span>
                <span>Allocated Share: {data?.my_wallet?.share_percent}%</span>
              </div>
            </div>

            <Button
              onClick={() => setWithdrawModalOpen(true)}
              className="bg-white text-emerald-800 hover:bg-emerald-50 font-semibold"
            >
              <Landmark className="h-4 w-4 mr-1.5" />
              Withdraw Funds
            </Button>
          </div>
        )}

        {/* Tabs: Shareholders List, Revenue Logs & Withdrawals */}
        <Tabs defaultValue="shareholders" className="space-y-4">
          <TabsList className="grid grid-cols-3 w-full sm:w-[480px]">
            <TabsTrigger value="shareholders">Shareholders</TabsTrigger>
            <TabsTrigger value="revenue-logs">Revenue Logs</TabsTrigger>
            <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
          </TabsList>

          {/* Shareholders List */}
          <TabsContent value="shareholders" className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-1.5">
                <Users className="h-4 w-4 text-muted-foreground" />
                Active Platform Shareholders
              </h3>
              <Button size="sm" variant="ghost" onClick={() => refetch()}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Refresh
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="py-2.5">Shareholder</th>
                    <th className="py-2.5">Phone</th>
                    <th className="py-2.5">Share %</th>
                    <th className="py-2.5">Current Balance</th>
                    <th className="py-2.5">Total Earned</th>
                    <th className="py-2.5">Total Withdrawn</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(data?.shareholders || []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-muted-foreground">
                        No shareholder accounts configured yet.
                      </td>
                    </tr>
                  ) : (
                    data?.shareholders.map((s) => (
                      <tr key={s.id} className="hover:bg-muted/30">
                        <td className="py-2.5 font-medium">
                          {s.first_name || s.last_name
                            ? `${s.first_name || ""} ${s.last_name || ""}`.trim()
                            : "Shareholder"}
                        </td>
                        <td className="py-2.5 font-mono">{s.phone}</td>
                        <td className="py-2.5 font-semibold text-amber-600">{s.share_percent}%</td>
                        <td className="py-2.5 font-bold text-emerald-600">{formatNPR(Number(s.balance))}</td>
                        <td className="py-2.5 text-muted-foreground">{formatNPR(Number(s.total_earned))}</td>
                        <td className="py-2.5 text-muted-foreground">{formatNPR(Number(s.total_withdrawn))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Revenue Logs */}
          <TabsContent value="revenue-logs" className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-1.5">
              <History className="h-4 w-4 text-muted-foreground" />
              Recent Revenue Distribution Logs
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="py-2">Source</th>
                    <th className="py-2">Shareholder</th>
                    <th className="py-2">Amount</th>
                    <th className="py-2">Reference</th>
                    <th className="py-2">Notes</th>
                    <th className="py-2">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(data?.recent_logs || []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-muted-foreground">
                        No revenue distribution logs yet.
                      </td>
                    </tr>
                  ) : (
                    data?.recent_logs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30">
                        <td className="py-2.5 font-medium">{log.source_label}</td>
                        <td className="py-2.5 font-mono">{log.shareholder_phone}</td>
                        <td className="py-2.5 font-bold text-emerald-600">+{formatNPR(Number(log.amount))}</td>
                        <td className="py-2.5 font-mono text-muted-foreground">{log.reference || "-"}</td>
                        <td className="py-2.5 text-muted-foreground max-w-xs truncate">{log.notes || "-"}</td>
                        <td className="py-2.5 text-muted-foreground">{formatDateTime(log.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Withdrawals List */}
          <TabsContent value="withdrawals" className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-1.5">
              <Landmark className="h-4 w-4 text-muted-foreground" />
              Shareholder Payout & Withdrawal History
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="py-2">Shareholder</th>
                    <th className="py-2">Amount</th>
                    <th className="py-2">Method</th>
                    <th className="py-2">Account Name</th>
                    <th className="py-2">Account Number / Bank</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(data?.recent_withdrawals || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-muted-foreground">
                        No withdrawals recorded yet.
                      </td>
                    </tr>
                  ) : (
                    data?.recent_withdrawals.map((w) => (
                      <tr key={w.id} className="hover:bg-muted/30">
                        <td className="py-2.5 font-mono">{w.shareholder_phone}</td>
                        <td className="py-2.5 font-bold text-rose-600">{formatNPR(Number(w.amount))}</td>
                        <td className="py-2.5 uppercase font-semibold">{w.payout_method}</td>
                        <td className="py-2.5">{w.account_name}</td>
                        <td className="py-2.5">
                          {w.account_number} {w.bank_name ? `(${w.bank_name})` : ""}
                        </td>
                        <td className="py-2.5">
                          <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-semibold">
                            {w.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-muted-foreground">{formatDateTime(w.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Withdraw Modal */}
      <Dialog open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw Shareholder Revenue</DialogTitle>
            <DialogDescription>
              Transfer accumulated service revenue to your bank account or digital wallet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="p-3 bg-muted rounded-lg text-xs flex justify-between">
              <span>Withdrawable Balance:</span>
              <span className="font-bold text-emerald-600">
                {formatNPR(Number(data?.my_wallet?.balance || 0))}
              </span>
            </div>

            <div className="space-y-1">
              <Label>Withdrawal Amount (NPR)</Label>
              <Input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="e.g. 5000"
              />
            </div>

            <div className="space-y-1">
              <Label>Payout Method</Label>
              <Select value={payoutMethod} onValueChange={setPayoutMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="esewa">eSewa</SelectItem>
                  <SelectItem value="khalti">Khalti</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Account Holder Name</Label>
              <Input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Full Name"
              />
            </div>

            <div className="space-y-1">
              <Label>Account Number / Wallet ID</Label>
              <Input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="Account number or phone"
              />
            </div>

            {payoutMethod === "bank" && (
              <div className="space-y-1">
                <Label>Bank Name</Label>
                <Input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. Nabil Bank"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawModalOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => withdrawMutation.mutate()}
              disabled={withdrawMutation.isPending}
            >
              Confirm Withdrawal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fee Config Modal */}
      <Dialog open={configModalOpen} onOpenChange={setConfigModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Service Fee Percentages</DialogTitle>
            <DialogDescription>
              Set the platform revenue percentage cuts for GGR coins and Payment APIs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>GGR Monthly Net Profit Cut (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={ggrPercent}
                onChange={(e) => setGgrPercent(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Default: 10.00% taken every month on net GGR profit.</p>
            </div>

            <div className="space-y-1">
              <Label>Payment API Deposit (Payin) Fee (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={depPercent}
                onChange={(e) => setDepPercent(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Default: 1.50% deducted from end-player deposits.</p>
            </div>

            <div className="space-y-1">
              <Label>Payment API Withdraw (Payout) Fee (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={wthPercent}
                onChange={(e) => setWthPercent(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Default: 2.00% added on end-player withdrawals.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateConfigMutation.mutate()}
              disabled={updateConfigMutation.isPending}
            >
              Save Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
