import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Coins,
  TrendingUp,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Wallet,
  Building,
  Users,
  Calendar,
  Sliders,
  History,
  Landmark,
  ArrowRight,
  DollarSign,
  AlertCircle,
  Trash2,
  Check,
  CheckCircle2,
  Star,
  Plus,
  KeyRound,
  Gamepad2,
} from "lucide-react";

const NEPAL_BANKS = [
  "Nabil Bank",
  "Global IME Bank",
  "NIC Asia Bank",
  "Nepal Investment Mega Bank (NIMB)",
  "Sanima Bank",
  "Everest Bank",
  "Siddhartha Bank",
  "Prabhu Bank",
  "Himalayan Bank",
  "Standard Chartered Bank Nepal",
  "Rastriya Banijya Bank",
  "Nepal Bank Limited",
  "Agricultural Development Bank",
  "Kumari Bank",
  "Laxmi Sunrise Bank",
  "Prime Commercial Bank",
  "Citizens Bank International",
  "Machhapuchchhre Bank",
  "NMB Bank",
];
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  // Saved Payout Accounts State
  const [selectedPayoutAccountId, setSelectedPayoutAccountId] = useState<string>("manual");
  const [saveAccountForFuture, setSaveAccountForFuture] = useState(true);
  const [customAccountLabel, setCustomAccountLabel] = useState("");
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);
  const [newAccountMethod, setNewAccountMethod] = useState<"bank" | "esewa" | "khalti">("bank");
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountNumber, setNewAccountNumber] = useState("");
  const [newBankName, setNewBankName] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [newIsDefault, setNewIsDefault] = useState(true);

  // Fee Config Modal State
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [ggrPercent, setGgrPercent] = useState("10.00");
  const [depPercent, setDepPercent] = useState("2.50");
  const [wthPercent, setWthPercent] = useState("3.00");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["shareholder-dashboard"],
    queryFn: () => apiClient.getShareholderDashboard(),
  });

  const defaultPayoutAccount = useMemo(() => {
    const list = data?.payout_accounts || [];
    return list.find((a) => a.is_default) || (list.length > 0 ? list[0] : null);
  }, [data?.payout_accounts]);

  const openWithdrawModal = (presetAccountId?: string) => {
    const accounts = data?.payout_accounts || [];
    const targetId =
      presetAccountId ||
      (defaultPayoutAccount
        ? String(defaultPayoutAccount.id)
        : accounts.length > 0
        ? String(accounts[0].id)
        : "manual");
    setSelectedPayoutAccountId(targetId);
    if (targetId !== "manual") {
      const acc = accounts.find((a) => String(a.id) === targetId);
      if (acc) {
        setPayoutMethod(acc.method);
        setAccountName(acc.account_name);
        setAccountNumber(acc.account_number);
        setBankName(acc.bank_name || "");
      }
    }
    setWithdrawModalOpen(true);
  };

  const handlePercentageWithdraw = (pct: number) => {
    const balance = Number(data?.my_wallet?.balance || 0);
    if (balance <= 0) return;
    const amt = Math.floor((balance * pct) / 100);
    setWithdrawAmount(String(amt));
  };

  const [txnServiceFilter, setTxnServiceFilter] = useState<"all" | "payin" | "payout" | "ggr">("all");

  const filteredApiTxns = useMemo(() => {
    const list = data?.developer_api_transactions || [];
    if (txnServiceFilter === "all") return list;
    return list.filter((t) => t.service === txnServiceFilter);
  }, [data?.developer_api_transactions, txnServiceFilter]);

  const withdrawMutation = useMutation({
    mutationFn: () => {
      const isSaved = selectedPayoutAccountId && selectedPayoutAccountId !== "manual";
      return apiClient.shareholderWithdraw({
        amount: withdrawAmount,
        payout_account_id: isSaved ? Number(selectedPayoutAccountId) : undefined,
        payout_method: isSaved ? undefined : payoutMethod,
        account_name: isSaved ? undefined : accountName,
        account_number: isSaved ? undefined : accountNumber,
        bank_name: !isSaved && payoutMethod === "bank" ? bankName : undefined,
        save_account: !isSaved ? saveAccountForFuture : undefined,
        account_label: !isSaved && saveAccountForFuture ? customAccountLabel : undefined,
      });
    },
    onSuccess: (res) => {
      toast.success(res.message);
      setWithdrawModalOpen(false);
      setWithdrawAmount("");
      setAccountName("");
      setAccountNumber("");
      setBankName("");
      setCustomAccountLabel("");
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Withdrawal failed.");
    },
  });

  const setDefaultAccountMutation = useMutation({
    mutationFn: (id: number) => apiClient.setDefaultShareholderPayoutAccount(id),
    onSuccess: (res) => {
      toast.success(res.message || "Default payout account updated.");
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update default account.");
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: () =>
      apiClient.createShareholderPayoutAccount({
        method: newAccountMethod,
        label: newAccountLabel,
        account_name: newAccountName,
        account_number: newAccountNumber,
        bank_name: newAccountMethod === "bank" ? newBankName : undefined,
        branch: newAccountMethod === "bank" ? newBranch : undefined,
        is_default: newIsDefault,
      }),
    onSuccess: (res) => {
      toast.success(res.message || "Payout account added.");
      setAddAccountModalOpen(false);
      setNewAccountLabel("");
      setNewAccountName("");
      setNewAccountNumber("");
      setNewBankName("");
      setNewBranch("");
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to add payout account.");
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteShareholderPayoutAccount(id),
    onSuccess: (res) => {
      toast.success(res.message || "Payout account deleted.");
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to delete account.");
    },
  });

  const syncRevenueMutation = useMutation({
    mutationFn: () => apiClient.syncHistoricalRevenue(),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to sync historical revenue.");
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
      toast.success(res.message);
      setConfigModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update fee configuration.");
    },
  });

  const settleMutation = useMutation({
    mutationFn: () => apiClient.triggerGgrMonthlySettlement(),
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
      title="Shareholder Revenue & Governance"
      description="Automated equity cap table, profit dividends, and fee settlements"
    >
      <div className="space-y-5 pb-10">
        {/* Modern Classic Clean White Header Banner */}
        <div className="rounded-md border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500 font-mono">
                  Governance & Dividends
                </span>
                <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded-xs border border-slate-200 font-medium">
                  Source: Developer API Partners Only (GGR, Pay In, Pay Out)
                </span>
                {data?.is_shareholder && (
                  <span className="text-[10px] bg-amber-50 text-amber-800 px-1.5 py-0.2 rounded-xs border border-amber-200 font-bold">
                    {data.my_wallet?.share_percent || "0"}% Partner
                  </span>
                )}
                {user?.is_superuser && (
                  <span className="text-[10px] bg-purple-50 text-purple-800 px-1.5 py-0.2 rounded-xs border border-purple-200 font-bold">
                    Super Admin
                  </span>
                )}
              </div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                <Building className="h-5 w-5 text-emerald-600 shrink-0" />
                Equity Revenue & Settlements
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatic dividend allocations from 10% monthly GGR profits and Payment API transaction fees.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className="h-8 rounded-sm text-xs border-slate-200 bg-white hover:bg-slate-50"
              >
                <RefreshCw className={`h-3 w-3 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={openConfigDialog}
                className="h-8 rounded-sm text-xs border-slate-200 bg-white hover:bg-slate-50 text-amber-800"
              >
                <Sliders className="h-3 w-3 mr-1.5 text-amber-600" />
                Rates
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => syncRevenueMutation.mutate()}
                disabled={syncRevenueMutation.isPending}
                className="h-8 rounded-sm text-xs border-slate-200 bg-white hover:bg-slate-50 text-teal-800"
              >
                <RefreshCw className={`h-3 w-3 mr-1.5 text-teal-600 ${syncRevenueMutation.isPending ? "animate-spin" : ""}`} />
                {syncRevenueMutation.isPending ? "Syncing..." : "Sync Earnings"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => settleMutation.mutate()}
                disabled={settleMutation.isPending}
                className="h-8 rounded-sm text-xs border-slate-200 bg-white hover:bg-slate-50 text-blue-800"
              >
                <Calendar className="h-3 w-3 mr-1.5 text-blue-600" />
                {settleMutation.isPending ? "Settling..." : "Settle Month"}
              </Button>

              {data?.is_shareholder && (
                <Button
                  size="sm"
                  onClick={() => openWithdrawModal()}
                  className="h-8 rounded-sm text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-2xs"
                >
                  <Landmark className="h-3 w-3 mr-1.5" />
                  Withdraw Anytime
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Top 4 KPI Metrics in Crisp White Theme */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 text-amber-500" />
                Platform Fee Pool
              </span>
              <span className="text-[10px] font-mono font-bold text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded-xs">
                TOTAL
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.total_platform_revenue || 0))}
            </div>
            <p className="text-[10px] text-slate-400">Total fees collected across platform</p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                GGR Profit Cut
              </span>
              <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded-xs border border-emerald-200/60">
                {data?.service_fee_config?.ggr_monthly_profit_percent || 10}%
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-emerald-600 font-mono tabular-nums">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.ggr_revenue || 0))}
            </div>
            <p className="text-[10px] text-slate-400">10% cut on monthly operator profit</p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <ArrowDownLeft className="h-3.5 w-3.5 text-blue-600" />
                Deposit API Cut
              </span>
              <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded-xs border border-blue-200/60">
                {data?.service_fee_config?.payment_api_deposit_percent || 2.5}%
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-blue-600 font-mono tabular-nums">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.api_deposit_revenue || 0))}
            </div>
            <p className="text-[10px] text-slate-400">Per merchant player payin</p>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <ArrowUpRight className="h-3.5 w-3.5 text-indigo-600" />
                Payout API Cut
              </span>
              <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded-xs border border-indigo-200/60">
                {data?.service_fee_config?.payment_api_withdraw_percent || 3.0}%
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-indigo-600 font-mono tabular-nums">
              {isLoading ? "..." : formatNPR(Number(data?.totals?.api_withdraw_revenue || 0))}
            </div>
            <p className="text-[10px] text-slate-400">Per player payout debit</p>
          </div>
        </div>

        {/* Shareholder Equity Balance Card */}
        {data?.is_shareholder && (
          <div className="rounded-md border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs border-l-4 border-l-emerald-600">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5 text-emerald-600" />
                  Withdrawable Equity Balance
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tabular-nums">
                  {formatNPR(Number(data?.my_wallet?.balance || 0))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 pt-0.5">
                  <span>Earned: <strong className="text-slate-900 font-mono tabular-nums">{formatNPR(Number(data?.my_wallet?.total_earned || 0))}</strong></span>
                  <span>•</span>
                  <span>Withdrawn: <strong className="text-slate-900 font-mono tabular-nums">{formatNPR(Number(data?.my_wallet?.total_withdrawn || 0))}</strong></span>
                  <span>•</span>
                  <span>Equity: <strong className="text-emerald-700 font-mono">{data?.my_wallet?.share_percent}%</strong></span>
                </div>

                {defaultPayoutAccount ? (
                  <div className="text-xs text-slate-600 pt-1 flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <span>
                      Primary Payout:{" "}
                      <strong className="text-slate-900">
                        {defaultPayoutAccount.bank_name || defaultPayoutAccount.method.toUpperCase()}
                      </strong>{" "}
                      <span className="font-mono text-slate-700">({defaultPayoutAccount.account_number})</span> — {defaultPayoutAccount.account_name}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-amber-700 pt-1 flex items-center gap-1.5 font-medium">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span>No payout account linked yet.</span>
                    <button
                      type="button"
                      onClick={() => setAddAccountModalOpen(true)}
                      className="underline font-bold hover:text-amber-900 ml-1"
                    >
                      Add Account Now
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 self-start md:self-auto">
                <Button
                  onClick={() => openWithdrawModal()}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 h-9 rounded-sm shadow-2xs text-xs"
                >
                  <Landmark className="h-3.5 w-3.5 mr-1.5" />
                  Withdraw Anytime
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddAccountModalOpen(true)}
                  className="h-9 rounded-sm text-xs border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Account
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Tabs: API Partners, API Transactions, Stream, Cap Table, Payout Accounts */}
        <Tabs defaultValue="api-partners" className="space-y-3">
          <TabsList className="grid grid-cols-2 sm:grid-cols-5 w-full bg-slate-100 p-1 rounded-md border border-slate-200">
            <TabsTrigger value="api-partners" className="text-xs font-semibold gap-1.5">
              <Building className="h-3.5 w-3.5 text-emerald-600" />
              API Partners ({data?.developer_api_partners?.length || data?.totals?.api_partners_count || 0})
            </TabsTrigger>
            <TabsTrigger value="api-transactions" className="text-xs font-semibold gap-1.5">
              <History className="h-3.5 w-3.5 text-blue-600" />
              API Transactions
            </TabsTrigger>
            <TabsTrigger value="audit-stream" className="text-xs font-semibold gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
              Dividend Ledger
            </TabsTrigger>
            <TabsTrigger value="shareholders" className="text-xs font-semibold gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Cap Table ({data?.shareholders?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="payout-accounts" className="text-xs font-semibold gap-1.5">
              <Landmark className="h-3.5 w-3.5" />
              Accounts ({data?.payout_accounts?.length || 0})
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: DEVELOPER API PARTNERS (Primary Shareholder Revenue Source) */}
          <TabsContent value="api-partners" className="rounded-md border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                  <Building className="h-4 w-4 text-emerald-600" />
                  Developer API Partners (Platform Revenue Source)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Shareholder dividends are generated exclusively from Developer API Partners utilizing GGR Gaming, Pay In, and Pay Out services.
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="text-xs rounded-sm h-8 border-slate-200 bg-white hover:bg-slate-50">
                <Link to="/admin/api-users">
                  <KeyRound className="size-3 mr-1" />
                  View All API Partners
                </Link>
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>API Partner / Business</TableHead>
                  <TableHead>Active Services</TableHead>
                  <TableHead>Pay In Volume</TableHead>
                  <TableHead>Pay Out Volume</TableHead>
                  <TableHead>GGR Balance</TableHead>
                  <TableHead>Business KYC</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.developer_api_partners && data.developer_api_partners.length > 0 ? (
                  data.developer_api_partners.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <Building className="h-3.5 w-3.5 text-slate-500" />
                          <span>{p.business_name || p.phone}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {p.phone} · {[p.first_name, p.last_name].filter(Boolean).join(" ") || "No name"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={`px-1.5 py-0.2 rounded-xs text-[10px] font-bold border ${
                              p.services.ggr ? "bg-amber-50 text-amber-800 border-amber-300" : "bg-slate-100 text-slate-400 border-slate-200"
                            }`}
                          >
                            GGR
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded-xs text-[10px] font-bold border ${
                              p.services.payin ? "bg-blue-50 text-blue-800 border-blue-300" : "bg-slate-100 text-slate-400 border-slate-200"
                            }`}
                          >
                            Pay In
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded-xs text-[10px] font-bold border ${
                              p.services.payout ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-slate-100 text-slate-400 border-slate-200"
                            }`}
                          >
                            Pay Out
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-blue-700 font-semibold">
                        {formatNPR(Number(p.payin_volume || 0))}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-emerald-700 font-semibold">
                        {formatNPR(Number(p.payout_volume || 0))}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-amber-700 font-semibold">
                        {formatNPR(Number(p.ggr_balance || 0))}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="space-y-0.5">
                          {p.pan_no ? (
                            <span className="font-mono text-[10px] bg-slate-100 px-1 py-0.2 rounded-xs border border-slate-200">
                              PAN: {p.pan_no}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[10px]">No PAN</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-[11px] rounded-sm border-slate-200 hover:bg-slate-50">
                          <Link to="/admin/api-users/$userId" params={{ userId: String(p.id) }}>
                            Partner Details
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                      No Developer API Partners active yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TabsContent>

          {/* TAB 2: DEVELOPER API TRANSACTIONS */}
          <TabsContent value="api-transactions" className="rounded-md border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                  <History className="h-4 w-4 text-blue-600" />
                  Developer API Partner Transactions Feed
                </h3>
                <p className="text-[11px] text-slate-500">
                  Transaction volume generated by API Partners (Pay In, Pay Out, and GGR Game events) with platform cuts.
                </p>
              </div>

              <div className="flex items-center gap-1">
                {(
                  [
                    { id: "all", label: "All Services" },
                    { id: "payin", label: "Pay In" },
                    { id: "payout", label: "Pay Out" },
                    { id: "ggr", label: "GGR Coin" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTxnServiceFilter(tab.id)}
                    className={`rounded-xs px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                      txnServiceFilter === tab.id
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>API Partner</TableHead>
                  <TableHead>Reference / Order</TableHead>
                  <TableHead>Txn Volume</TableHead>
                  <TableHead>Shareholder Cut</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredApiTxns.length > 0 ? (
                  filteredApiTxns.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-slate-500 text-xs">
                        {formatDateTime(t.created_at)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`px-1.5 py-0.2 rounded-xs text-[10px] font-bold border ${
                            t.service === "ggr"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : t.service === "payin"
                              ? "bg-blue-50 text-blue-800 border-blue-200"
                              : "bg-emerald-50 text-emerald-800 border-emerald-200"
                          }`}
                        >
                          {t.service_label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-slate-900 text-xs">{t.partner_business}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{t.partner_phone}</div>
                      </TableCell>
                      <TableCell className="font-mono text-slate-600 text-xs">{t.reference}</TableCell>
                      <TableCell className="font-mono text-xs font-bold text-slate-900">
                        {formatNPR(Number(t.amount))}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold text-emerald-700">
                        +{formatNPR(Number(t.fee_cut))}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`px-1.5 py-0.2 rounded-xs text-[10px] font-bold border ${
                            t.status.toLowerCase() === "success" || t.status.toLowerCase() === "completed"
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : "bg-slate-100 text-slate-500 border-slate-200"
                          }`}
                        >
                          {t.status.toUpperCase()}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                      No Developer API Partner transactions found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TabsContent>

          {/* TAB 3: CAP TABLE */}
          <TabsContent value="shareholders" className="rounded-md border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-emerald-600" />
                  Equity Partners (Cap Table)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Accounts configured with Shareholder role. Fee allocations divide automatically by equity %.
                </p>
              </div>
              {user?.is_superuser && (
                <Button asChild size="sm" variant="outline" className="text-xs rounded-sm h-8 border-slate-200 bg-white hover:bg-slate-50 self-start sm:self-auto">
                  <Link to="/admin/users">
                    <Plus className="size-3 mr-1" />
                    Add Partner
                  </Link>
                </Button>
              )}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Share %</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Total Earned</TableHead>
                  <TableHead>Withdrawn</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.shareholders && data.shareholders.length > 0 ? (
                  data.shareholders.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-semibold text-slate-900">
                        {s.first_name || s.last_name ? `${s.first_name} ${s.last_name}` : "Shareholder Partner"}
                        {s.id === user?.id && (
                          <span className="ml-2 px-1.5 py-0.2 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] rounded-xs font-bold">
                            YOU
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-slate-600">{s.phone}</TableCell>
                      <TableCell className="font-mono font-bold text-amber-700">
                        {s.share_percent}%
                      </TableCell>
                      <TableCell className="font-mono font-bold text-emerald-700">
                        {formatNPR(Number(s.balance))}
                      </TableCell>
                      <TableCell className="font-mono text-slate-600">{formatNPR(Number(s.total_earned))}</TableCell>
                      <TableCell className="font-mono text-slate-400">{formatNPR(Number(s.total_withdrawn))}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-[11px] rounded-sm border-slate-200 hover:bg-slate-50">
                          <Link to="/admin/users/$userId" params={{ userId: String(s.id) }}>
                            View
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                      No shareholder partners configured.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TabsContent>

          {/* TAB 2: PAYOUT ACCOUNTS */}
          <TabsContent value="payout-accounts" className="rounded-md border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                  <Landmark className="h-4 w-4 text-emerald-600" />
                  Receiving Accounts
                </h3>
                <p className="text-[11px] text-slate-500">
                  Bank accounts and mobile wallets configured for dividend withdrawals.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setAddAccountModalOpen(true)}
                className="text-xs rounded-sm h-8 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold self-start sm:self-auto"
              >
                <Plus className="size-3 mr-1" />
                Add Account
              </Button>
            </div>

            {(!data?.payout_accounts || data.payout_accounts.length === 0) ? (
              <div className="text-center py-10 border border-dashed border-slate-200 rounded-md bg-slate-50/50">
                <Landmark className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <h4 className="text-xs font-semibold text-slate-800">No Payout Accounts Linked</h4>
                <p className="text-[11px] text-slate-500 mt-0.5 max-w-sm mx-auto">
                  Add your commercial bank account or digital wallet to withdraw dividends.
                </p>
                <Button
                  size="sm"
                  onClick={() => setAddAccountModalOpen(true)}
                  className="mt-3 text-xs rounded-sm h-7 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                >
                  <Plus className="size-3 mr-1" />
                  Add Now
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.payout_accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="p-3.5 rounded-md border border-slate-200 bg-white shadow-2xs flex flex-col justify-between space-y-2.5"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className={`inline-flex items-center px-1.5 py-0.2 rounded-xs text-[10px] font-bold uppercase tracking-wider ${
                          acc.method === "bank"
                            ? "bg-blue-50 text-blue-800 border border-blue-200"
                            : acc.method === "esewa"
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-purple-50 text-purple-800 border border-purple-200"
                        }`}>
                          {acc.method === "bank" ? "Bank" : acc.method.toUpperCase()}
                        </span>
                        {acc.is_default && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded-xs border border-amber-200">
                            <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
                            Default
                          </span>
                        )}
                      </div>

                      <div className="font-bold text-xs text-slate-900">
                        {acc.label || acc.account_name}
                      </div>

                      <div className="text-[11px] text-slate-500 font-mono mt-1">
                        Acc: <span className="font-semibold text-slate-800">{acc.account_number}</span>
                      </div>

                      {acc.bank_name && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Bank: <span className="text-slate-800">{acc.bank_name}</span> {acc.branch && `(${acc.branch})`}
                        </div>
                      )}
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Name: <span className="text-slate-800">{acc.account_name}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openWithdrawModal(String(acc.id))}
                        className="h-7 text-xs rounded-sm text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 px-2 font-semibold"
                      >
                        <Landmark className="h-3 w-3 mr-1" />
                        Withdraw Here
                      </Button>

                      <div className="flex items-center gap-1">
                        {!acc.is_default && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDefaultAccountMutation.mutate(acc.id)}
                            disabled={setDefaultAccountMutation.isPending}
                            className="h-7 text-[11px] rounded-sm text-slate-600 hover:text-amber-800 hover:bg-amber-50 px-2"
                            title="Set as Default Payout Destination"
                          >
                            <Star className="h-3 w-3 mr-1 text-amber-500" />
                            Default
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteAccountMutation.mutate(acc.id)}
                          disabled={deleteAccountMutation.isPending}
                          className="h-7 text-xs rounded-sm text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2"
                          title="Delete Account"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 3: LIVE REVENUE AUDIT STREAM */}
          <TabsContent value="audit-stream" className="rounded-md border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5 shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                  <History className="h-4 w-4 text-amber-500" />
                  Revenue Audit Ledger
                </h3>
                <p className="text-[11px] text-slate-500">
                  Real-time stream of incoming service fee cuts credited to equity partners.
                </p>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Cut</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.recent_logs && data.recent_logs.length > 0 ? (
                  data.recent_logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-slate-500">
                        {formatDateTime(log.created_at)}
                      </TableCell>
                      <TableCell className="font-mono text-slate-700">{log.shareholder_phone}</TableCell>
                      <TableCell>
                        <span
                          className={`px-1.5 py-0.2 rounded-xs text-[10px] font-bold border ${
                            log.source === "ggr"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : log.source === "api_deposit"
                                ? "bg-blue-50 text-blue-800 border-blue-200"
                                : "bg-indigo-50 text-indigo-800 border-indigo-200"
                          }`}
                        >
                          {log.source_label}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono font-bold text-emerald-700">
                        +{formatNPR(Number(log.amount))}
                      </TableCell>
                      <TableCell className="font-mono text-slate-500">{log.reference}</TableCell>
                      <TableCell className="text-slate-500 max-w-xs truncate">{log.notes}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                      No revenue log events recorded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TabsContent>

          {/* TAB 4: WITHDRAWAL HISTORY */}
          <TabsContent value="withdrawals" className="rounded-md border border-slate-200 bg-white p-4 sm:p-5 space-y-3.5 shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                  <Landmark className="h-4 w-4 text-emerald-600" />
                  Shareholder Payout History
                </h3>
                <p className="text-[11px] text-slate-500">
                  Log of shareholder profit payouts to bank accounts and wallets.
                </p>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Account Details</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.recent_withdrawals && data.recent_withdrawals.length > 0 ? (
                  data.recent_withdrawals.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-mono text-slate-500">
                        {formatDateTime(w.created_at)}
                      </TableCell>
                      <TableCell className="font-mono text-slate-700">{w.shareholder_phone}</TableCell>
                      <TableCell className="font-mono font-bold text-slate-900">
                        {formatNPR(Number(w.amount))}
                      </TableCell>
                      <TableCell className="uppercase font-semibold text-slate-600">{w.payout_method}</TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium text-slate-800">{w.account_name}</div>
                        <div className="text-slate-400 font-mono text-[11px]">
                          {w.account_number} {w.bank_name ? `(${w.bank_name})` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="px-1.5 py-0.2 rounded-xs text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {w.status.toUpperCase()}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                      No shareholder withdrawals recorded yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>

        {/* MODAL: WITHDRAW */}
        <Dialog open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen}>
          <DialogContent className="sm:max-w-lg bg-white border-slate-200 shadow-xl rounded-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-slate-900 font-bold text-base">
                <Landmark className="h-5 w-5 text-emerald-600" />
                Withdraw Equity Dividends
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Transfer your dividend balance directly to your bank account or digital wallet.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1">
              {/* Available balance card with quick percent buttons */}
              <div className="p-3.5 bg-gradient-to-r from-emerald-50/60 to-slate-50 rounded-md border border-emerald-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Available Withdrawable Balance
                  </div>
                  <div className="text-xl font-bold text-emerald-700 font-mono tabular-nums">
                    {formatNPR(Number(data?.my_wallet?.balance || 0))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageWithdraw(25)}
                    className="text-[11px] h-7 px-2 rounded-xs border-slate-200 bg-white hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    25%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageWithdraw(50)}
                    className="text-[11px] h-7 px-2 rounded-xs border-slate-200 bg-white hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    50%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageWithdraw(75)}
                    className="text-[11px] h-7 px-2 rounded-xs border-slate-200 bg-white hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    75%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleMaxWithdraw}
                    className="text-[11px] h-7 px-2.5 rounded-xs border-emerald-300 bg-emerald-50 text-emerald-800 font-bold hover:bg-emerald-100"
                  >
                    Max
                  </Button>
                </div>
              </div>

              {/* Amount input */}
              <div className="space-y-1">
                <Label htmlFor="with-amount" className="text-xs font-semibold text-slate-700">
                  Withdrawal Amount (NPR) *
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400">
                    NPR
                  </span>
                  <Input
                    id="with-amount"
                    type="number"
                    min="1"
                    placeholder="e.g. 5000"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="font-mono text-sm pl-12 rounded-sm h-9 border-slate-200 font-bold text-slate-900"
                  />
                </div>
                {Number(withdrawAmount) > Number(data?.my_wallet?.balance || 0) && (
                  <p className="text-[11px] text-rose-600 font-medium">
                    Amount exceeds your available balance of {formatNPR(Number(data?.my_wallet?.balance || 0))}.
                  </p>
                )}
              </div>

              {/* Destination Payout Account Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-700">
                    Destination Payout Account *
                  </Label>
                  <button
                    type="button"
                    onClick={() => {
                      setAddAccountModalOpen(true);
                    }}
                    className="text-[11px] text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    Add New Saved Account
                  </button>
                </div>

                {/* If saved accounts exist, show visual cards */}
                {data?.payout_accounts && data.payout_accounts.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-0.5">
                    {data.payout_accounts.map((acc) => {
                      const isSelected = selectedPayoutAccountId === String(acc.id);
                      return (
                        <div
                          key={acc.id}
                          onClick={() => {
                            setSelectedPayoutAccountId(String(acc.id));
                            setPayoutMethod(acc.method);
                            setAccountName(acc.account_name);
                            setAccountNumber(acc.account_number);
                            setBankName(acc.bank_name || "");
                          }}
                          className={`cursor-pointer p-2.5 rounded-md border text-left transition-all relative ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500 shadow-2xs"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5 mb-1">
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded-xs ${
                                acc.method === "bank"
                                  ? "bg-blue-50 text-blue-800 border border-blue-200"
                                  : acc.method === "esewa"
                                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                  : "bg-purple-50 text-purple-800 border border-purple-200"
                              }`}
                            >
                              {acc.method === "bank" ? "Bank" : acc.method.toUpperCase()}
                            </span>
                            {acc.is_default && (
                              <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-700 bg-amber-50 px-1 py-0.2 rounded-xs border border-amber-200">
                                <Star className="h-2 w-2 fill-amber-500 text-amber-500" />
                                Default
                              </span>
                            )}
                          </div>
                          <div className="font-bold text-xs text-slate-900 truncate">
                            {acc.bank_name || acc.label || acc.account_name}
                          </div>
                          <div className="text-[11px] font-mono text-slate-600 truncate mt-0.5">
                            {acc.account_number}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate mt-0.5">
                            {acc.account_name}
                          </div>
                          {isSelected && (
                            <div className="absolute top-2 right-2 text-emerald-600">
                              <CheckCircle2 className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div
                      onClick={() => setSelectedPayoutAccountId("manual")}
                      className={`cursor-pointer p-2.5 rounded-md border text-left transition-all flex flex-col justify-center items-center gap-1 ${
                        selectedPayoutAccountId === "manual"
                          ? "border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500"
                          : "border-dashed border-slate-300 bg-slate-50/50 hover:bg-slate-100 hover:border-slate-400"
                      }`}
                    >
                      <Plus className="h-4 w-4 text-slate-600" />
                      <span className="text-xs font-semibold text-slate-700">+ Custom Account</span>
                      <span className="text-[10px] text-slate-400">Enter details manually</span>
                    </div>
                  </div>
                )}

                {/* If manual custom account chosen OR no accounts saved */}
                {(selectedPayoutAccountId === "manual" || !data?.payout_accounts || data.payout_accounts.length === 0) && (
                  <div className="space-y-3 p-3 bg-slate-50/80 rounded-md border border-slate-200">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-slate-700">Account Type</Label>
                      <Select value={payoutMethod} onValueChange={setPayoutMethod}>
                        <SelectTrigger className="text-xs h-8 rounded-sm border-slate-200 bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-sm border-slate-200 bg-white">
                          <SelectItem value="bank" className="text-xs">Bank Transfer</SelectItem>
                          <SelectItem value="esewa" className="text-xs">eSewa Wallet</SelectItem>
                          <SelectItem value="khalti" className="text-xs">Khalti Wallet</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {payoutMethod === "bank" && (
                      <div className="space-y-1">
                        <Label htmlFor="bank-name" className="text-xs font-semibold text-slate-700">Bank Name *</Label>
                        <Input
                          id="bank-name"
                          list="nepal-banks-list"
                          placeholder="e.g. Nabil Bank, Global IME"
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          className="text-xs h-8 rounded-sm border-slate-200 bg-white"
                        />
                      </div>
                    )}

                    <div className="space-y-1">
                      <Label htmlFor="acc-name" className="text-xs font-semibold text-slate-700">Account Holder Name *</Label>
                      <Input
                        id="acc-name"
                        placeholder="Registered official name"
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                        className="text-xs h-8 rounded-sm border-slate-200 bg-white"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="acc-num" className="text-xs font-semibold text-slate-700">
                        {payoutMethod === "bank" ? "Account Number *" : "Registered Mobile / ID *"}
                      </Label>
                      <Input
                        id="acc-num"
                        placeholder={payoutMethod === "bank" ? "e.g. 0123456789" : "98XXXXXXXX"}
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        className="font-mono text-xs h-8 rounded-sm border-slate-200 bg-white"
                      />
                    </div>

                    {/* SAVE ACCOUNT CHECKBOX */}
                    <div className="pt-1.5 border-t border-slate-200 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="save-account-future"
                          checked={saveAccountForFuture}
                          onChange={(e) => setSaveAccountForFuture(e.target.checked)}
                          className="h-3.5 w-3.5 rounded-xs border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                        <Label htmlFor="save-account-future" className="text-xs font-medium text-slate-700 cursor-pointer">
                          Save this payout account for future 1-click withdrawals
                        </Label>
                      </div>

                      {saveAccountForFuture && (
                        <div className="pl-5.5">
                          <Input
                            placeholder="Account Label (e.g. Primary Nabil Account)"
                            value={customAccountLabel}
                            onChange={(e) => setCustomAccountLabel(e.target.value)}
                            className="text-xs h-7 rounded-sm border-slate-200 bg-white"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-slate-100">
              <Button variant="outline" size="sm" onClick={() => setWithdrawModalOpen(false)} className="rounded-sm text-xs h-8">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => withdrawMutation.mutate()}
                disabled={
                  withdrawMutation.isPending ||
                  !withdrawAmount ||
                  Number(withdrawAmount) <= 0 ||
                  Number(withdrawAmount) > Number(data?.my_wallet?.balance || 0) ||
                  (selectedPayoutAccountId === "manual" &&
                    (!accountName.trim() || !accountNumber.trim() || (payoutMethod === "bank" && !bankName.trim())))
                }
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-sm text-xs h-8 px-4"
              >
                {withdrawMutation.isPending
                  ? "Processing..."
                  : `Confirm Withdrawal (NPR ${withdrawAmount || "0"})`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL: CONFIGURE RATES */}
        <Dialog open={configModalOpen} onOpenChange={setConfigModalOpen}>
          <DialogContent className="sm:max-w-md bg-white border-slate-200 shadow-xl rounded-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-1.5 text-slate-900 font-bold text-sm">
                <Sliders className="h-4 w-4 text-amber-600" />
                Service Fee Rates
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Configure platform fee cuts applied to GGR profits and Payment API operations.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3.5 py-1">
              <div className="space-y-1">
                <Label htmlFor="ggr-pct" className="text-xs font-semibold text-slate-700">GGR Monthly Net Profit (%)</Label>
                <Input
                  id="ggr-pct"
                  type="number"
                  step="0.1"
                  value={ggrPercent}
                  onChange={(e) => setGgrPercent(e.target.value)}
                  className="font-mono text-xs h-8 rounded-sm border-slate-200"
                />
                <p className="text-[10px] text-slate-400">
                  Standard 10.0%. Platform dividend on net monthly profit.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="dep-pct" className="text-xs font-semibold text-slate-700">Deposit API Fee (%)</Label>
                <Input
                  id="dep-pct"
                  type="number"
                  step="0.1"
                  value={depPercent}
                  onChange={(e) => setDepPercent(e.target.value)}
                  className="font-mono text-xs h-8 rounded-sm border-slate-200"
                />
                <p className="text-[10px] text-slate-400">
                  Standard 1.5%. Deducted upon player payin deposit.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="wth-pct" className="text-xs font-semibold text-slate-700">Payout API Fee (%)</Label>
                <Input
                  id="wth-pct"
                  type="number"
                  step="0.1"
                  value={wthPercent}
                  onChange={(e) => setWthPercent(e.target.value)}
                  className="font-mono text-xs h-8 rounded-sm border-slate-200"
                />
                <p className="text-[10px] text-slate-400">
                  Standard 2.0%. Deducted upon player payout debit.
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button variant="outline" size="sm" onClick={() => setConfigModalOpen(false)} className="rounded-sm text-xs h-8">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => updateConfigMutation.mutate()}
                disabled={updateConfigMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-sm text-xs h-8"
              >
                {updateConfigMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL: ADD PAYOUT ACCOUNT */}
        <Dialog open={addAccountModalOpen} onOpenChange={setAddAccountModalOpen}>
          <DialogContent className="sm:max-w-md bg-white border-slate-200 shadow-xl rounded-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-1.5 text-slate-900 font-bold text-sm">
                <Landmark className="h-4 w-4 text-emerald-600" />
                Add Payout Account
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Link bank account or digital wallet to receive dividends.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Account Type</Label>
                <Select value={newAccountMethod} onValueChange={(val: any) => setNewAccountMethod(val)}>
                  <SelectTrigger className="text-xs h-8 rounded-sm border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-sm border-slate-200 bg-white">
                    <SelectItem value="bank" className="text-xs">Bank Transfer</SelectItem>
                    <SelectItem value="esewa" className="text-xs">eSewa Wallet</SelectItem>
                    <SelectItem value="khalti" className="text-xs">Khalti Wallet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="new-acc-label" className="text-xs font-semibold text-slate-700">Label (Optional)</Label>
                <Input
                  id="new-acc-label"
                  placeholder="e.g. Primary Nabil Account"
                  value={newAccountLabel}
                  onChange={(e) => setNewAccountLabel(e.target.value)}
                  className="text-xs h-8 rounded-sm border-slate-200"
                />
              </div>

              {newAccountMethod === "bank" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="new-bank-name" className="text-xs font-semibold text-slate-700">Bank Name *</Label>
                    <Input
                      id="new-bank-name"
                      list="nepal-banks-list"
                      placeholder="e.g. Nabil Bank, Global IME"
                      value={newBankName}
                      onChange={(e) => setNewBankName(e.target.value)}
                      className="text-xs h-8 rounded-sm border-slate-200"
                    />
                    <datalist id="nepal-banks-list">
                      {NEPAL_BANKS.map((b) => (
                        <option key={b} value={b} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-bank-branch" className="text-xs font-semibold text-slate-700">Branch Name</Label>
                    <Input
                      id="new-bank-branch"
                      placeholder="e.g. Kathmandu Main"
                      value={newBranch}
                      onChange={(e) => setNewBranch(e.target.value)}
                      className="text-xs h-8 rounded-sm border-slate-200"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1">
                <Label htmlFor="new-acc-name" className="text-xs font-semibold text-slate-700">Account Holder Name *</Label>
                <Input
                  id="new-acc-name"
                  placeholder="Registered name"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  className="text-xs h-8 rounded-sm border-slate-200"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="new-acc-number" className="text-xs font-semibold text-slate-700">
                  {newAccountMethod === "bank" ? "Account Number *" : "Registered Mobile / ID *"}
                </Label>
                <Input
                  id="new-acc-number"
                  placeholder={newAccountMethod === "bank" ? "0123456789012" : "98XXXXXXXX"}
                  value={newAccountNumber}
                  onChange={(e) => setNewAccountNumber(e.target.value)}
                  className="font-mono text-xs h-8 rounded-sm border-slate-200"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="new-is-default"
                  checked={newIsDefault}
                  onChange={(e) => setNewIsDefault(e.target.checked)}
                  className="h-3.5 w-3.5 rounded-xs border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <Label htmlFor="new-is-default" className="text-xs font-normal text-slate-600 cursor-pointer">
                  Set as default account
                </Label>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button variant="outline" size="sm" onClick={() => setAddAccountModalOpen(false)} className="rounded-sm text-xs h-8">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => createAccountMutation.mutate()}
                disabled={
                  createAccountMutation.isPending ||
                  !newAccountName.trim() ||
                  !newAccountNumber.trim() ||
                  (newAccountMethod === "bank" && !newBankName.trim())
                }
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-sm text-xs h-8"
              >
                {createAccountMutation.isPending ? "Saving..." : "Save Account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminShell>
  );
}
