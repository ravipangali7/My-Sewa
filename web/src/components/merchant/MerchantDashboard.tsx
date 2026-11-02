import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Coins,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  History,
  Plus,
  Copy,
  CreditCard,
  RefreshCw,
  Server,
  Lock,
  BookOpen,
  Key,
  Eye,
  EyeOff,
  Check,
  Search,
  CheckCircle2,
  AlertCircle,
  FileText,
  Activity,
  Layers,
  ArrowRight,
} from "lucide-react";
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
import { apiClient } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export type MerchantTab =
  | "overview"
  | "payment-api"
  | "ggr"
  | "api-keys"
  | "docs"
  | "ledger";

interface MerchantDashboardProps {
  initialTab?: MerchantTab;
}

export function MerchantDashboard({ initialTab = "overview" }: MerchantDashboardProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchTab = useRouterState({
    select: (s) => (s.location.search as Record<string, unknown>)?.tab as MerchantTab | undefined,
  });

  const activeTab: MerchantTab = useMemo(() => {
    if (pathname === "/app/ggr") return "ggr";
    if (searchTab) return searchTab;
    return initialTab;
  }, [pathname, searchTab, initialTab]);

  const handleTabChange = (tab: MerchantTab) => {
    if (tab === "ggr") {
      navigate({ to: "/app/ggr" });
    } else {
      navigate({ to: "/app", search: { tab } });
    }
  };

  // Modals
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [buyAmount, setBuyAmount] = useState("10000");

  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [apiDepositAmount, setApiDepositAmount] = useState("1000");
  const [apiDepositPlayer, setApiDepositPlayer] = useState("player_01");

  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [apiWithdrawAmount, setApiWithdrawAmount] = useState("500");
  const [apiWithdrawPlayer, setApiWithdrawPlayer] = useState("player_01");

  // Ledger filter & search
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState("all");

  // API Key visibility & copy
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Docs language tab (curl, python, node)
  const [docsLang, setDocsLang] = useState<"curl" | "python" | "node">("curl");

  // Queries
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ggr-dashboard"],
    queryFn: () => apiClient.getGgrDashboard(),
  });

  const devProfileQuery = useQuery({
    queryKey: ["developer", "profile"],
    queryFn: () => apiClient.developerProfile(),
  });

  const isGgrEnabled = Boolean(
    user?.is_ggr_user || user?.is_ggr || data?.is_ggr_enabled,
  );

  // Mutations
  const buyCoinsMutation = useMutation({
    mutationFn: (amount: string) => apiClient.buyGgrCoins(amount),
    onSuccess: (res) => {
      toast.success(res.message);
      setBuyModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to purchase GGR coins.");
    },
  });

  const apiDepositMutation = useMutation({
    mutationFn: (payload: { amount: string; player_id: string }) =>
      apiClient.paymentApiDeposit(payload),
    onSuccess: (res) => {
      toast.success(
        `Deposit confirmed. NPR ${res.net_credited} credited to cash balance (Fee: NPR ${res.fee_amount}).`,
      );
      setDepositModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Deposit transaction failed.");
    },
  });

  const apiWithdrawMutation = useMutation({
    mutationFn: (payload: { amount: string; player_id: string }) =>
      apiClient.paymentApiWithdraw(payload),
    onSuccess: (res) => {
      toast.success(
        `Payout confirmed. Total NPR ${res.total_debited} debited from balance (Fee: NPR ${res.fee_amount}).`,
      );
      setWithdrawModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Payout transaction failed.");
    },
  });

  const copyApiKey = () => {
    const key = devProfileQuery.data?.api_key || "ms_live_" + (user?.phone || "key");
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    toast.success("API Key copied to clipboard");
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const depFeePct = Number(data?.service_fees?.payment_api_deposit_percent || 1.5);
  const wthFeePct = Number(data?.service_fees?.payment_api_withdraw_percent || 2.0);
  const ggrProfitPct = Number(data?.service_fees?.ggr_monthly_profit_percent || 10.0);

  const depAmtNum = Number(apiDepositAmount || 0);
  const calcDepFee = ((depAmtNum * depFeePct) / 100).toFixed(2);
  const calcDepNet = (depAmtNum - Number(calcDepFee)).toFixed(2);

  const wthAmtNum = Number(apiWithdrawAmount || 0);
  const calcWthFee = ((wthAmtNum * wthFeePct) / 100).toFixed(2);
  const calcWthTotal = (wthAmtNum + Number(calcWthFee)).toFixed(2);

  const filteredTransactions = useMemo(() => {
    if (!data?.recent_transactions) return [];
    return data.recent_transactions.filter((t) => {
      const matchType = ledgerTypeFilter === "all" || t.txn_type === ledgerTypeFilter;
      const matchSearch =
        ledgerSearch === "" ||
        t.reference.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
        t.type_label.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
        t.notes.toLowerCase().includes(ledgerSearch.toLowerCase());
      return matchType && matchSearch;
    });
  }, [data?.recent_transactions, ledgerTypeFilter, ledgerSearch]);

  const rawKey = devProfileQuery.data?.api_key || `ms_live_key_${user?.phone || "default"}`;
  const displayKey = showApiKey ? rawKey : rawKey.slice(0, 8) + "••••••••••••••••••••••••••••••••";

  return (
    <div className="space-y-6 pb-12 w-full max-w-full">
      {/* Classic Clean Professional Header */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-semibold tracking-wider uppercase text-emerald-600 font-mono">
              Production Gateway
            </span>
            <span className="text-zinc-300 dark:text-zinc-700">•</span>
            <span className="text-xs text-muted-foreground font-mono">MID-{user?.phone}</span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            {user?.business_name || user?.first_name || "Merchant"} Operations Portal
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage your payment gateway, settlements, API credentials, and coin liquidity.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button size="sm" asChild className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
            <Link to="/app/load">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Load Balance
            </Link>
          </Button>

          {isGgrEnabled && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBuyModalOpen(true)}
              className="h-8 text-xs text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40"
            >
              <Coins className="h-3.5 w-3.5 mr-1" />
              Buy GGR Coins
            </Button>
          )}
        </div>
      </div>

      {/* Mobile Navigation Tabs */}
      <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {(
          [
            { id: "overview", label: "Overview" },
            { id: "payment-api", label: "Payment API" },
            { id: "ggr", label: "GGR Gaming" },
            { id: "api-keys", label: "API Keys" },
            { id: "docs", label: "API Docs" },
            { id: "ledger", label: "Ledger" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleTabChange(t.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
              activeTab === t.id
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Top Financial Stat Cards (Classic Professional Style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Available Cash Balance */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Wallet className="size-4 text-emerald-600" />
              Available Balance
            </span>
            <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded font-bold">
              NPR
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {isLoading ? "..." : formatNPR(Number(data?.cash_balance || 0))}
          </div>
          <p className="text-[11px] text-muted-foreground">Available for API payouts and coin purchases</p>
        </div>

        {/* GGR Coin Reserve */}
        {isGgrEnabled ? (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-950/20 p-5 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <Coins className="size-4 text-amber-600" />
                GGR Coin Reserve
              </span>
              <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5 rounded">
                1:1
              </span>
            </div>
            <div className="text-2xl font-bold tracking-tight text-amber-700 dark:text-amber-300">
              {isLoading ? "..." : Number(data?.ggr_coin_balance || 0).toLocaleString()} Coins
            </div>
            <p className="text-[11px] text-muted-foreground">1 NPR = 1 Coin • 10% Win Multiplier active</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-2 opacity-80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="size-3.5" />
                GGR Coin Service
              </span>
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-bold">
                INACTIVE
              </span>
            </div>
            <div className="text-xl font-bold text-muted-foreground">Disabled</div>
            <p className="text-[11px] text-muted-foreground">Requires is_ggr permission from Admin</p>
          </div>
        )}

        {/* Payment API Fee Structure */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard className="size-4 text-blue-600" />
              API Service Rates
            </span>
            <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded">
              FIXED
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {depFeePct}% / {wthFeePct}%
          </div>
          <p className="text-[11px] text-muted-foreground">Deposit Fee: {depFeePct}% • Payout Fee: {wthFeePct}%</p>
        </div>

        {/* Monthly GGR Settlement Status */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="size-4 text-purple-600" />
              Monthly Profit Share
            </span>
            <span className="text-[10px] font-mono font-bold text-purple-700 bg-purple-50 dark:bg-purple-950/60 px-1.5 py-0.5 rounded">
              {ggrProfitPct}%
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {isGgrEnabled ? formatNPR(Number(data?.estimated_monthly_fee || 0)) : "—"}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {isGgrEnabled ? "Estimated fee based on positive net profits" : "GGR service inactive"}
          </p>
        </div>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Payment Operations Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <ArrowDownLeft className="size-4 text-blue-600" />
                  Player Deposit (Payin)
                </span>
                <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-full">
                  Rate: {depFeePct}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Accept player deposits directly into your cash balance. Platform fee is automatically deducted.
              </p>
              <Button
                variant="outline"
                onClick={() => setDepositModalOpen(true)}
                className="w-full text-xs h-8.5 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 font-medium"
              >
                Record Player Deposit
              </Button>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <ArrowUpRight className="size-4 text-indigo-600" />
                  Player Payout (Withdraw)
                </span>
                <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-full">
                  Rate: {wthFeePct}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Issue payouts to players from your wallet balance. Platform fee is added to total debit.
              </p>
              <Button
                variant="outline"
                onClick={() => setWithdrawModalOpen(true)}
                className="w-full text-xs h-8.5 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-900/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 font-medium"
              >
                Record Player Payout
              </Button>
            </div>
          </div>

          {/* Recent Operations Activity */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <History className="size-4 text-muted-foreground" />
                Recent Gateway Transactions
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleTabChange("ledger")}
                className="text-xs text-emerald-600 hover:text-emerald-700 h-7"
              >
                View all ledger <ArrowRight className="size-3.5 ml-1" />
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5">Date & Time</th>
                    <th className="p-2.5">Type</th>
                    <th className="p-2.5">Amount</th>
                    <th className="p-2.5">Balance After</th>
                    <th className="p-2.5">Reference</th>
                    <th className="p-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.recent_transactions && data.recent_transactions.length > 0 ? (
                    data.recent_transactions.slice(0, 8).map((t) => (
                      <tr key={t.id} className="hover:bg-muted/30">
                        <td className="p-2.5 font-mono text-muted-foreground">
                          {formatDateTime(t.created_at)}
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              t.txn_type === "buy"
                                ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-400"
                                : t.txn_type === "player_win"
                                  ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400"
                                  : t.txn_type === "player_loss"
                                    ? "bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-400"
                                    : "bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-400"
                            }`}
                          >
                            {t.type_label}
                          </span>
                        </td>
                        <td
                          className={`p-2.5 font-mono font-bold ${
                            Number(t.amount) >= 0 ? "text-emerald-600" : "text-red-500"
                          }`}
                        >
                          {Number(t.amount) >= 0 ? `+${t.amount}` : t.amount}
                        </td>
                        <td className="p-2.5 font-mono">{t.balance_after}</td>
                        <td className="p-2.5 font-mono text-muted-foreground">{t.reference}</td>
                        <td className="p-2.5 text-muted-foreground max-w-xs truncate">{t.notes}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-muted-foreground">
                        No transactions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PAYMENT API */}
      {activeTab === "payment-api" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-5">
            <div className="border-b pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <CreditCard className="size-5 text-emerald-600" />
                Payment Gateway Operations
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Process player payins and payouts with automatic fee deduction and ledger synchronization.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Payin Form */}
              <div className="rounded-xl border border-border p-5 space-y-4 bg-muted/20">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm flex items-center gap-1.5 text-foreground">
                    <ArrowDownLeft className="size-4 text-blue-600" />
                    Record Player Deposit (Payin)
                  </span>
                  <span className="text-[10px] font-mono font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-400 px-2 py-0.5 rounded">
                    Fee: {depFeePct}%
                  </span>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Player Account ID</Label>
                  <Input
                    value={apiDepositPlayer}
                    onChange={(e) => setApiDepositPlayer(e.target.value)}
                    placeholder="player_01"
                    className="h-8.5 text-xs font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Gross Deposit Amount (NPR)</Label>
                  <Input
                    type="number"
                    value={apiDepositAmount}
                    onChange={(e) => setApiDepositAmount(e.target.value)}
                    placeholder="1000"
                    className="h-8.5 text-xs font-mono"
                  />
                </div>

                <div className="p-3 bg-muted/50 border border-border rounded-xl text-xs space-y-1.5">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Gross Deposit:</span>
                    <span className="font-mono font-medium text-foreground">NPR {depAmtNum}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Platform Fee ({depFeePct}%):</span>
                    <span className="font-mono text-red-600">- NPR {calcDepFee}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-border pt-1 text-emerald-700 dark:text-emerald-400">
                    <span>Net Credited to Balance:</span>
                    <span className="font-mono">+ NPR {calcDepNet}</span>
                  </div>
                </div>

                <Button
                  onClick={() =>
                    apiDepositMutation.mutate({
                      amount: apiDepositAmount,
                      player_id: apiDepositPlayer,
                    })
                  }
                  disabled={apiDepositMutation.isPending || !apiDepositAmount || Number(apiDepositAmount) <= 0}
                  className="w-full text-xs h-8.5 bg-blue-600 hover:bg-blue-700 text-white font-medium"
                >
                  {apiDepositMutation.isPending ? "Processing..." : "Process Deposit"}
                </Button>
              </div>

              {/* Payout Form */}
              <div className="rounded-xl border border-border p-5 space-y-4 bg-muted/20">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm flex items-center gap-1.5 text-foreground">
                    <ArrowUpRight className="size-4 text-indigo-600" />
                    Record Player Payout (Withdraw)
                  </span>
                  <span className="text-[10px] font-mono font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-400 px-2 py-0.5 rounded">
                    Fee: {wthFeePct}%
                  </span>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Player Account ID</Label>
                  <Input
                    value={apiWithdrawPlayer}
                    onChange={(e) => setApiWithdrawPlayer(e.target.value)}
                    placeholder="player_01"
                    className="h-8.5 text-xs font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Payout Amount (NPR)</Label>
                  <Input
                    type="number"
                    value={apiWithdrawAmount}
                    onChange={(e) => setApiWithdrawAmount(e.target.value)}
                    placeholder="500"
                    className="h-8.5 text-xs font-mono"
                  />
                </div>

                <div className="p-3 bg-muted/50 border border-border rounded-xl text-xs space-y-1.5">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Player Receives:</span>
                    <span className="font-mono font-medium text-foreground">NPR {wthAmtNum}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Platform Fee ({wthFeePct}%):</span>
                    <span className="font-mono text-red-600">+ NPR {calcWthFee}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-border pt-1 text-red-600 dark:text-red-400">
                    <span>Total Debited from Balance:</span>
                    <span className="font-mono">- NPR {calcWthTotal}</span>
                  </div>
                </div>

                <Button
                  onClick={() =>
                    apiWithdrawMutation.mutate({
                      amount: apiWithdrawAmount,
                      player_id: apiWithdrawPlayer,
                    })
                  }
                  disabled={apiWithdrawMutation.isPending || !apiWithdrawAmount || Number(apiWithdrawAmount) <= 0}
                  className="w-full text-xs h-8.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
                >
                  {apiWithdrawMutation.isPending ? "Processing..." : "Process Payout"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: GGR GAMING */}
      {activeTab === "ggr" && (
        <div className="space-y-6">
          {isGgrEnabled ? (
            <>
              <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                      <Coins className="size-5 text-amber-600" />
                      GGR Coin Liquidity & Settlements
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Exchange rate: 1 NPR = 1 GGR Coin. Settled monthly on positive net gaming profits.
                    </p>
                  </div>
                  <Button
                    onClick={() => setBuyModalOpen(true)}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-8"
                  >
                    <Plus className="size-3.5 mr-1" />
                    Buy Coins
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                  <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-1.5">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Coins Purchased
                    </div>
                    <div className="text-xl font-bold font-mono text-foreground">
                      {Number(data?.total_bought || 0).toLocaleString()}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Total coins minted with cash balance</p>
                  </div>

                  <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-1.5">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Coins Won by Players
                    </div>
                    <div className="text-xl font-bold font-mono text-emerald-600">
                      {Number(data?.total_won || 0).toLocaleString()}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Includes +10% bonus boost payout</p>
                  </div>

                  <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-1.5">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Coins Lost by Players
                    </div>
                    <div className="text-xl font-bold font-mono text-red-500">
                      {Number(data?.total_lost || 0).toLocaleString()}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Deducted coin rounds retained by platform</p>
                  </div>
                </div>
              </div>

              {/* Monthly Settlements Table */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                    <Calendar className="size-4 text-amber-500" />
                    Monthly Profit Settlements
                  </h3>
                  <span className="text-xs text-muted-foreground font-mono">Rate: 10% on Net Profit</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px]">
                      <tr>
                        <th className="p-2.5">Billing Month</th>
                        <th className="p-2.5">Net Profit</th>
                        <th className="p-2.5">Fee Rate</th>
                        <th className="p-2.5">Fee Paid</th>
                        <th className="p-2.5">Settlement Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data?.monthly_settlements && data.monthly_settlements.length > 0 ? (
                        data.monthly_settlements.map((s) => (
                          <tr key={s.id} className="hover:bg-muted/30">
                            <td className="p-2.5 font-bold font-mono">{s.month_key}</td>
                            <td className="p-2.5 font-mono font-bold text-emerald-600">
                              {formatNPR(Number(s.net_profit))}
                            </td>
                            <td className="p-2.5 font-mono">{s.fee_percent}%</td>
                            <td className="p-2.5 font-mono font-bold text-amber-700">
                              {formatNPR(Number(s.fee_amount))}
                            </td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400">
                                {s.status.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="p-4 text-center text-muted-foreground">
                            No monthly settlements recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-8 shadow-xs text-center space-y-4">
              <div className="size-14 mx-auto rounded-2xl bg-muted flex items-center justify-center text-muted-foreground">
                <Lock className="size-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-bold text-foreground">GGR Gaming Service Inactive</h3>
                <p className="text-xs text-muted-foreground">
                  GGR Coin management is restricted. Request an administrator to activate GGR permissions for your account.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: API KEYS */}
      {activeTab === "api-keys" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-5">
            <div className="border-b pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Key className="size-5 text-emerald-600" />
                API Credentials & Webhook Settings
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Authenticate server-to-server requests using your secret API key.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Production API Key</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={displayKey}
                  className="font-mono text-xs bg-muted"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="h-9 text-xs"
                >
                  {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
                <Button size="sm" onClick={copyApiKey} className="h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
                  {copiedKey ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
                  {copiedKey ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Header format: <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">Authorization: Api-Key &lt;KEY&gt;</code>
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <Label className="text-xs font-semibold">Webhook URL</Label>
              <Input
                readOnly
                value={devProfileQuery.data?.api_webhook_url || "https://your-domain.com/webhook"}
                className="font-mono text-xs bg-muted"
              />
              <p className="text-[11px] text-muted-foreground">
                Event notifications for payins, payouts, and monthly settlements are delivered here.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: API DOCS */}
      {activeTab === "docs" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
              <div>
                <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                  <BookOpen className="size-5 text-purple-600" />
                  API Documentation & Endpoints
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Base URL: <code className="font-mono text-foreground font-semibold">https://mysewa.com.np/api/v1</code>
                </p>
              </div>

              <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
                {(["curl", "python", "node"] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setDocsLang(lang)}
                    className={`text-xs px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                      docsLang === lang
                        ? "bg-background text-foreground shadow-xs font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>

            {/* Deposit Endpoint */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-400 font-mono">
                  POST
                </span>
                <span className="font-mono text-xs font-bold text-foreground">
                  /api/v1/payment/deposit/
                </span>
                <span className="text-xs text-muted-foreground">— Player Deposit (Payin)</span>
              </div>

              <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 text-xs font-mono overflow-x-auto">
{docsLang === "curl" && `curl -X POST "https://mysewa.com.np/api/v1/payment/deposit/" \\
  -H "Authorization: Api-Key ${rawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 1000.00,
    "player_id": "player_88",
    "reference": "DEP_TXN_001"
  }'`}
{docsLang === "python" && `import requests

res = requests.post(
    "https://mysewa.com.np/api/v1/payment/deposit/",
    headers={"Authorization": "Api-Key ${rawKey}"},
    json={"amount": 1000.00, "player_id": "player_88", "reference": "DEP_001"}
)
print(res.json())`}
{docsLang === "node" && `const res = await fetch("https://mysewa.com.np/api/v1/payment/deposit/", {
  method: "POST",
  headers: {
    "Authorization": "Api-Key ${rawKey}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ amount: 1000.00, player_id: "player_88", reference: "DEP_001" })
});
console.log(await res.json());`}
              </pre>
            </div>

            {/* Withdraw Endpoint */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-400 font-mono">
                  POST
                </span>
                <span className="font-mono text-xs font-bold text-foreground">
                  /api/v1/payment/withdraw/
                </span>
                <span className="text-xs text-muted-foreground">— Player Payout (Withdraw)</span>
              </div>

              <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 text-xs font-mono overflow-x-auto">
{`curl -X POST "https://mysewa.com.np/api/v1/payment/withdraw/" \\
  -H "Authorization: Api-Key ${rawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 500.00,
    "player_id": "player_88",
    "reference": "WTH_TXN_001"
  }'`}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: LEDGER */}
      {activeTab === "ledger" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
              <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                <History className="size-4 text-muted-foreground" />
                Complete Transaction Ledger
              </h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="size-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Search ref or notes..."
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    className="h-8 pl-8 text-xs w-44"
                  />
                </div>
                <select
                  value={ledgerTypeFilter}
                  onChange={(e) => setLedgerTypeFilter(e.target.value)}
                  className="h-8 text-xs border rounded-md px-2 bg-background text-foreground"
                >
                  <option value="all">All Types</option>
                  <option value="buy">Coin Purchases</option>
                  <option value="player_win">Player Wins</option>
                  <option value="player_loss">Player Losses</option>
                  <option value="monthly_settlement">Settlements</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5">Date & Time</th>
                    <th className="p-2.5">Type</th>
                    <th className="p-2.5">Amount</th>
                    <th className="p-2.5">Balance After</th>
                    <th className="p-2.5">Reference</th>
                    <th className="p-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredTransactions.length > 0 ? (
                    filteredTransactions.map((t) => (
                      <tr key={t.id} className="hover:bg-muted/30">
                        <td className="p-2.5 font-mono text-muted-foreground">
                          {formatDateTime(t.created_at)}
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              t.txn_type === "buy"
                                ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-400"
                                : t.txn_type === "player_win"
                                  ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400"
                                  : t.txn_type === "player_loss"
                                    ? "bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-400"
                                    : "bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-400"
                            }`}
                          >
                            {t.type_label}
                          </span>
                        </td>
                        <td
                          className={`p-2.5 font-mono font-bold ${
                            Number(t.amount) >= 0 ? "text-emerald-600" : "text-red-500"
                          }`}
                        >
                          {Number(t.amount) >= 0 ? `+${t.amount}` : t.amount}
                        </td>
                        <td className="p-2.5 font-mono">{t.balance_after}</td>
                        <td className="p-2.5 font-mono text-muted-foreground">{t.reference}</td>
                        <td className="p-2.5 text-muted-foreground max-w-xs truncate">{t.notes}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-muted-foreground">
                        No transactions found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: BUY GGR COINS */}
      <Dialog open={buyModalOpen} onOpenChange={setBuyModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="size-5 text-amber-500" />
              Purchase GGR Coins
            </DialogTitle>
            <DialogDescription>
              Convert wallet cash into GGR coins at 1:1 rate (1 NPR = 1 GGR Coin).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="p-3 bg-muted/40 rounded-xl space-y-1">
              <div className="text-xs text-muted-foreground">Available Cash Balance</div>
              <div className="text-lg font-bold text-foreground">
                {formatNPR(Number(data?.cash_balance || 0))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="buy-amount">Amount (NPR)</Label>
              <Input
                id="buy-amount"
                type="number"
                placeholder="10000"
                value={buyAmount}
                onChange={(e) => setBuyAmount(e.target.value)}
              />
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs space-y-1">
              <div className="font-semibold text-foreground">Exchange Summary:</div>
              <div>• Cash debited: {formatNPR(Number(buyAmount || 0))}</div>
              <div className="font-bold text-amber-700 dark:text-amber-400">
                • GGR Coins credited: {Number(buyAmount || 0).toLocaleString()} Coins
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBuyModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => buyCoinsMutation.mutate(buyAmount)}
              disabled={buyCoinsMutation.isPending || !buyAmount || Number(buyAmount) <= 0}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {buyCoinsMutation.isPending ? "Purchasing..." : "Confirm Purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: RECORD PLAYER DEPOSIT */}
      <Dialog open={depositModalOpen} onOpenChange={setDepositModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <ArrowDownLeft className="size-5 text-blue-600" />
              Record Player Deposit (Payin)
            </DialogTitle>
            <DialogDescription>
              Process player deposit with {depFeePct}% fee deduction credited to cash balance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="dep-player">Player ID</Label>
              <Input
                id="dep-player"
                value={apiDepositPlayer}
                onChange={(e) => setApiDepositPlayer(e.target.value)}
                placeholder="player_01"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dep-amount">Gross Deposit Amount (NPR)</Label>
              <Input
                id="dep-amount"
                type="number"
                value={apiDepositAmount}
                onChange={(e) => setApiDepositAmount(e.target.value)}
                placeholder="1000"
              />
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs space-y-1.5">
              <div className="flex justify-between text-muted-foreground">
                <span>Gross Deposit:</span>
                <span className="font-mono text-foreground font-semibold">NPR {depAmtNum}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Platform Fee ({depFeePct}%):</span>
                <span className="font-mono text-red-600">- NPR {calcDepFee}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-border pt-1 text-emerald-700 dark:text-emerald-400">
                <span>Net Credited to Balance:</span>
                <span className="font-mono">+ NPR {calcDepNet}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                apiDepositMutation.mutate({
                  amount: apiDepositAmount,
                  player_id: apiDepositPlayer,
                })
              }
              disabled={apiDepositMutation.isPending || !apiDepositAmount || Number(apiDepositAmount) <= 0}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {apiDepositMutation.isPending ? "Processing..." : "Confirm Deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: RECORD PLAYER PAYOUT */}
      <Dialog open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <ArrowUpRight className="size-5 text-indigo-600" />
              Record Player Payout (Withdraw)
            </DialogTitle>
            <DialogDescription>
              Process player withdrawal with {wthFeePct}% fee added to total balance debit.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="wth-player">Player ID</Label>
              <Input
                id="wth-player"
                value={apiWithdrawPlayer}
                onChange={(e) => setApiWithdrawPlayer(e.target.value)}
                placeholder="player_01"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wth-amount">Payout Amount (NPR)</Label>
              <Input
                id="wth-amount"
                type="number"
                value={apiWithdrawAmount}
                onChange={(e) => setApiWithdrawAmount(e.target.value)}
                placeholder="500"
              />
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs space-y-1.5">
              <div className="flex justify-between text-muted-foreground">
                <span>Player Receives:</span>
                <span className="font-mono text-foreground font-semibold">NPR {wthAmtNum}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Platform Fee ({wthFeePct}%):</span>
                <span className="font-mono text-red-600">+ NPR {calcWthFee}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-border pt-1 text-red-600 dark:text-red-400">
                <span>Total Debited from Balance:</span>
                <span className="font-mono">- NPR {calcWthTotal}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                apiWithdrawMutation.mutate({
                  amount: apiWithdrawAmount,
                  player_id: apiWithdrawPlayer,
                })
              }
              disabled={apiWithdrawMutation.isPending || !apiWithdrawAmount || Number(apiWithdrawAmount) <= 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {apiWithdrawMutation.isPending ? "Processing..." : "Confirm Payout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
