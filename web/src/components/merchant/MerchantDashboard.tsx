import { Link } from "@tanstack/react-router";
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
  Lock,
  Unlock,
  AlertCircle,
  BookOpen,
  Key,
  Webhook,
  Server,
  Eye,
  EyeOff,
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
  | "ledger"
  | "consumer-services";

interface MerchantDashboardProps {
  initialTab?: MerchantTab;
}

export function MerchantDashboard({ initialTab = "overview" }: MerchantDashboardProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Active navigation tab
  const [activeTab, setActiveTab] = useState<MerchantTab>(initialTab);

  // Modals
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [buyAmount, setBuyAmount] = useState("10000");

  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [apiDepositAmount, setApiDepositAmount] = useState("1000");
  const [apiDepositPlayer, setApiDepositPlayer] = useState("player_01");

  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [apiWithdrawAmount, setApiWithdrawAmount] = useState("500");
  const [apiWithdrawPlayer, setApiWithdrawPlayer] = useState("player_01");

  // Game simulator state
  const [gameAmount, setGameAmount] = useState("500");
  const [gameRef, setGameRef] = useState("ROUND_" + Math.floor(1000 + Math.random() * 9000));

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

  // Check if GGR is enabled for this merchant
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
        `Deposit processed! Fee: NPR ${res.fee_amount} (${res.fee_percent}%), Credited to cash balance: NPR ${res.net_credited}`,
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
        `Withdrawal processed! Fee: NPR ${res.fee_amount} (${res.fee_percent}%), Debited from balance: NPR ${res.total_debited}`,
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
    const key = devProfileQuery.data?.api_key || "ms_live_" + (user?.phone || "key");
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    toast.success("API Key copied to clipboard");
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // Fee rates
  const depFeePct = Number(data?.service_fees?.payment_api_deposit_percent || 1.5);
  const wthFeePct = Number(data?.service_fees?.payment_api_withdraw_percent || 2.0);
  const ggrProfitPct = Number(data?.service_fees?.ggr_monthly_profit_percent || 10.0);

  // Live calculator
  const depAmtNum = Number(apiDepositAmount || 0);
  const calcDepFee = ((depAmtNum * depFeePct) / 100).toFixed(2);
  const calcDepNet = (depAmtNum - Number(calcDepFee)).toFixed(2);

  const wthAmtNum = Number(apiWithdrawAmount || 0);
  const calcWthFee = ((wthAmtNum * wthFeePct) / 100).toFixed(2);
  const calcWthTotal = (wthAmtNum + Number(calcWthFee)).toFixed(2);

  // Filtered transactions
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
    <div className="space-y-6 pb-12 max-w-7xl mx-auto px-2 sm:px-4">
      {/* High-End Obsidian Emerald Merchant Header */}
      <div className="rounded-2xl border border-zinc-800 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 text-white p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-emerald-500/10 via-amber-500/5 to-transparent pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-semibold tracking-wider uppercase text-emerald-400 font-mono">
                MySewa Enterprise Merchant Gateway
              </span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30 font-medium">
                Production Live
              </span>
              {isGgrEnabled ? (
                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 font-semibold flex items-center gap-1">
                  <Coins className="h-3 w-3 text-amber-400" />
                  GGR Service: Active
                </span>
              ) : (
                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full border border-zinc-700 font-medium flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  GGR Service: Disabled
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white flex items-center gap-2">
              <Server className="h-6 w-6 text-emerald-400" />
              {user?.business_name || user?.first_name || "Merchant"} Operations Portal
            </h1>
            <p className="text-xs text-zinc-400 mt-1 max-w-xl">
              Merchant ID: <span className="text-zinc-200 font-mono">MID-{user?.phone}</span> • High-speed Payment APIs, Payin/Payout gateway, and game revenue settlements.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8 text-xs bg-zinc-800/80 border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Button
              size="sm"
              asChild
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-sm"
            >
              <Link to="/app/load">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Deposit Cash
              </Link>
            </Button>

            {isGgrEnabled && (
              <Button
                size="sm"
                onClick={() => setBuyModalOpen(true)}
                className="h-8 text-xs bg-amber-600 hover:bg-amber-500 text-white font-semibold shadow-sm"
              >
                <Coins className="h-3.5 w-3.5 mr-1" />
                Buy GGR Coins
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Merchant Workspace: Dual-Sidebar Navigation + Workspace Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar: Merchant Operations & Normal Services */}
        <div className="lg:col-span-3 space-y-5">
          {/* Group 1: Merchant Operations */}
          <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-2 flex items-center justify-between">
              <span>Merchant Operations</span>
              <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded font-bold">
                API v1
              </span>
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
                <span className="text-[10px] opacity-80 font-mono">LIVE</span>
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
                  Payment API (Payin/Payout)
                </span>
                <span className="text-[10px] bg-blue-500/20 text-blue-600 px-1.5 py-0.5 rounded font-mono">
                  1.5% / 2%
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("ggr")}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  activeTab === "ggr"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Coins className="h-4 w-4" />
                  GGR Gaming Engine
                </span>
                {isGgrEnabled ? (
                  <span className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded font-mono font-bold">
                    ACTIVE
                  </span>
                ) : (
                  <span className="text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-mono flex items-center gap-0.5">
                    <Lock className="h-2.5 w-2.5" />
                    OFF
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("api-keys")}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  activeTab === "api-keys"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  API Keys & Webhooks
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("docs")}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  activeTab === "docs"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  API Docs & Sandbox
                </span>
                <span className="text-[10px] bg-purple-500/20 text-purple-600 px-1.5 py-0.5 rounded">
                  SDK
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
                  Transaction Ledger
                </span>
              </button>
            </nav>
          </div>

          {/* Group 2: Consumer Services (Always Available on Sidebar) */}
          <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-2 flex items-center justify-between">
              <span>Consumer Services</span>
              <span className="text-[10px] text-muted-foreground font-normal">
                Personal Wallet
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground px-2">
              Use your wallet cash for consumer utility payments anytime:
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

          {/* Gateway Status Badge */}
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
              <span className="text-muted-foreground">Webhook Status:</span>
              <span className="text-emerald-600 font-mono">Listening</span>
            </div>
          </div>
        </div>

        {/* Main Workspace Body */}
        <div className="lg:col-span-9 space-y-6">
          {/* Top Balance Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Main Cash Balance */}
            <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Wallet className="h-4 w-4 text-emerald-600" />
                  Merchant Cash Balance (NPR)
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
                  Primary balance funding API player payouts, receiving payin credits, and buying coins.
                </p>
              </div>
            </div>

            {/* GGR Coin Balance (Unlocked if is_ggr, Locked if not) */}
            {isGgrEnabled ? (
              <div className="rounded-2xl border bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-5 shadow-sm space-y-3 border-amber-200/80">
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
            ) : (
              <div className="rounded-2xl border border-dashed bg-muted/20 p-5 shadow-sm space-y-3 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <Lock className="h-4 w-4 text-zinc-400" />
                    GGR Gaming Coin Service
                  </span>
                  <span className="text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded font-mono font-semibold">
                    INACTIVE
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="text-base font-bold text-foreground flex items-center gap-2">
                    GGR Coins Disabled
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Only users with <code className="font-mono bg-muted px-1 rounded text-foreground">is_ggr</code> enabled by Super Admin can access GGR gaming coins and game event APIs.
                  </p>
                </div>
                <div className="text-[11px] text-amber-600 flex items-center gap-1 pt-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Contact administration to enable GGR gaming.
                </div>
              </div>
            )}
          </div>

          {/* TAB 1: OVERVIEW & TELEMETRY */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Telemetry Summary */}
              <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-emerald-600" />
                    <h3 className="font-semibold text-sm">Platform Gateway Service Fees & Profit Share</h3>
                  </div>
                  <div className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-1 rounded-full">
                    {isGgrEnabled ? `GGR Cut: ${ggrProfitPct}% of Net Profit` : "Payment API Active"}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-3 rounded-xl bg-muted/40">
                    <div className="text-xs text-muted-foreground">Payin Deposit Fee</div>
                    <div className="text-base font-bold text-blue-600 mt-0.5">
                      {depFeePct}%
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/40">
                    <div className="text-xs text-muted-foreground">Payout Withdraw Fee</div>
                    <div className="text-base font-bold text-indigo-600 mt-0.5">
                      {wthFeePct}%
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/40">
                    <div className="text-xs text-muted-foreground">GGR Net Profit Cut</div>
                    <div className="text-base font-bold text-amber-600 mt-0.5">
                      {isGgrEnabled ? `${ggrProfitPct}%` : "N/A"}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/40">
                    <div className="text-xs text-muted-foreground">Monthly Est. Fee</div>
                    <div className="text-base font-bold text-foreground mt-0.5">
                      {isGgrEnabled ? formatNPR(Number(data?.estimated_monthly_fee || 0)) : "रु. 0.00"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Game Simulator (Only when GGR is enabled) */}
              {isGgrEnabled ? (
                <div className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b pb-3">
                    <div className="flex items-center gap-2">
                      <Play className="h-4 w-4 text-emerald-600" />
                      <h3 className="font-semibold text-sm">Live Game Event Simulator</h3>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Test coin fluctuations with win / loss mechanics
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

                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] text-muted-foreground">Presets:</span>
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
              ) : null}

              {/* Payment API Simulator Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5 text-blue-700">
                      <ArrowDownLeft className="h-4 w-4" />
                      Player Payin (Deposit)
                    </h4>
                    <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full">
                      Fee: {depFeePct}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Player deposits funds into your platform. Platform fee is deducted and net amount is credited to your cash balance.
                  </p>
                  <Button
                    onClick={() => setDepositModalOpen(true)}
                    variant="outline"
                    className="w-full h-8 text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
                  >
                    Simulate Player Deposit
                  </Button>
                </div>

                <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5 text-indigo-700">
                      <ArrowUpRight className="h-4 w-4" />
                      Player Payout (Withdraw)
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

          {/* TAB 2: PAYMENT API CONSOLE */}
          {activeTab === "payment-api" && (
            <div className="space-y-6">
              <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-5">
                <div className="border-b pb-3">
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-emerald-600" />
                    Payment API Gateway Console
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automate deposits and withdrawals for end-players with real-time fee calculation.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Payin Simulator Form */}
                  <div className="rounded-xl border p-4 space-y-3 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs flex items-center gap-1.5 text-blue-700">
                        <ArrowDownLeft className="h-4 w-4" />
                        Player Deposit (Payin)
                      </span>
                      <span className="text-[10px] font-mono font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                        Fee {depFeePct}%
                      </span>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Player ID</Label>
                      <Input
                        value={apiDepositPlayer}
                        onChange={(e) => setApiDepositPlayer(e.target.value)}
                        placeholder="player_01"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Deposit Amount (NPR)</Label>
                      <Input
                        type="number"
                        value={apiDepositAmount}
                        onChange={(e) => setApiDepositAmount(e.target.value)}
                        placeholder="1000"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg text-xs space-y-1 text-blue-900">
                      <div className="flex justify-between">
                        <span>Gross Deposit:</span>
                        <span className="font-mono font-semibold">NPR {depAmtNum}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Platform Fee ({depFeePct}%):</span>
                        <span className="font-mono text-red-600">- NPR {calcDepFee}</span>
                      </div>
                      <div className="flex justify-between font-bold border-t border-blue-200 pt-1 text-emerald-700">
                        <span>Credited to Your Balance:</span>
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
                      className="w-full text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {apiDepositMutation.isPending ? "Executing Payin..." : "Execute Test Payin"}
                    </Button>
                  </div>

                  {/* Payout Simulator Form */}
                  <div className="rounded-xl border p-4 space-y-3 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs flex items-center gap-1.5 text-indigo-700">
                        <ArrowUpRight className="h-4 w-4" />
                        Player Payout (Withdraw)
                      </span>
                      <span className="text-[10px] font-mono font-bold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded">
                        Fee {wthFeePct}%
                      </span>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Player ID</Label>
                      <Input
                        value={apiWithdrawPlayer}
                        onChange={(e) => setApiWithdrawPlayer(e.target.value)}
                        placeholder="player_01"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Payout Amount (NPR)</Label>
                      <Input
                        type="number"
                        value={apiWithdrawAmount}
                        onChange={(e) => setApiWithdrawAmount(e.target.value)}
                        placeholder="500"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg text-xs space-y-1 text-indigo-900">
                      <div className="flex justify-between">
                        <span>Player Receives:</span>
                        <span className="font-mono font-semibold">NPR {wthAmtNum}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Platform Fee ({wthFeePct}%):</span>
                        <span className="font-mono text-red-600">+ NPR {calcWthFee}</span>
                      </div>
                      <div className="flex justify-between font-bold border-t border-indigo-200 pt-1 text-red-600">
                        <span>Debited from Your Balance:</span>
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
                      className="w-full text-xs h-8 bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      {apiWithdrawMutation.isPending ? "Executing Payout..." : "Execute Test Payout"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: GGR GAMING ENGINE (Only available if is_ggr_user) */}
          {activeTab === "ggr" && (
            <div className="space-y-6">
              {isGgrEnabled ? (
                <>
                  <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b pb-3">
                      <div>
                        <h3 className="font-bold text-base flex items-center gap-2">
                          <Coins className="h-5 w-5 text-amber-600" />
                          GGR Gaming Coins & Mechanics
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          1 NPR = 1 GGR Coin. When players lose, coins decrease. When players win, coins increase by 10% bonus boost.
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

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                      <div className="p-4 rounded-xl border bg-muted/30 space-y-2">
                        <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <Wallet className="h-4 w-4 text-emerald-600" />
                          1. 1:1 Coin Exchange
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Purchase GGR coins with your cash balance anytime. Instant 1:1 settlement.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl border bg-muted/30 space-y-2">
                        <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <TrendingUp className="h-4 w-4 text-emerald-600" />
                          2. +10% Win Multiplier
                        </div>
                        <p className="text-xs text-muted-foreground">
                          When a player wins, your GGR coins increase by amount + 10% bonus boost.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl border bg-muted/30 space-y-2">
                        <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <Sparkles className="h-4 w-4 text-amber-500" />
                          3. Monthly 10% Profit Cut
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Platform takes 10% on positive net gaming profits at the end of each monthly cycle.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Monthly Settlements list */}
                  <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b pb-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-amber-500" />
                        Monthly GGR Profit Settlements
                      </h3>
                      <span className="text-xs text-muted-foreground font-mono">10% Platform Fee</span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px]">
                          <tr>
                            <th className="p-2.5">Month</th>
                            <th className="p-2.5">Net Profit</th>
                            <th className="p-2.5">Fee Rate</th>
                            <th className="p-2.5">Fee Paid</th>
                            <th className="p-2.5">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {data?.monthly_settlements && data.monthly_settlements.length > 0 ? (
                            data.monthly_settlements.map((s) => (
                              <tr key={s.id} className="hover:bg-muted/30">
                                <td className="p-2.5 font-bold">{s.month_key}</td>
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
                              <td colSpan={5} className="p-4 text-center text-muted-foreground">
                                No monthly settlements yet. Audits occur at the end of each billing cycle.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                /* LOCKED STATE FOR GGR */
                <div className="rounded-2xl border border-zinc-800 bg-card p-8 shadow-sm text-center space-y-4">
                  <div className="h-16 w-16 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
                    <Lock className="h-8 w-8" />
                  </div>
                  <div className="space-y-1.5 max-w-md mx-auto">
                    <h3 className="text-lg font-bold text-foreground">GGR Gaming Service Locked</h3>
                    <p className="text-xs text-muted-foreground">
                      GGR Coin management and game event APIs require the <code className="font-mono bg-muted px-1 py-0.5 rounded">is_ggr</code> permission enabled on your merchant account.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border bg-muted/30 max-w-md mx-auto text-xs text-muted-foreground space-y-2 text-left">
                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-amber-500" />
                      What GGR Service Unlocks:
                    </div>
                    <div>• 1:1 GGR Coin conversion from your cash wallet</div>
                    <div>• Game Event API with player win (+10% bonus) and loss processing</div>
                    <div>• Monthly net profit settlement and automated fee distribution</div>
                  </div>

                  <div className="pt-2">
                    <Button variant="outline" asChild className="text-xs">
                      <Link to="/app/support-chat">Contact Support or Admin</Link>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: API KEYS & WEBHOOKS */}
          {activeTab === "api-keys" && (
            <div className="space-y-6">
              <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-5">
                <div className="border-b pb-3">
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <Key className="h-5 w-5 text-emerald-600" />
                    API Credentials & Webhook Settings
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Production API credentials for authenticating requests from your backend server.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Live Production API Key</Label>
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
                      {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" onClick={copyApiKey} className="h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
                      {copiedKey ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                      {copiedKey ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Header: <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">Authorization: Api-Key &lt;YOUR_API_KEY&gt;</code>
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  <Label className="text-xs font-semibold">Configured Webhook URL</Label>
                  <Input
                    readOnly
                    value={devProfileQuery.data?.api_webhook_url || "https://your-server.com/api/mysewa/webhook"}
                    className="font-mono text-xs bg-muted"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    MySewa posts real-time JSON payloads to this endpoint on confirmed deposits and payouts.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: API DOCUMENTATION & SANDBOX */}
          {activeTab === "docs" && (
            <div className="space-y-6">
              <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
                  <div>
                    <h3 className="font-bold text-base flex items-center gap-2">
                      <BookOpen className="h-5 w-5 text-purple-600" />
                      Interactive API Documentation
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

                {/* Endpoint 1: Payin */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 font-mono">
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

url = "https://mysewa.com.np/api/v1/payment/deposit/"
headers = {
    "Authorization": "Api-Key ${rawKey}",
    "Content-Type": "application/json"
}
payload = {
    "amount": 1000.00,
    "player_id": "player_88",
    "reference": "DEP_TXN_001"
}
response = requests.post(url, json=payload, headers=headers)
print(response.json())`}
{docsLang === "node" && `const response = await fetch("https://mysewa.com.np/api/v1/payment/deposit/", {
  method: "POST",
  headers: {
    "Authorization": "Api-Key ${rawKey}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    amount: 1000.00,
    player_id: "player_88",
    reference: "DEP_TXN_001"
  })
});
const data = await response.json();
console.log(data);`}
                  </pre>
                </div>

                {/* Endpoint 2: Payout */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 font-mono">
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

                {/* Endpoint 3: Game Event (if enabled) */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 font-mono">
                      POST
                    </span>
                    <span className="font-mono text-xs font-bold text-foreground">
                      /api/v1/ggr/game-event/
                    </span>
                    <span className="text-xs text-muted-foreground">
                      — Player Win (+10% Bonus) / Loss (Requires is_ggr)
                    </span>
                  </div>

                  <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 text-xs font-mono overflow-x-auto">
{`curl -X POST "https://mysewa.com.np/api/v1/ggr/game-event/" \\
  -H "Authorization: Api-Key ${rawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "event_type": "player_win", // or "player_loss"
    "amount": 500.00,
    "reference": "ROUND_789"
  }'`}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: TRANSACTION LEDGER */}
          {activeTab === "ledger" && (
            <div className="space-y-6">
              <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    Complete Merchant Operations Ledger
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
                            No matching transactions recorded.
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
              Simulate Player Payin (Deposit)
            </DialogTitle>
            <DialogDescription>
              Test player deposit. Platform fee is deducted from gross deposit.
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
              <div>• Platform Fee ({depFeePct}%): NPR {calcDepFee}</div>
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
              Test player withdrawal. Platform fee is added to your total debit.
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
              <div>• Platform Fee ({wthFeePct}%): NPR {calcWthFee}</div>
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
  );
}
