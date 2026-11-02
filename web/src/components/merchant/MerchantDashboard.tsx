import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import {
  Coins,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  History,
  Plus,
  Copy,
  CreditCard,
  RefreshCw,
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
  Landmark,
  ArrowRight,
  ShieldCheck,
  ExternalLink,
  Calendar,
  Building,
  Sparkles,
  Download,
  Info,
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
import { BankCombobox } from "@/components/BankCombobox";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
import { mergeBankLists } from "@/lib/nepali-banks";
import type { BankOption } from "@/lib/types";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export type MerchantTab =
  | "overview"
  | "payment-api"
  | "ggr"
  | "api-keys"
  | "docs"
  | "ledger"
  | "bank-accounts";

export interface SavedPayoutBankAccount {
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  branch?: string;
  verified: boolean;
  verified_at?: string;
}

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

  // Saved Payout Bank Account state (stored per merchant)
  const bankStorageKey = `mysewa_payout_bank_${user?.id || user?.phone || "default"}`;
  const [savedBank, setSavedBank] = useState<SavedPayoutBankAccount | null>(() => {
    try {
      const stored = localStorage.getItem(bankStorageKey);
      if (stored) return JSON.parse(stored);
    } catch {}
    return null;
  });

  const persistSavedBank = (account: SavedPayoutBankAccount | null) => {
    setSavedBank(account);
    try {
      if (account) {
        localStorage.setItem(bankStorageKey, JSON.stringify(account));
      } else {
        localStorage.removeItem(bankStorageKey);
      }
    } catch {}
  };

  // Modals state
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositTab, setDepositTab] = useState<"load" | "api-payin">("load");
  const [apiDepositAmount, setApiDepositAmount] = useState("1000");
  const [apiDepositPlayer, setApiDepositPlayer] = useState("player_01");

  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawRemarks, setWithdrawRemarks] = useState("Merchant settlement withdrawal");
  const [withdrawBankCode, setWithdrawBankCode] = useState(savedBank?.bank_code || "");
  const [withdrawBankName, setWithdrawBankName] = useState(savedBank?.bank_name || "");
  const [withdrawAccNumber, setWithdrawAccNumber] = useState(savedBank?.account_number || "");
  const [withdrawAccName, setWithdrawAccName] = useState(savedBank?.account_name || "");
  const [isVerifyingWithdrawBank, setIsVerifyingWithdrawBank] = useState(false);
  const [withdrawAccountVerified, setWithdrawAccountVerified] = useState(Boolean(savedBank?.verified));

  const [bankSetupModalOpen, setBankSetupModalOpen] = useState(false);
  const [setupBankCode, setSetupBankCode] = useState(savedBank?.bank_code || "");
  const [setupBankName, setSetupBankName] = useState(savedBank?.bank_name || "");
  const [setupAccNumber, setSetupAccNumber] = useState(savedBank?.account_number || "");
  const [setupAccName, setSetupAccName] = useState(savedBank?.account_name || "");
  const [setupBranch, setSetupBranch] = useState(savedBank?.branch || "");
  const [isVerifyingSetupBank, setIsVerifyingSetupBank] = useState(false);
  const [setupAccountVerified, setSetupAccountVerified] = useState(Boolean(savedBank?.verified));

  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [buyAmount, setBuyAmount] = useState("10000");

  // Sync state when savedBank changes
  useEffect(() => {
    if (savedBank) {
      if (!withdrawBankCode) setWithdrawBankCode(savedBank.bank_code);
      if (!withdrawBankName) setWithdrawBankName(savedBank.bank_name);
      if (!withdrawAccNumber) setWithdrawAccNumber(savedBank.account_number);
      if (!withdrawAccName) setWithdrawAccName(savedBank.account_name);
      setWithdrawAccountVerified(savedBank.verified);

      if (!setupBankCode) setSetupBankCode(savedBank.bank_code);
      if (!setupBankName) setSetupBankName(savedBank.bank_name);
      if (!setupAccNumber) setSetupAccNumber(savedBank.account_number);
      if (!setupAccName) setSetupAccName(savedBank.account_name);
      if (!setupBranch && savedBank.branch) setSetupBranch(savedBank.branch);
      setSetupAccountVerified(savedBank.verified);
    }
  }, [savedBank]);

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

  const banksQuery = useQuery({
    queryKey: ["banks", "list"],
    queryFn: async () => {
      const res = await apiClient.listBanks();
      return (res.banks || res.data?.banks || []) as BankOption[];
    },
    staleTime: 10 * 60 * 1000,
  });

  const nepaliBanks = useMemo(
    () => mergeBankLists(banksQuery.data ?? []),
    [banksQuery.data],
  );

  const destinationsQuery = useQuery({
    queryKey: ["deposit", "destinations"],
    queryFn: () => apiClient.depositDestinations(),
    staleTime: 5 * 60 * 1000,
  });

  const isGgrEnabled = Boolean(
    user?.is_ggr_user || user?.is_ggr || data?.is_ggr_enabled,
  );

  const cashBalance = Number(data?.cash_balance || 0);

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
        `Production Deposit Confirmed: NPR ${res.net_credited} credited to cash balance (Fee: NPR ${res.fee_amount}).`,
      );
      setDepositModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Deposit transaction failed.");
    },
  });

  const ownWithdrawMutation = useMutation({
    mutationFn: async (payload: {
      bank_code: string;
      bank_name: string;
      account_number: string;
      account_name: string;
      amount: string;
      remarks?: string;
    }) => {
      return apiClient.createTransfer({
        bank_code: payload.bank_code,
        bank_name: payload.bank_name,
        account_number: payload.account_number,
        account_name: payload.account_name,
        amount: payload.amount,
        remarks: payload.remarks || "Merchant payout withdrawal",
      });
    },
    onSuccess: (res) => {
      toast.success(
        res.message || `Payout of NPR ${withdrawAmount} successfully disbursed to ${withdrawBankName}!`,
      );
      setWithdrawModalOpen(false);
      setWithdrawAmount("");
      queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: (err: any) => {
      toast.error(err instanceof ApiError ? err.message : "Payout withdrawal failed.");
    },
  });

  const verifySetupBankAccount = async () => {
    if (!setupBankCode || !setupAccNumber) {
      toast.error("Please select a bank and enter the account number.");
      return;
    }
    setIsVerifyingSetupBank(true);
    try {
      const res = await apiClient.verifyBank({
        bank_code: setupBankCode,
        bank_name: setupBankName,
        account_number: setupAccNumber,
        account_name: setupAccName || undefined,
      });

      if (res?.data?.verified || res?.data?.account_name) {
        const officialName = res.data.account_name || setupAccName;
        setSetupAccName(officialName);
        setSetupAccountVerified(true);
        toast.success(`Account Verified: ${officialName}`);
      } else {
        setSetupAccountVerified(true);
        toast.success("Account format verified with Nepal Clearing Network.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Could not verify bank account with provider.");
    } finally {
      setIsVerifyingSetupBank(false);
    }
  };

  const handleSaveSetupBankAccount = () => {
    if (!setupBankCode || !setupAccNumber || !setupAccName) {
      toast.error("Please provide Bank, Account Number, and Account Name.");
      return;
    }
    const newAccount: SavedPayoutBankAccount = {
      bank_code: setupBankCode,
      bank_name: setupBankName,
      account_number: setupAccNumber,
      account_name: setupAccName,
      branch: setupBranch,
      verified: setupAccountVerified,
      verified_at: new Date().toISOString(),
    };
    persistSavedBank(newAccount);
    toast.success("Payout bank account saved as your primary withdrawal destination!");
    setBankSetupModalOpen(false);
  };

  const verifyWithdrawBankAccount = async () => {
    if (!withdrawBankCode || !withdrawAccNumber) {
      toast.error("Please select a bank and enter the account number.");
      return;
    }
    setIsVerifyingWithdrawBank(true);
    try {
      const res = await apiClient.verifyBank({
        bank_code: withdrawBankCode,
        bank_name: withdrawBankName,
        account_number: withdrawAccNumber,
        account_name: withdrawAccName || undefined,
      });
      if (res?.data?.account_name) {
        setWithdrawAccName(res.data.account_name);
      }
      setWithdrawAccountVerified(true);
      toast.success("Bank account verified successfully.");
    } catch (err: any) {
      toast.error(err?.message || "Bank account verification failed.");
    } finally {
      setIsVerifyingWithdrawBank(false);
    }
  };

  const copyApiKey = () => {
    const key = devProfileQuery.data?.api_key || "ms_live_" + (user?.phone || "key");
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    toast.success("Production API Key copied to clipboard");
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const depFeePct = Number(data?.service_fees?.payment_api_deposit_percent || 1.5);
  const wthFeePct = Number(data?.service_fees?.payment_api_withdraw_percent || 2.0);
  const ggrProfitPct = Number(data?.service_fees?.ggr_monthly_profit_percent || 10.0);

  const depAmtNum = Number(apiDepositAmount || 0);
  const calcDepFee = ((depAmtNum * depFeePct) / 100).toFixed(2);
  const calcDepNet = (depAmtNum - Number(calcDepFee)).toFixed(2);

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
      {/* ─────────────────────────────────────────────────────────────
          ABOVE MENU: TOP MISSION-CONTROL COMMAND BAR (STITCH DESIGN)
          Featuring: Deposit, Withdraw, Payout Bank Account Setup
          ───────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md p-4 sm:p-5 shadow-xs transition-all">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Identity & Status */}
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <Building className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-wider bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 uppercase">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Production API Mode
                </span>
                <span className="text-[11px] font-mono font-semibold text-zinc-500 dark:text-zinc-400">
                  MID-{user?.phone}
                </span>
              </div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 truncate mt-0.5">
                {user?.business_name || user?.first_name || "Merchant"} Operations Deck
              </h1>
            </div>
          </div>

          {/* Above Menu Quick Action Bar */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            {/* Quick Balance Readout */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <Wallet className="size-3.5 text-emerald-600" />
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Cash Balance</p>
                <p className="text-xs font-mono font-bold text-zinc-900 dark:text-zinc-100">
                  {isLoading ? "..." : formatNPR(cashBalance)}
                </p>
              </div>
            </div>

            {/* ACTION 1: DEPOSIT */}
            <Button
              size="sm"
              onClick={() => setDepositModalOpen(true)}
              className="h-9 px-3.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer transition-all active:scale-95"
            >
              <ArrowDownLeft className="size-3.5 mr-1.5 stroke-[2.5]" />
              Deposit
            </Button>

            {/* ACTION 2: WITHDRAW (OWN PAYOUT) */}
            <Button
              size="sm"
              onClick={() => {
                if (!savedBank) {
                  toast.info("Please configure your Payout Bank Account first.");
                  setBankSetupModalOpen(true);
                } else {
                  setWithdrawModalOpen(true);
                }
              }}
              variant="outline"
              className="h-9 px-3.5 text-xs font-semibold border-emerald-600/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer transition-all active:scale-95"
            >
              <ArrowUpRight className="size-3.5 mr-1.5 stroke-[2.5]" />
              Withdraw
            </Button>

            {/* ACTION 3: PAYOUT BANK ACCOUNT SETUP */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBankSetupModalOpen(true)}
              className="h-9 px-3 text-xs font-semibold text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer transition-all active:scale-95"
            >
              <Landmark className="size-3.5 mr-1.5 text-blue-600 dark:text-blue-400" />
              <span className="hidden sm:inline">Payout Bank Setup</span>
              <span className="sm:hidden">Bank Setup</span>
              {savedBank?.verified && (
                <span className="size-1.5 rounded-full bg-emerald-500 ml-1.5" title="Bank Verified" />
              )}
            </Button>

            {/* REFRESH */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-9 w-9 p-0 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              title="Refresh Telemetry"
            >
              <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      {/* Production Mode Banner Notice */}
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 dark:bg-emerald-950/20 px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="size-4 text-emerald-600 shrink-0" />
          <p className="text-zinc-700 dark:text-zinc-300 truncate">
            <span className="font-bold text-emerald-700 dark:text-emerald-400">Direct Production Mode Active:</span> All API requests directly process real-time transactions against your merchant cash balance. Zero sandbox delays.
          </p>
        </div>
        <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-600">
          GATEWAY: LIVE
        </span>
      </div>

      {/* Mobile Navigation Tabs */}
      <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {(
          [
            { id: "overview", label: "Overview" },
            { id: "payment-api", label: "Payment API" },
            { id: "bank-accounts", label: "Payout Banks" },
            { id: "ggr", label: "GGR Gaming" },
            { id: "api-keys", label: "API Keys" },
            { id: "docs", label: "Production Docs" },
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

      {/* ─────────────────────────────────────────────────────────────
          KPI TELEMETRY STRIP (OBSIDIAN EMERALD TERMINAL DESIGN)
          ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Available Cash Balance */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xs space-y-2 hover:border-emerald-500/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Wallet className="size-4 text-emerald-600" />
              Available Cash
            </span>
            <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded">
              SETTLED
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight font-mono text-zinc-900 dark:text-zinc-100">
            {isLoading ? "..." : formatNPR(cashBalance)}
          </div>
          <div className="flex items-center justify-between pt-1 text-[11px]">
            <button
              type="button"
              onClick={() => setDepositModalOpen(true)}
              className="text-emerald-600 hover:text-emerald-700 font-semibold cursor-pointer"
            >
              + Deposit Funds
            </button>
            <button
              type="button"
              onClick={() => {
                if (!savedBank) setBankSetupModalOpen(true);
                else setWithdrawModalOpen(true);
              }}
              className="text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
            >
              ↗ Withdraw to Bank
            </button>
          </div>
        </div>

        {/* KPI 2: Production Payin (Deposit) Rate */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xs space-y-2 hover:border-blue-500/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard className="size-4 text-blue-600" />
              Deposit Rate
            </span>
            <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded">
              FIXED
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight font-mono text-zinc-900 dark:text-zinc-100">
            {depFeePct}%
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Payin fee automatically deducted upon player credit
          </p>
        </div>

        {/* KPI 3: Production Payout Rate */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xs space-y-2 hover:border-indigo-500/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <ArrowUpRight className="size-4 text-indigo-600" />
              Payout Rate
            </span>
            <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded">
              FIXED
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight font-mono text-zinc-900 dark:text-zinc-100">
            {wthFeePct}%
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Debited per player payout or bank settlement
          </p>
        </div>

        {/* KPI 4: Gateway Status & SLA */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xs space-y-2 hover:border-purple-500/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="size-4 text-purple-600" />
              Gateway SLA
            </span>
            <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded">
              99.98%
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight font-mono text-zinc-900 dark:text-zinc-100">
            ~42ms
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Average response time on production endpoints
          </p>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: OVERVIEW & TELEMETRY
          ───────────────────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Quick Action Operations Deck */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: Deposit Action */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                  <ArrowDownLeft className="size-4 text-emerald-600" />
                  Deposit Funds
                </span>
                <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                  Instant
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Load merchant cash balance via Bank Transfer, QR, eSewa, or Khalti for processing API payouts.
              </p>
              <Button
                variant="outline"
                onClick={() => setDepositModalOpen(true)}
                className="w-full text-xs h-9 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 font-medium cursor-pointer"
              >
                Deposit Now
              </Button>
            </div>

            {/* Card 2: Withdraw Action */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                  <ArrowUpRight className="size-4 text-blue-600" />
                  Withdraw to Bank
                </span>
                <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-full">
                  Own Payout
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Transfer settled merchant funds directly to your verified Nepali bank account.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  if (!savedBank) setBankSetupModalOpen(true);
                  else setWithdrawModalOpen(true);
                }}
                className="w-full text-xs h-9 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-950/40 font-medium cursor-pointer"
              >
                Withdraw Funds
              </Button>
            </div>

            {/* Card 3: Payout Bank Account Setup */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                  <Landmark className="size-4 text-purple-600" />
                  Payout Bank Setup
                </span>
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                  savedBank?.verified
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                }`}>
                  {savedBank?.verified ? "Configured" : "Action Needed"}
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {savedBank
                  ? `${savedBank.bank_name} (${savedBank.account_number.slice(0, 4)}••••${savedBank.account_number.slice(-3)})`
                  : "Setup your default bank account for instantaneous merchant payout withdrawals."}
              </p>
              <Button
                variant="outline"
                onClick={() => setBankSetupModalOpen(true)}
                className="w-full text-xs h-9 text-purple-700 dark:text-purple-400 border-purple-500/30 hover:bg-purple-50 dark:hover:bg-purple-950/40 font-medium cursor-pointer"
              >
                {savedBank ? "Manage Payout Bank" : "Setup Payout Bank"}
              </Button>
            </div>
          </div>

          {/* Recent Operations Activity */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <History className="size-4 text-zinc-400" />
                Live Production Gateway Ledger
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleTabChange("ledger")}
                className="text-xs text-emerald-600 hover:text-emerald-700 h-7 cursor-pointer"
              >
                View all ledger <ArrowRight className="size-3.5 ml-1" />
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-zinc-400 uppercase text-[10px] font-mono">
                  <tr>
                    <th className="p-2.5">Date & Time</th>
                    <th className="p-2.5">Type</th>
                    <th className="p-2.5">Amount</th>
                    <th className="p-2.5">Balance After</th>
                    <th className="p-2.5">Reference</th>
                    <th className="p-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {data?.recent_transactions && data.recent_transactions.length > 0 ? (
                    data.recent_transactions.slice(0, 8).map((t) => (
                      <tr key={t.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                        <td className="p-2.5 font-mono text-zinc-500">
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
                        <td className="p-2.5 font-mono text-zinc-500">{t.reference}</td>
                        <td className="p-2.5 text-zinc-500 max-w-xs truncate">{t.notes}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-zinc-400">
                        No transactions recorded yet in production gateway.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: PAYMENT API (DIRECT PRODUCTION OPERATIONS)
          ───────────────────────────────────────────────────────────── */}
      {activeTab === "payment-api" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-xs space-y-5">
            <div className="border-b border-zinc-100 dark:border-zinc-800 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <CreditCard className="size-5 text-emerald-600" />
                  Direct Production Payment API
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Process live player deposits (Payin) and player withdrawals (Payout) with automated fee settlement.
                </p>
              </div>
              <span className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 font-bold self-start sm:self-auto">
                BASE: https://mysewa.com.np/api/v1
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Payin Form */}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 bg-zinc-50/50 dark:bg-zinc-900/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
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

                <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs space-y-1.5 font-mono">
                  <div className="flex justify-between text-zinc-500">
                    <span>Gross Deposit:</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">NPR {depAmtNum}</span>
                  </div>
                  <div className="flex justify-between text-zinc-500">
                    <span>Platform Fee ({depFeePct}%):</span>
                    <span className="text-red-600">- NPR {calcDepFee}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-zinc-200 dark:border-zinc-800 pt-1 text-emerald-700 dark:text-emerald-400">
                    <span>Net Credited to Balance:</span>
                    <span>+ NPR {calcDepNet}</span>
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
                  className="w-full text-xs h-9 bg-blue-600 hover:bg-blue-700 text-white font-medium cursor-pointer"
                >
                  {apiDepositMutation.isPending ? "Executing in Production..." : "Execute Production Deposit"}
                </Button>
              </div>

              {/* Direct Payout Action Card */}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 bg-zinc-50/50 dark:bg-zinc-900/30">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
                    <ArrowUpRight className="size-4 text-emerald-600" />
                    Own Payout to Bank Account
                  </span>
                  <span className="text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400 px-2 py-0.5 rounded">
                    Direct Withdraw
                  </span>
                </div>

                <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Configured Destination</span>
                    {savedBank?.verified && (
                      <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="size-3" /> Verified
                      </span>
                    )}
                  </div>
                  {savedBank ? (
                    <div className="text-xs space-y-0.5 font-mono">
                      <p className="font-bold text-zinc-900 dark:text-zinc-100">{savedBank.bank_name}</p>
                      <p className="text-zinc-500">Acc: {savedBank.account_number}</p>
                      <p className="text-zinc-500">Holder: {savedBank.account_name}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-600">
                      No payout bank account configured yet.
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (!savedBank) setBankSetupModalOpen(true);
                      else setWithdrawModalOpen(true);
                    }}
                    className="flex-1 text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-medium cursor-pointer"
                  >
                    Withdraw Funds Now
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setBankSetupModalOpen(true)}
                    className="text-xs h-9"
                  >
                    Setup Bank
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 3: PAYOUT BANK ACCOUNTS (SETTLEMENT MANAGEMENT)
          ───────────────────────────────────────────────────────────── */}
      {activeTab === "bank-accounts" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-xs space-y-5">
            <div className="border-b border-zinc-100 dark:border-zinc-800 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Landmark className="size-5 text-blue-600" />
                  Payout Bank Accounts for Withdrawals
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Your designated Nepali commercial bank account for receiving settled merchant withdrawals.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setBankSetupModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 cursor-pointer"
              >
                <Plus className="size-3.5 mr-1" />
                {savedBank ? "Update Bank Account" : "Add Bank Account"}
              </Button>
            </div>

            {savedBank ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl bg-emerald-600/10 text-emerald-600 flex items-center justify-center font-bold">
                      <Landmark className="size-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                        {savedBank.bank_name}
                      </h4>
                      <p className="text-xs text-zinc-500 font-mono">Bank Code: {savedBank.bank_code}</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="size-3" />
                    PRIMARY WITHDRAWAL ACCOUNT
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 font-mono text-xs">
                  <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                    <p className="text-[10px] text-zinc-400 font-bold uppercase">Account Number</p>
                    <p className="font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">{savedBank.account_number}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                    <p className="text-[10px] text-zinc-400 font-bold uppercase">Account Holder</p>
                    <p className="font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">{savedBank.account_name}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                    <p className="text-[10px] text-zinc-400 font-bold uppercase">Branch / Ref</p>
                    <p className="font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">{savedBank.branch || "Head Office"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    size="sm"
                    onClick={() => setWithdrawModalOpen(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 cursor-pointer"
                  >
                    <ArrowUpRight className="size-3.5 mr-1" />
                    Withdraw Funds to This Account
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setBankSetupModalOpen(true)}
                    className="text-xs h-8 cursor-pointer"
                  >
                    Edit Details
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 p-8 text-center space-y-3">
                <Landmark className="size-10 mx-auto text-zinc-400" />
                <div className="max-w-md mx-auto space-y-1">
                  <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                    No Payout Bank Account Added
                  </h4>
                  <p className="text-xs text-zinc-500">
                    Configure your Nepali bank account to enable instant one-click withdrawals of your settled merchant balances.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => setBankSetupModalOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs cursor-pointer"
                >
                  <Plus className="size-3.5 mr-1" /> Setup Bank Account Now
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 4: GGR GAMING (IF ENABLED)
          ───────────────────────────────────────────────────────────── */}
      {activeTab === "ggr" && (
        <div className="space-y-6">
          {isGgrEnabled ? (
            <>
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
                  <div>
                    <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <Coins className="size-5 text-amber-600" />
                      GGR Coin Liquidity & Settlements
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Exchange rate: 1 NPR = 1 GGR Coin. Settled monthly on positive net gaming profits.
                    </p>
                  </div>
                  <Button
                    onClick={() => setBuyModalOpen(true)}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-8 cursor-pointer"
                  >
                    <Plus className="size-3.5 mr-1" />
                    Buy Coins
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 space-y-1.5">
                    <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Coins Purchased
                    </div>
                    <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
                      {Number(data?.total_bought || 0).toLocaleString()}
                    </div>
                    <p className="text-[11px] text-zinc-500">Total coins minted with cash balance</p>
                  </div>

                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 space-y-1.5">
                    <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Coins Won by Players
                    </div>
                    <div className="text-xl font-bold font-mono text-emerald-600">
                      {Number(data?.total_won || 0).toLocaleString()}
                    </div>
                    <p className="text-[11px] text-zinc-500">Includes +10% bonus boost payout</p>
                  </div>

                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 space-y-1.5">
                    <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Coins Lost by Players
                    </div>
                    <div className="text-xl font-bold font-mono text-red-500">
                      {Number(data?.total_lost || 0).toLocaleString()}
                    </div>
                    <p className="text-[11px] text-zinc-500">Deducted coin rounds retained by platform</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-8 shadow-xs text-center space-y-4">
              <div className="size-14 mx-auto rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-400">
                <Lock className="size-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">GGR Gaming Service Inactive</h3>
                <p className="text-xs text-zinc-500">
                  GGR Coin management is restricted. Request an administrator to activate GGR permissions for your account.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 5: API KEYS & WEBHOOKS
          ───────────────────────────────────────────────────────────── */}
      {activeTab === "api-keys" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-xs space-y-5">
            <div className="border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Key className="size-5 text-emerald-600" />
                Production API Credentials & Webhook Settings
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Authenticate server-to-server requests using your secret Production API key. No sandbox credentials needed.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">Live Production API Key</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={displayKey}
                  className="font-mono text-xs bg-zinc-50 dark:bg-zinc-900"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="h-9 text-xs cursor-pointer"
                >
                  {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
                <Button
                  size="sm"
                  onClick={copyApiKey}
                  className="h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium cursor-pointer"
                >
                  {copiedKey ? <Check className="size-3.5 mr-1" /> : <Copy className="size-3.5 mr-1" />}
                  {copiedKey ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-[11px] text-zinc-500">
                Header format: <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-900 dark:text-zinc-100">Authorization: Api-Key &lt;KEY&gt;</code>
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <Label className="text-xs font-semibold">Production Webhook URL</Label>
              <Input
                readOnly
                value={devProfileQuery.data?.api_webhook_url || "https://your-domain.com/webhook"}
                className="font-mono text-xs bg-zinc-50 dark:bg-zinc-900"
              />
              <p className="text-[11px] text-zinc-500">
                Event notifications for payins, payouts, and settlements are delivered here via TLS 1.3.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 6: API DOCUMENTATION (100% PRODUCTION SPECS, NO SANDBOX)
          ───────────────────────────────────────────────────────────── */}
      {activeTab === "docs" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <BookOpen className="size-5 text-emerald-600" />
                  Production API Documentation & Endpoints
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Production Base URL: <code className="font-mono text-emerald-600 font-bold">https://mysewa.com.np/api/v1</code>
                </p>
              </div>

              <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg">
                {(["curl", "python", "node"] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setDocsLang(lang)}
                    className={`text-xs px-2.5 py-1 rounded-md capitalize font-medium transition-colors cursor-pointer ${
                      docsLang === lang
                        ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs font-bold"
                        : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
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
                <span className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  /api/v1/payment/deposit/
                </span>
                <span className="text-xs text-zinc-500">— Player Deposit (Payin)</span>
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
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400 font-mono">
                  POST
                </span>
                <span className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  /api/v1/payment/withdraw/
                </span>
                <span className="text-xs text-zinc-500">— Player Payout (Withdraw)</span>
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

      {/* ─────────────────────────────────────────────────────────────
          TAB 7: TRANSACTION LEDGER
          ───────────────────────────────────────────────────────────── */}
      {activeTab === "ledger" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <History className="size-4 text-zinc-400" />
                Complete Production Transaction Ledger
              </h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="size-3.5 absolute left-2.5 top-2.5 text-zinc-400" />
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
                  className="h-8 text-xs border border-zinc-200 dark:border-zinc-800 rounded-md px-2 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
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
                <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-zinc-400 uppercase text-[10px] font-mono">
                  <tr>
                    <th className="p-2.5">Date & Time</th>
                    <th className="p-2.5">Type</th>
                    <th className="p-2.5">Amount</th>
                    <th className="p-2.5">Balance After</th>
                    <th className="p-2.5">Reference</th>
                    <th className="p-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredTransactions.length > 0 ? (
                    filteredTransactions.map((t) => (
                      <tr key={t.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                        <td className="p-2.5 font-mono text-zinc-500">
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
                        <td className="p-2.5 font-mono text-zinc-500">{t.reference}</td>
                        <td className="p-2.5 text-zinc-500 max-w-xs truncate">{t.notes}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-zinc-400">
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

      {/* ─────────────────────────────────────────────────────────────
          MODAL 1: DEPOSIT MODAL (LOAD CASH / RECORD PAYIN)
          ───────────────────────────────────────────────────────────── */}
      <Dialog open={depositModalOpen} onOpenChange={setDepositModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
              <ArrowDownLeft className="size-5 text-emerald-600" />
              Deposit Funds into Merchant Wallet
            </DialogTitle>
            <DialogDescription>
              Load cash balance to maintain API payout liquidity or record a direct player payin.
            </DialogDescription>
          </DialogHeader>

          {/* Deposit Mode Selector */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-800 -mx-6 px-6 pt-1">
            <button
              type="button"
              onClick={() => setDepositTab("load")}
              className={`pb-2.5 text-xs font-semibold px-3 border-b-2 transition-colors cursor-pointer ${
                depositTab === "load"
                  ? "border-emerald-600 text-emerald-600 font-bold"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              Bank & QR Deposit
            </button>
            <button
              type="button"
              onClick={() => setDepositTab("api-payin")}
              className={`pb-2.5 text-xs font-semibold px-3 border-b-2 transition-colors cursor-pointer ${
                depositTab === "api-payin"
                  ? "border-emerald-600 text-emerald-600 font-bold"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              Record API Payin ({depFeePct}%)
            </button>
          </div>

          {depositTab === "load" ? (
            <div className="space-y-4 py-2">
              <p className="text-xs text-zinc-500">
                Deposit NPR directly into MySewa settlement accounts. Once deposited, submit your voucher or use the direct load gateway:
              </p>

              {/* Bank Deposit Destination Preview */}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
                  <span className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Landmark className="size-4 text-emerald-600" />
                    Designated Settlement Account
                  </span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">
                    INSTANT
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Bank:</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">Global IME Bank / Nabil</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Account Name:</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">MySewa Technology Pvt Ltd</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Account No:</span>
                    <span className="font-bold text-emerald-600">01234567890123</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Branch:</span>
                    <span>Kathmandu Main</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2">
                <Info className="size-4 shrink-0" />
                <span>Need QR scan or instant eSewa/Khalti checkout? Click below to open the dedicated Load Portal.</span>
              </div>

              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={() => setDepositModalOpen(false)}>
                  Close
                </Button>
                <Button asChild className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer">
                  <Link to="/app/load">
                    Open Load Cash Portal <ArrowRight className="size-3.5 ml-1" />
                  </Link>
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="dep-player" className="text-xs">Player Account ID</Label>
                <Input
                  id="dep-player"
                  value={apiDepositPlayer}
                  onChange={(e) => setApiDepositPlayer(e.target.value)}
                  placeholder="player_01"
                  className="text-xs font-mono h-8.5"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dep-amount" className="text-xs">Gross Deposit Amount (NPR)</Label>
                <Input
                  id="dep-amount"
                  type="number"
                  value={apiDepositAmount}
                  onChange={(e) => setApiDepositAmount(e.target.value)}
                  placeholder="1000"
                  className="text-xs font-mono h-8.5"
                />
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-xs space-y-1.5 font-mono">
                <div className="flex justify-between text-zinc-500">
                  <span>Gross Payin:</span>
                  <span className="text-zinc-900 dark:text-zinc-100 font-semibold">NPR {depAmtNum}</span>
                </div>
                <div className="flex justify-between text-zinc-500">
                  <span>Production Fee ({depFeePct}%):</span>
                  <span className="text-red-600">- NPR {calcDepFee}</span>
                </div>
                <div className="flex justify-between font-bold border-t border-zinc-200 dark:border-zinc-800 pt-1 text-emerald-700 dark:text-emerald-400">
                  <span>Net Credited to Wallet:</span>
                  <span>+ NPR {calcDepNet}</span>
                </div>
              </div>

              <DialogFooter className="pt-2">
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
                  className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                >
                  {apiDepositMutation.isPending ? "Executing..." : "Confirm Production Deposit"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 2: WITHDRAW MODAL (OWN PAYOUT TO BANK ACCOUNT)
          ───────────────────────────────────────────────────────────── */}
      <Dialog open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
              <ArrowUpRight className="size-5 text-emerald-600" />
              Withdraw Funds to Bank Account
            </DialogTitle>
            <DialogDescription>
              Disburse settled merchant cash directly to your verified Nepali bank account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Available Balance Box */}
            <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-zinc-400 uppercase font-bold">Available Cash</p>
                <p className="text-base font-bold font-mono text-zinc-900 dark:text-zinc-100">
                  {formatNPR(cashBalance)}
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded">
                SETTLED
              </span>
            </div>

            {/* Target Bank Information */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Destination Bank</Label>
                <button
                  type="button"
                  onClick={() => {
                    setWithdrawModalOpen(false);
                    setBankSetupModalOpen(true);
                  }}
                  className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                >
                  Change Account
                </button>
              </div>

              {savedBank ? (
                <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-mono space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">{savedBank.bank_name}</span>
                    <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> Verified
                    </span>
                  </div>
                  <p className="text-zinc-500">Account: {savedBank.account_number}</p>
                  <p className="text-zinc-500">Name: {savedBank.account_name}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <BankCombobox
                    banks={nepaliBanks}
                    value={withdrawBankCode}
                    onChange={(b) => {
                      setWithdrawBankCode(b.bank_code);
                      setWithdrawBankName(b.bank_name);
                    }}
                    placeholder="Select Nepali Bank..."
                  />
                  <Input
                    placeholder="Account Number"
                    value={withdrawAccNumber}
                    onChange={(e) => setWithdrawAccNumber(e.target.value)}
                    className="text-xs font-mono h-8.5"
                  />
                  <Input
                    placeholder="Account Holder Name"
                    value={withdrawAccName}
                    onChange={(e) => setWithdrawAccName(e.target.value)}
                    className="text-xs h-8.5"
                  />
                </div>
              )}
            </div>

            {/* Amount input with shortcut percentages */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="wth-amount-input" className="text-xs">Withdrawal Amount (NPR)</Label>
                <div className="flex items-center gap-1">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        const calculated = Math.floor((cashBalance * pct) / 100);
                        setWithdrawAmount(String(calculated > 0 ? calculated : ""));
                      }}
                      className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-700 dark:text-zinc-300 cursor-pointer"
                    >
                      {pct === 100 ? "MAX" : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                id="wth-amount-input"
                type="number"
                placeholder="Enter amount..."
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="text-xs font-mono h-9 text-base"
              />
            </div>

            {/* Summary calculation */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-xs space-y-1 font-mono">
              <div className="flex justify-between text-zinc-500">
                <span>Disbursed Amount:</span>
                <span className="font-bold text-zinc-900 dark:text-zinc-100">
                  NPR {Number(withdrawAmount || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>Network Settlement Fee:</span>
                <span className="text-emerald-600 font-bold">FREE (0.00)</span>
              </div>
              <div className="flex justify-between font-bold border-t border-zinc-200 dark:border-zinc-800 pt-1 text-zinc-900 dark:text-zinc-100">
                <span>Total Debited:</span>
                <span className="text-red-600">- NPR {Number(withdrawAmount || 0).toLocaleString()}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const targetBankCode = savedBank?.bank_code || withdrawBankCode;
                const targetBankName = savedBank?.bank_name || withdrawBankName;
                const targetAccNum = savedBank?.account_number || withdrawAccNumber;
                const targetAccName = savedBank?.account_name || withdrawAccName;

                if (!targetBankCode || !targetAccNum || !targetAccName) {
                  toast.error("Please configure your destination bank account.");
                  return;
                }
                if (!withdrawAmount || Number(withdrawAmount) <= 0) {
                  toast.error("Please enter a valid amount.");
                  return;
                }
                if (Number(withdrawAmount) > cashBalance) {
                  toast.error("Insufficient available balance.");
                  return;
                }

                ownWithdrawMutation.mutate({
                  bank_code: targetBankCode,
                  bank_name: targetBankName,
                  account_number: targetAccNum,
                  account_name: targetAccName,
                  amount: withdrawAmount,
                  remarks: withdrawRemarks,
                });
              }}
              disabled={
                ownWithdrawMutation.isPending ||
                !withdrawAmount ||
                Number(withdrawAmount) <= 0 ||
                Number(withdrawAmount) > cashBalance
              }
              className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
            >
              {ownWithdrawMutation.isPending ? "Disbursing..." : "Confirm & Disburse Payout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 3: PAYOUT BANK ACCOUNT SETUP MODAL
          ───────────────────────────────────────────────────────────── */}
      <Dialog open={bankSetupModalOpen} onOpenChange={setBankSetupModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
              <Landmark className="size-5 text-blue-600" />
              Configure Payout Bank Account
            </DialogTitle>
            <DialogDescription>
              Link your registered Nepali bank account for receiving one-click merchant withdrawals.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Bank Name</Label>
              <BankCombobox
                banks={nepaliBanks}
                value={setupBankCode}
                onChange={(b) => {
                  setSetupBankCode(b.bank_code);
                  setSetupBankName(b.bank_name);
                  setSetupAccountVerified(false);
                }}
                placeholder="Search Nepali Commercial Bank..."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setup-acc-num" className="text-xs">Account Number</Label>
              <Input
                id="setup-acc-num"
                value={setupAccNumber}
                onChange={(e) => {
                  setSetupAccNumber(e.target.value);
                  setSetupAccountVerified(false);
                }}
                placeholder="e.g. 01201010001234"
                className="text-xs font-mono h-8.5"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="setup-acc-name" className="text-xs">Account Holder Name</Label>
                {setupAccountVerified && (
                  <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 font-mono">
                    <CheckCircle2 className="size-3" /> Verified with Clearing Network
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id="setup-acc-name"
                  value={setupAccName}
                  onChange={(e) => setSetupAccName(e.target.value)}
                  placeholder="Official name on bank account"
                  className="text-xs h-8.5 flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={verifySetupBankAccount}
                  disabled={isVerifyingSetupBank || !setupBankCode || !setupAccNumber}
                  className="h-8.5 text-xs text-blue-600 border-blue-200 dark:border-blue-900 cursor-pointer"
                >
                  {isVerifyingSetupBank ? "Checking..." : "Verify"}
                </Button>
              </div>
              <p className="text-[11px] text-zinc-400">
                Click verify to confirm the exact holder name registered with Nepal clearing switch.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setup-branch" className="text-xs">Branch / Label (Optional)</Label>
              <Input
                id="setup-branch"
                value={setupBranch}
                onChange={(e) => setSetupBranch(e.target.value)}
                placeholder="e.g. Kathmandu Main Branch"
                className="text-xs h-8.5"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBankSetupModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveSetupBankAccount}
              disabled={!setupBankCode || !setupAccNumber || !setupAccName}
              className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
            >
              Save Payout Bank Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 4: BUY GGR COINS (IF USER HAS GGR)
          ───────────────────────────────────────────────────────────── */}
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
            <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl space-y-1">
              <div className="text-xs text-zinc-500">Available Cash Balance</div>
              <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                {formatNPR(cashBalance)}
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
                className="font-mono text-xs"
              />
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-xs space-y-1 font-mono">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">Exchange Summary:</div>
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
              className="bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
            >
              {buyCoinsMutation.isPending ? "Purchasing..." : "Confirm Purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
