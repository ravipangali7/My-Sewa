import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Coins,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  History,
  ShieldAlert,
  Plus,
  Play,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  Copy,
  Code,
  CreditCard,
  Smartphone,
  Send,
  Wifi,
  Zap,
  Droplet,
  Globe,
  FileText,
  Sliders,
  Landmark,
  Users,
  Calendar,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Terminal,
  Activity,
  Layers,
  Check,
  Clock,
  Search,
  Filter,
} from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export const Route = createFileRoute("/app/ggr")({
  component: GgrMerchantDashboardScreen,
});

type MerchantNavTab = "overview" | "coins" | "payment-api" | "integration" | "ledger";

function GgrMerchantDashboardScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Active sub-view in the Merchant Operations console
  const [activeTab, setActiveTab] = useState<MerchantNavTab>("overview");

  // Buy GGR Coins modal
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [buyAmount, setBuyAmount] = useState("10000");

  // Payment API Deposit modal
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [apiDepositAmount, setApiDepositAmount] = useState("1000");
  const [apiDepositPlayer, setApiDepositPlayer] = useState("player_01");

  // Payment API Withdraw modal
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [apiWithdrawAmount, setApiWithdrawAmount] = useState("500");
  const [apiWithdrawPlayer, setApiWithdrawPlayer] = useState("player_01");

  // Game simulator state
  const [gameAmount, setGameAmount] = useState("500");
  const [gameRef, setGameRef] = useState("ROUND_" + Math.floor(1000 + Math.random() * 9000));

  // Search & filter in ledger
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState("all");

  const [copiedKey, setCopiedKey] = useState(false);

  // Queries
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["ggr-dashboard"],
    queryFn: () => apiClient.getGgrDashboard(),
  });

  const devProfileQuery = useQuery({
    queryKey: ["developer", "profile"],
    queryFn: () => apiClient.developerProfile(),
    enabled: Boolean(user?.is_api_user),
  });

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
      toast.error(err?.message || "Failed to buy GGR coins.");
    },
  });

  const gameEventMutation = useMutation({
    mutationFn: (payload: { event_type: "player_win" | "player_loss"; amount: string; reference?: string }) =>
      apiClient.postGameEvent(payload),
    onSuccess: (res) => {
      toast.success(
        res.event_type === "player_win"
          ? `Player Won! GGR coins increased by ${res.amount} (+10% bonus applied)`
          : `Player Lost! GGR coins decreased by ${Math.abs(Number(res.amount))}`,
      );
      setGameRef("ROUND_" + Math.floor(1000 + Math.random() * 9000));
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to process game event.");
    },
  });

  const apiDepositMutation = useMutation({
    mutationFn: (payload: { amount: string; player_id: string }) =>
      apiClient.paymentApiDeposit(payload),
    onSuccess: (res) => {
      toast.success(
        `Deposit processed! Fee: NPR ${res.fee_amount} (${res.fee_percent}%), Credited to your cash balance: NPR ${res.net_credited}`,
      );
      setDepositModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Deposit API call failed.");
    },
  });

  const apiWithdrawMutation = useMutation({
    mutationFn: (payload: { amount: string; player_id: string }) =>
      apiClient.paymentApiWithdraw(payload),
    onSuccess: (res) => {
      toast.success(
        `Withdrawal processed! Fee: NPR ${res.fee_amount} (${res.fee_percent}%), Total debited from your balance: NPR ${res.total_debited}`,
      );
      setWithdrawModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Withdraw API call failed.");
    },
  });

  const copyApiKey = () => {
    const key = devProfileQuery.data?.api_key || "api_live_" + (user?.phone || "merchant_key");
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    toast.success("API Key copied to clipboard");
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // Filtered transactions for the ledger
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

  // Access check
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

  const feeConfig = data?.service_fees;
  const depFeePct = Number(feeConfig?.payment_api_deposit_percent || 1.5);
  const wthFeePct = Number(feeConfig?.payment_api_withdraw_percent || 2.0);
  const ggrProfitPct = Number(feeConfig?.ggr_monthly_profit_percent || 10.0);

  // Live calculator for deposit
  const depAmtNum = Number(apiDepositAmount || 0);
  const calcDepFee = ((depAmtNum * depFeePct) / 100).toFixed(2);
  const calcDepNet = (depAmtNum - Number(calcDepFee)).toFixed(2);

  // Live calculator for withdraw
  const wthAmtNum = Number(apiWithdrawAmount || 0);
  const calcWthFee = ((wthAmtNum * wthFeePct) / 100).toFixed(2);
  const calcWthTotal = (wthAmtNum + Number(calcWthFee)).toFixed(2);

  return (
    <UserShell title="Merchant Terminal" back="/app">
      <div className="space-y-6 pb-12">
        {/* Merchant Header Bar */}
        <div className="rounded-2xl border border-border/80 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 text-white p-5 shadow-lg relative overflow-hidden">
          <div className="absolute right-0 top-0 bottom-0 w-96 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-transparent pointer-events-none" />
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[11px] font-semibold tracking-wider uppercase text-emerald-400">
                  MySewa Merchant Operations Hub
                </span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  Production Live
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                <Coins className="h-6 w-6 text-emerald-400" />
                GGR Coin & Payment API Terminal
              </h1>
              <p className="text-xs text-zinc-400 mt-1">
                Merchant account: <span className="text-zinc-200 font-mono">{user.phone}</span> • 1 NPR = 1 GGR Coin • Real-time fee distribution active
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
                className="h-8 text-xs bg-zinc-800/80 border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:text-white"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
                Refresh Telemetry
              </Button>
              <Button
                size="sm"
                onClick={() => setBuyModalOpen(true)}
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Buy GGR Coins
              </Button>
            </div>
          </div>
        </div>

        {/* Dual Navigation + Main Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Sidebar Navigation: Dual Sections (Merchant Operations + Normal Services) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Section 1: Merchant Operations */}
            <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-2">
                Merchant Operations
              </div>
              <nav className="space-y-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("overview")}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "overview"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Overview & Telemetry
                  </span>
                  <span className="text-[10px] opacity-75 font-mono">LIVE</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("coins")}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "coins"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Coins className="h-4 w-4" />
                    GGR Coins Vault
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("payment-api")}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "payment-api"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Payment API Console
                  </span>
                  <span className="text-[10px] bg-amber-500/20 text-amber-600 px-1.5 py-0.5 rounded">
                    Payin/Out
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("integration")}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "integration"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    API Keys & Webhooks
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("ledger")}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === "ledger"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Settlement & Ledger
                  </span>
                </button>
              </nav>
            </div>

            {/* Section 2: Normal Consumer Services */}
            <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-2 flex items-center justify-between">
                <span>Normal Services</span>
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-foreground font-normal">
                  Personal Wallet
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground px-2">
                Use your wallet cash for consumer utility payments and fund transfers anytime:
              </p>
              <nav className="space-y-1">
                <Link
                  to="/app/topup"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-foreground hover:bg-muted hover:text-emerald-600 transition-colors"
                >
                  <Smartphone className="h-3.5 w-3.5 text-emerald-600" />
                  Mobile Topup
                </Link>
                <Link
                  to="/app/transfer"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-foreground hover:bg-muted hover:text-emerald-600 transition-colors"
                >
                  <Send className="h-3.5 w-3.5 text-blue-600" />
                  Bank & Fund Transfer
                </Link>
                <Link
                  to="/app/internet"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-foreground hover:bg-muted hover:text-emerald-600 transition-colors"
                >
                  <Wifi className="h-3.5 w-3.5 text-indigo-600" />
                  Internet Bill
                </Link>
                <Link
                  to="/app/electricity"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-foreground hover:bg-muted hover:text-emerald-600 transition-colors"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  Electricity Bill
                </Link>
                <Link
                  to="/app/water"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-foreground hover:bg-muted hover:text-emerald-600 transition-colors"
                >
                  <Droplet className="h-3.5 w-3.5 text-cyan-600" />
                  Water Bill (Khanepani)
                </Link>
                <Link
                  to="/app/remittance"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-foreground hover:bg-muted hover:text-emerald-600 transition-colors"
                >
                  <Globe className="h-3.5 w-3.5 text-purple-600" />
                  Remittance Transfer
                </Link>
                <Link
                  to="/app/load"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-foreground hover:bg-muted hover:text-emerald-600 transition-colors"
                >
                  <Wallet className="h-3.5 w-3.5 text-emerald-600" />
                  Load Wallet Cash
                </Link>
                <Link
                  to="/app/history"
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-foreground hover:bg-muted hover:text-emerald-600 transition-colors"
                >
                  <FileText className="h-3.5 w-3.5 text-zinc-500" />
                  All Wallet Statements
                </Link>
              </nav>
            </div>

            {/* Merchant Gateway Health card */}
            <div className="rounded-2xl border bg-muted/40 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-muted-foreground">API Latency:</span>
                <span className="text-emerald-600 font-mono font-bold">24ms</span>
              </div>
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-muted-foreground">Gateway Uptime:</span>
                <span className="text-foreground font-mono">99.98%</span>
              </div>
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-muted-foreground">Settlement Cycle:</span>
                <span className="text-foreground font-mono">Monthly (10%)</span>
              </div>
            </div>
          </div>

          {/* Main Workspace Body */}
          <div className="lg:col-span-9 space-y-6">
            {/* Top Balances Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Main Cash Balance */}
              <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Wallet className="h-4 w-4 text-emerald-600" />
                    Main Cash Wallet (NPR)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                      <Link to="/app/load">Deposit Cash</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setWithdrawModalOpen(true)}
                      className="h-7 text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                    >
                      API Payout
                    </Button>
                  </div>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-foreground">
                    {isLoading ? "..." : formatNPR(Number(data?.cash_balance || 0))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Main balance backing GGR coin purchases and player payins/payouts.
                  </p>
                </div>
              </div>

              {/* GGR Coin Balance */}
              <div className="rounded-2xl border bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-5 shadow-sm space-y-4 border-amber-200/80">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                    <Coins className="h-4 w-4 text-amber-600" />
                    GGR Coin Reserve
                  </span>
                  <Button
                    size="sm"
                    onClick={() => setBuyModalOpen(true)}
                    className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Buy Coins
                  </Button>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-amber-700 flex items-baseline gap-2">
                    <span>{isLoading ? "..." : Number(data?.ggr_coin_balance || 0).toLocaleString()}</span>
                    <span className="text-sm font-semibold text-amber-600">Coins</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span>Bought: {Number(data?.total_bought || 0).toLocaleString()}</span>
                    <span>•</span>
                    <span className="text-emerald-600 font-medium">Won (+10%): {Number(data?.total_won || 0).toLocaleString()}</span>
                    <span>•</span>
                    <span className="text-red-500">Lost: {Number(data?.total_lost || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* TAB CONTENT: OVERVIEW */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Monthly GGR Settlement & Platform Fee Summary */}
                <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-amber-500" />
                      <h3 className="font-semibold text-sm">Monthly GGR Profit & Service Cut Telemetry</h3>
                    </div>
                    <div className="text-xs bg-amber-100 text-amber-800 font-semibold px-2.5 py-1 rounded-full">
                      Platform Fee: {ggrProfitPct}% of Monthly Net Profit
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-3 rounded-xl bg-muted/40">
                      <div className="text-xs text-muted-foreground">Est. Net Profit</div>
                      <div className="text-base font-bold text-foreground mt-0.5">
                        {formatNPR(Number(data?.net_profit_estimate || 0))}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/40">
                      <div className="text-xs text-muted-foreground">Est. 10% Cut</div>
                      <div className="text-base font-bold text-amber-700 mt-0.5">
                        {formatNPR(Number(data?.estimated_monthly_fee || 0))}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/40">
                      <div className="text-xs text-muted-foreground">Deposit API Fee</div>
                      <div className="text-base font-bold text-foreground mt-0.5">
                        {depFeePct}%
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/40">
                      <div className="text-xs text-muted-foreground">Withdraw API Fee</div>
                      <div className="text-base font-bold text-foreground mt-0.5">
                        {wthFeePct}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick Interactive Gameplay Simulator Widget */}
                <div className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b pb-3">
                    <div className="flex items-center gap-2">
                      <Play className="h-4 w-4 text-emerald-600" />
                      <h3 className="font-semibold text-sm">Live Game Event Simulator</h3>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Simulate live player bet results to test coin fluctuations
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Game Round Ref</Label>
                      <Input
                        value={gameRef}
                        onChange={(e) => setGameRef(e.target.value)}
                        placeholder="ROUND_1001"
                        className="h-9 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Base Bet Amount (NPR / Coins)</Label>
                      <Input
                        type="number"
                        value={gameAmount}
                        onChange={(e) => setGameAmount(e.target.value)}
                        placeholder="500"
                        className="h-9 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() =>
                          gameEventMutation.mutate({
                            event_type: "player_win",
                            amount: gameAmount,
                            reference: gameRef,
                          })
                        }
                        disabled={gameEventMutation.isPending || !gameAmount}
                        className="flex-1 h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                      >
                        <TrendingUp className="h-3.5 w-3.5 mr-1" />
                        Player Win (+10%)
                      </Button>
                      <Button
                        onClick={() =>
                          gameEventMutation.mutate({
                            event_type: "player_loss",
                            amount: gameAmount,
                            reference: gameRef,
                          })
                        }
                        disabled={gameEventMutation.isPending || !gameAmount}
                        variant="destructive"
                        className="flex-1 h-9 text-xs"
                      >
                        <TrendingDown className="h-3.5 w-3.5 mr-1" />
                        Player Loss
                      </Button>
                    </div>
                  </div>

                  {/* Preset quick buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] text-muted-foreground">Quick Presets:</span>
                    {["100", "500", "1000", "5000"].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setGameAmount(amt)}
                        className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                          gameAmount === amt
                            ? "bg-emerald-50 border-emerald-300 text-emerald-700 font-bold"
                            : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {amt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick Payment API Actions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Deposit API Simulator Card */}
                  <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-1.5 text-blue-700">
                        <ArrowDownLeft className="h-4 w-4" />
                        Player Deposit API (Payin)
                      </h4>
                      <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full">
                        Fee: {depFeePct}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Player deposits funds into your game platform. Platform fee is deducted and net credited to your cash balance.
                    </p>
                    <Button
                      onClick={() => setDepositModalOpen(true)}
                      variant="outline"
                      className="w-full h-8 text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
                    >
                      Simulate Player Deposit
                    </Button>
                  </div>

                  {/* Withdraw API Simulator Card */}
                  <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-1.5 text-indigo-700">
                        <ArrowUpRight className="h-4 w-4" />
                        Player Payout API (Withdraw)
                      </h4>
                      <span className="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full">
                        Fee: {wthFeePct}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Player withdraws winnings. Platform fee is added and total is debited from your merchant cash balance.
                    </p>
                    <Button
                      onClick={() => setWithdrawModalOpen(true)}
                      variant="outline"
                      className="w-full h-8 text-xs text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                    >
                      Simulate Player Payout
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: GGR COINS VAULT */}
            {activeTab === "coins" && (
              <div className="space-y-6">
                <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
                  <div className="flex items-center justify-between border-b pb-3">
                    <div>
                      <h3 className="font-bold text-base flex items-center gap-2">
                        <Coins className="h-5 w-5 text-amber-600" />
                        GGR Coin Management & Exchange
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Exchange rate: 1 NPR = 1 GGR Coin. Instant settlement from main wallet cash balance.
                      </p>
                    </div>
                    <Button
                      onClick={() => setBuyModalOpen(true)}
                      className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-8"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Buy Coins
                    </Button>
                  </div>

                  {/* Explanation card */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div className="p-4 rounded-xl border bg-muted/30 space-y-2">
                      <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Wallet className="h-4 w-4 text-emerald-600" />
                        1. Buy GGR Coins
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Purchase GGR coins with your NPR balance. 10,000 NPR gives you 10,000 GGR coins ready for gameplay.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl border bg-muted/30 space-y-2">
                      <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                        2. Player Gameplay Mechanics
                      </div>
                      <p className="text-xs text-muted-foreground">
                        When a player loses, GGR coins decrease. When a player wins, GGR coins increase by 10% bonus boost!
                      </p>
                    </div>

                    <div className="p-4 rounded-xl border bg-muted/30 space-y-2">
                      <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-amber-500" />
                        3. Monthly 10% Service Fee
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Every month, platform takes 10% service fee on your net gaming profit, distributed directly to shareholders.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Coin History Table preview */}
                <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-3">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    Recent Coin Fluctuations
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px]">
                        <tr>
                          <th className="p-2.5">Date</th>
                          <th className="p-2.5">Type</th>
                          <th className="p-2.5">Coins</th>
                          <th className="p-2.5">Balance After</th>
                          <th className="p-2.5">Reference</th>
                          <th className="p-2.5">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data?.recent_transactions?.slice(0, 10).map((t) => (
                          <tr key={t.id} className="hover:bg-muted/30">
                            <td className="p-2.5 font-mono text-muted-foreground">
                              {formatDateTime(t.created_at)}
                            </td>
                            <td className="p-2.5 font-medium">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  t.txn_type === "buy"
                                    ? "bg-amber-100 text-amber-800"
                                    : t.txn_type === "player_win"
                                      ? "bg-emerald-100 text-emerald-800"
                                      : t.txn_type === "player_loss"
                                        ? "bg-red-100 text-red-800"
                                        : "bg-blue-100 text-blue-800"
                                }`}
                              >
                                {t.type_label}
                              </span>
                            </td>
                            <td
                              className={`p-2.5 font-bold font-mono ${
                                Number(t.amount) >= 0 ? "text-emerald-600" : "text-red-500"
                              }`}
                            >
                              {Number(t.amount) >= 0 ? `+${t.amount}` : t.amount}
                            </td>
                            <td className="p-2.5 font-mono">{t.balance_after}</td>
                            <td className="p-2.5 font-mono text-muted-foreground">{t.reference}</td>
                            <td className="p-2.5 text-muted-foreground max-w-xs truncate">{t.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: PAYMENT API CONSOLE */}
            {activeTab === "payment-api" && (
              <div className="space-y-6">
                <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
                  <div className="border-b pb-3">
                    <h3 className="font-bold text-base flex items-center gap-2">
                      <CreditCard className="h-5 w-5 text-emerald-600" />
                      Payment API Integration & Endpoints
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Accept deposits and issue payouts automatically through secure REST APIs.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Payin (Deposit) Card */}
                    <div className="rounded-xl border p-4 space-y-3 bg-muted/20">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs flex items-center gap-1.5 text-blue-700">
                          <ArrowDownLeft className="h-4 w-4" />
                          Player Deposit (Payin)
                        </span>
                        <span className="text-[10px] font-mono font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                          POST /api/v1/payment/deposit/
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Deducts {depFeePct}% platform fee from the gross deposit. Net credited to your cash balance.
                      </p>
                      <div className="p-3 bg-zinc-950 text-zinc-200 rounded-lg text-[11px] font-mono space-y-1">
                        <div>// Sample Request Body:</div>
                        <div className="text-emerald-400">
                          {JSON.stringify({ amount: 1000, player_id: "player_99", reference: "DEP_123" }, null, 2)}
                        </div>
                      </div>
                      <Button
                        onClick={() => setDepositModalOpen(true)}
                        className="w-full text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        Simulate Deposit Request
                      </Button>
                    </div>

                    {/* Payout (Withdraw) Card */}
                    <div className="rounded-xl border p-4 space-y-3 bg-muted/20">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs flex items-center gap-1.5 text-indigo-700">
                          <ArrowUpRight className="h-4 w-4" />
                          Player Payout (Withdraw)
                        </span>
                        <span className="text-[10px] font-mono font-bold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded">
                          POST /api/v1/payment/withdraw/
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Adds {wthFeePct}% platform fee to the withdrawal. Total amount is debited from your cash balance.
                      </p>
                      <div className="p-3 bg-zinc-950 text-zinc-200 rounded-lg text-[11px] font-mono space-y-1">
                        <div>// Sample Request Body:</div>
                        <div className="text-indigo-400">
                          {JSON.stringify({ amount: 500, player_id: "player_99", reference: "WTH_456" }, null, 2)}
                        </div>
                      </div>
                      <Button
                        onClick={() => setWithdrawModalOpen(true)}
                        className="w-full text-xs h-8 bg-indigo-600 hover:bg-indigo-700 text-white"
                      >
                        Simulate Payout Request
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: API KEYS & WEBHOOKS */}
            {activeTab === "integration" && (
              <div className="space-y-6">
                <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-5">
                  <div className="border-b pb-3">
                    <h3 className="font-bold text-base flex items-center gap-2">
                      <Terminal className="h-5 w-5 text-emerald-600" />
                      API Credentials & Webhooks
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Use these credentials in your gaming server backend to authenticate API requests.
                    </p>
                  </div>

                  {/* API Key box */}
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Live API Key</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={devProfileQuery.data?.api_key || `ms_live_key_${user.phone}`}
                        className="font-mono text-xs bg-muted"
                      />
                      <Button size="sm" onClick={copyApiKey} className="h-9 text-xs">
                        {copiedKey ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                        {copiedKey ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Include as header: <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">Authorization: Api-Key &lt;YOUR_API_KEY&gt;</code>
                    </p>
                  </div>

                  {/* Code snippet */}
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Sample cURL Integration</Label>
                    <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 text-xs font-mono overflow-x-auto">
{`curl -X POST "https://mysewa.com.np/api/v1/payment/deposit/" \\
  -H "Authorization: Api-Key ${devProfileQuery.data?.api_key || "YOUR_API_KEY"}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 1000.00,
    "player_id": "player_88",
    "reference": "DEP_TXN_001"
  }'`}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: SETTLEMENT & LEDGER */}
            {activeTab === "ledger" && (
              <div className="space-y-6">
                {/* Monthly Settlements list */}
                <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between border-b pb-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-amber-500" />
                      Monthly GGR 10% Profit Settlements
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      Audited monthly fee statements
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px]">
                        <tr>
                          <th className="p-2.5">Month</th>
                          <th className="p-2.5">Starting Balance</th>
                          <th className="p-2.5">Ending Balance</th>
                          <th className="p-2.5">Net Profit</th>
                          <th className="p-2.5">Fee %</th>
                          <th className="p-2.5">Fee Amount</th>
                          <th className="p-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data?.monthly_settlements && data.monthly_settlements.length > 0 ? (
                          data.monthly_settlements.map((s) => (
                            <tr key={s.id} className="hover:bg-muted/30">
                              <td className="p-2.5 font-bold">{s.month_key}</td>
                              <td className="p-2.5 font-mono">{s.starting_balance}</td>
                              <td className="p-2.5 font-mono">{s.ending_balance}</td>
                              <td className="p-2.5 font-mono font-bold text-emerald-600">
                                {formatNPR(Number(s.net_profit))}
                              </td>
                              <td className="p-2.5 font-mono">{s.fee_percent}%</td>
                              <td className="p-2.5 font-mono font-bold text-amber-700">
                                {formatNPR(Number(s.fee_amount))}
                              </td>
                              <td className="p-2.5">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                  {s.status.toUpperCase()}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={7} className="p-4 text-center text-muted-foreground">
                              No monthly settlements executed yet. Settlements occur at the end of each billing cycle.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* All GGR Transactions with Search & Filter */}
                <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <History className="h-4 w-4 text-muted-foreground" />
                      Complete GGR Coin Transaction Ledger
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
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
                        <option value="player_win">Player Wins (+10%)</option>
                        <option value="player_loss">Player Losses</option>
                        <option value="monthly_settlement">Settlements</option>
                      </select>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px]">
                        <tr>
                          <th className="p-2.5">Date</th>
                          <th className="p-2.5">Type</th>
                          <th className="p-2.5">Amount</th>
                          <th className="p-2.5">Coin Balance After</th>
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
                                      ? "bg-amber-100 text-amber-800"
                                      : t.txn_type === "player_win"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : t.txn_type === "player_loss"
                                          ? "bg-red-100 text-red-800"
                                          : "bg-blue-100 text-blue-800"
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
                              No matching transactions found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* MODAL: BUY GGR COINS */}
        <Dialog open={buyModalOpen} onOpenChange={setBuyModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-amber-500" />
                Buy GGR Coins
              </DialogTitle>
              <DialogDescription>
                Convert your wallet cash into GGR coins at a 1:1 rate (1 NPR = 1 GGR Coin).
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
                <div className="flex gap-2">
                  {["5000", "10000", "25000", "50000"].map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setBuyAmount(preset)}
                      className="text-xs flex-1 h-7"
                    >
                      {Number(preset).toLocaleString()}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-900 space-y-1">
                <div className="font-semibold">Conversion Summary:</div>
                <div>• NPR to deduct: {formatNPR(Number(buyAmount || 0))}</div>
                <div>• GGR Coins credited: {Number(buyAmount || 0).toLocaleString()} Coins</div>
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

        {/* MODAL: PAYMENT API DEPOSIT */}
        <Dialog open={depositModalOpen} onOpenChange={setDepositModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-blue-700">
                <ArrowDownLeft className="h-5 w-5" />
                Simulate Player Deposit (Payin)
              </DialogTitle>
              <DialogDescription>
                Test your game player depositing NPR into your platform. Platform fee is deducted.
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

              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-900 space-y-1">
                <div className="font-semibold">Fee Calculation:</div>
                <div>• Gross Deposit: NPR {depAmtNum}</div>
                <div>• Platform Cut ({depFeePct}%): NPR {calcDepFee} (Distributed to Shareholders)</div>
                <div className="font-bold text-emerald-700">• Net Credited to Your Cash Balance: NPR {calcDepNet}</div>
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
                {apiDepositMutation.isPending ? "Processing..." : "Process Deposit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL: PAYMENT API WITHDRAW */}
        <Dialog open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-indigo-700">
                <ArrowUpRight className="h-5 w-5" />
                Simulate Player Payout (Withdraw)
              </DialogTitle>
              <DialogDescription>
                Test your game player withdrawing winnings. Platform fee is added to your total debit.
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

              <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 text-xs text-indigo-900 space-y-1">
                <div className="font-semibold">Fee Calculation:</div>
                <div>• Player Payout: NPR {wthAmtNum}</div>
                <div>• Platform Cut ({wthFeePct}%): NPR {calcWthFee} (Distributed to Shareholders)</div>
                <div className="font-bold text-red-600">• Total Debited from Your Balance: NPR {calcWthTotal}</div>
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
                {apiWithdrawMutation.isPending ? "Processing..." : "Process Payout"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </UserShell>
  );
}
