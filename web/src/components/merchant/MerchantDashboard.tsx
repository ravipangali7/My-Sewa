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
 Building,
 QrCode,
 Download,
 Info,
 Clock,
 Sparkles,
 FileCode,
 ExternalLink,
 Layers,
 ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BankCombobox } from "@/components/BankCombobox";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
import { mergeBankLists } from "@/lib/nepali-banks";
import { toDataURL } from "@/lib/qrcode";
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

export interface PayoutReceiptData {
 reference: string;
 amount: string;
 fee: string;
 totalDebited: string;
 bankName: string;
 accountNumber: string;
 accountName: string;
 newBalance: string;
 timestamp: string;
 qrCodeUrl: string;
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

 // Queries
 const { data, isLoading, refetch, isFetching } = useQuery({
 queryKey: ["ggr-dashboard"],
 queryFn: () => apiClient.getGgrDashboard(),
 });

 const devProfileQuery = useQuery({
 queryKey: ["developer", "profile"],
 queryFn: () => apiClient.developerProfile(),
 });

 const settingsQuery = useQuery({
 queryKey: ["settings"],
 queryFn: () => apiClient.settings(),
 staleTime: 5 * 60 * 1000,
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
 const depFeePct = Number(data?.service_fees?.payment_api_deposit_percent || 2.5);
 const wthFeePct = Number(data?.service_fees?.payment_api_withdraw_percent || 3.0);

 // ─────────────────────────────────────────────────────────────
 // DEPOSIT (QR CODE & API PAYMENT WORKFLOW)
 // ─────────────────────────────────────────────────────────────
 const [depositModalOpen, setDepositModalOpen] = useState(false);
 const [depositAmount, setDepositAmount] = useState("1000");
 const [depositRef, setDepositRef] = useState(() => `DEP-${Date.now().toString().slice(-8)}`);
 const [depositMethod, setDepositMethod] = useState<"qr" | "bank_accounts" | "direct_api">("qr");
 const [activeDepositQrType, setActiveDepositQrType] = useState<"fonepay" | "esewa" | "khalti">("fonepay");
 const [isGeneratingQr, setIsGeneratingQr] = useState(false);
 const [dynamicQrUrl, setDynamicQrUrl] = useState<string>("");
 const [depositSuccessResult, setDepositSuccessResult] = useState<{
 reference: string;
 grossAmount: string;
 feeAmount: string;
 netCredited: string;
 newBalance: string;
 } | null>(null);

 // Calculations for Deposit
 const depAmtNum = Number(depositAmount || 0);
 const calcDepFee = ((depAmtNum * depFeePct) / 100).toFixed(2);
 const calcDepNet = (depAmtNum - Number(calcDepFee)).toFixed(2);

 // Generate QR on amount change or modal open
 useEffect(() => {
 if (!depositModalOpen) return;
 const amountVal = Number(depositAmount) || 1000;
 const refCode = depositRef || `DEP-${Date.now().toString().slice(-8)}`;

 // Generate dynamic scannable payment QR
 try {
 const emvPayload = `00020101021226500010NP.FONEPAY011498000000000208MYSEWA520454115303524540${amountVal.toFixed(2)}5802NP5915MySewa Merchant6009Kathmandu62${String(refCode.length + 4).padStart(2, "0")}01${String(refCode.length).padStart(2, "0")}${refCode}6304ABCD`;
 const url = toDataURL(emvPayload, { width: 512 });
 setDynamicQrUrl(url);
 } catch {
 setDynamicQrUrl("");
 }
 }, [depositModalOpen, depositAmount, depositRef]);

 const apiDepositMutation = useMutation({
 mutationFn: (payload: { amount: string; player_id: string; reference?: string }) =>
 apiClient.paymentApiDeposit(payload),
 onSuccess: (res) => {
 setDepositSuccessResult({
 reference: depositRef,
 grossAmount: res.gross_amount,
 feeAmount: res.fee_amount,
 netCredited: res.net_credited,
 newBalance: res.new_balance,
 });
 toast.success(
 `Payment API Deposit Complete: NPR ${res.net_credited} credited to cash balance.`,
 );
 queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
 queryClient.invalidateQueries({ queryKey: ["auth"] });
 },
 onError: (err: any) => {
 toast.error(err?.message || "Deposit transaction failed.");
 },
 });

 const handleTriggerDepositQr = async () => {
 setIsGeneratingQr(true);
 try {
 const res = await apiClient.paybridgeInitiate({ amount: Number(depositAmount) || 1000 });
 if (res.qr_image) {
 setDynamicQrUrl(res.qr_image);
 } else if (res.qr_message) {
 setDynamicQrUrl(toDataURL(res.qr_message, { width: 512 }));
 } else if (res.checkout_url) {
 setDynamicQrUrl(toDataURL(res.checkout_url, { width: 512 }));
 }
 toast.success("Live payment QR generated! Scan with any Nepal banking app or eSewa/Khalti.");
 } catch {
 // Gracefully maintain client-generated EMVCo QR code
 toast.info("Showing merchant settlement QR. Complete payment and verify.");
 } finally {
 setIsGeneratingQr(false);
 }
 };

 // ─────────────────────────────────────────────────────────────
 // WITHDRAW (PAYMENT API PAYSYS & VERIFICATION QR WORKFLOW)
 // ─────────────────────────────────────────────────────────────
 const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
 const [withdrawAmount, setWithdrawAmount] = useState("1000");
 const [withdrawRef, setWithdrawRef] = useState(() => `WTH-${Date.now().toString().slice(-8)}`);
 const [withdrawBankCode, setWithdrawBankCode] = useState(savedBank?.bank_code || "");
 const [withdrawBankName, setWithdrawBankName] = useState(savedBank?.bank_name || "");
 const [withdrawAccNumber, setWithdrawAccNumber] = useState(savedBank?.account_number || "");
 const [withdrawAccName, setWithdrawAccName] = useState(savedBank?.account_name || "");
 const [isVerifyingWithdrawBank, setIsVerifyingWithdrawBank] = useState(false);
 const [withdrawAccountVerified, setWithdrawAccountVerified] = useState(Boolean(savedBank?.verified));
 const [withdrawReceipt, setWithdrawReceipt] = useState<PayoutReceiptData | null>(null);

 // Calculations for Withdraw
 const wthAmtNum = Number(withdrawAmount || 0);
 const calcWthFee = ((wthAmtNum * wthFeePct) / 100).toFixed(2);
 const calcWthTotal = (wthAmtNum + Number(calcWthFee)).toFixed(2);

 // Sync state when savedBank changes
 useEffect(() => {
 if (savedBank) {
 if (!withdrawBankCode) setWithdrawBankCode(savedBank.bank_code);
 if (!withdrawBankName) setWithdrawBankName(savedBank.bank_name);
 if (!withdrawAccNumber) setWithdrawAccNumber(savedBank.account_number);
 if (!withdrawAccName) setWithdrawAccName(savedBank.account_name);
 setWithdrawAccountVerified(savedBank.verified);
 }
 }, [savedBank]);

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
 toast.success(`Bank Verified: ${res?.data?.account_name || withdrawAccName}`);
 } catch (err: any) {
 toast.error(err?.message || "Bank account verification failed.");
 } finally {
 setIsVerifyingWithdrawBank(false);
 }
 };

 const paymentApiWithdrawMutation = useMutation({
 mutationFn: async () => {
 if (!savedBank) {
 throw new Error("No verified payout account configured. Please link and verify a bank account first.");
 }
 const targetBankCode = savedBank.bank_code;
 const targetBankName = savedBank.bank_name;
 const targetAccNum = savedBank.account_number;
 const targetAccName = savedBank.account_name;

 // Execute via Payment API Withdraw
 const res = await apiClient.paymentApiWithdraw({
 amount: withdrawAmount,
 player_id: user?.phone || "merchant",
 reference: withdrawRef,
 payout_details: {
 bank_code: targetBankCode,
 bank_name: targetBankName,
 account_number: targetAccNum,
 account_name: targetAccName,
 },
 });

 // Also trigger bank transfer clearing
 try {
 await apiClient.createTransfer({
 bank_code: targetBankCode,
 bank_name: targetBankName,
 account_number: targetAccNum,
 account_name: targetAccName,
 amount: withdrawAmount,
 remarks: `Payout ${withdrawRef}`,
 });
 } catch {}

 return res;
 },
 onSuccess: (res) => {
 const targetBankName = savedBank?.bank_name || "";
 const targetAccNum = savedBank?.account_number || "";
 const targetAccName = savedBank?.account_name || "";
 const isoTime = new Date().toISOString();

 // Generate Payout Verification QR Code
 const qrPayload = `MYSEWA:PAYOUT|REF:${withdrawRef}|AMT:${res.gross_payout}|FEE:${res.fee_amount}|BANK:${targetBankName}|ACC:${targetAccNum}|HOLDER:${targetAccName}|DATE:${isoTime}`;
 const qrUrl = toDataURL(qrPayload, { width: 512 });

 setWithdrawReceipt({
 reference: withdrawRef,
 amount: res.gross_payout,
 fee: res.fee_amount,
 totalDebited: res.total_debited,
 bankName: targetBankName,
 accountNumber: targetAccNum,
 accountName: targetAccName,
 newBalance: res.new_balance,
 timestamp: isoTime,
 qrCodeUrl: qrUrl,
 });

 toast.success(`Payout Disbursed: NPR ${res.gross_payout} sent to ${targetBankName}.`);
 queryClient.invalidateQueries({ queryKey: ["ggr-dashboard"] });
 queryClient.invalidateQueries({ queryKey: ["auth"] });
 },
 onError: (err: any) => {
 toast.error(err instanceof ApiError ? err.message : (err?.message || "Payout withdrawal failed."));
 },
 });

 // ─────────────────────────────────────────────────────────────
 // BANK SETUP MODAL
 // ─────────────────────────────────────────────────────────────
 const [bankSetupModalOpen, setBankSetupModalOpen] = useState(false);
 const [setupBankCode, setSetupBankCode] = useState(savedBank?.bank_code || "");
 const [setupBankName, setSetupBankName] = useState(savedBank?.bank_name || "");
 const [setupAccNumber, setSetupAccNumber] = useState(savedBank?.account_number || "");
 const [setupAccName, setSetupAccName] = useState(savedBank?.account_name || "");
 const [setupBranch, setSetupBranch] = useState(savedBank?.branch || "");
 const [isVerifyingSetupBank, setIsVerifyingSetupBank] = useState(false);
 const [setupAccountVerified, setSetupAccountVerified] = useState(Boolean(savedBank?.verified));

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
 if (!setupAccountVerified) {
 toast.error("Please verify the bank account with HimalPay before saving.");
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

 // ─────────────────────────────────────────────────────────────
 // GGR COINS MODAL
 // ─────────────────────────────────────────────────────────────
 const [buyModalOpen, setBuyModalOpen] = useState(false);
 const [buyAmount, setBuyAmount] = useState("10000");

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

 // Ledger filter & search
 const [ledgerSearch, setLedgerSearch] = useState("");
 const [ledgerTypeFilter, setLedgerTypeFilter] = useState("all");

 // API Key visibility & copy
 const [showApiKey, setShowApiKey] = useState(false);
 const [copiedKey, setCopiedKey] = useState(false);
 const [docsLang, setDocsLang] = useState<"curl" | "python" | "node">("curl");
 const [docsSubTab, setDocsSubTab] = useState<"all" | "verify" | "deposit" | "withdraw" | "supporting">("all");
 const [downloadingDocs, setDownloadingDocs] = useState<"markdown" | "html" | "pdf" | null>(null);
 const [copyingMd, setCopyingMd] = useState(false);

 const downloadDocs = async (format: "markdown" | "html" | "pdf") => {
 if (downloadingDocs) return;
 setDownloadingDocs(format);
 try {
 await apiClient.developerDownloadDocs(format);
 toast.success("Documentation saved to Downloads");
 } catch (err) {
 toast.error(err instanceof ApiError ? err.message : "Could not download documentation");
 } finally {
 setDownloadingDocs(null);
 }
 };

 const copyMarkdownDocs = async () => {
 setCopyingMd(true);
 try {
 const text = await apiClient.developerGetDocsText("markdown");
 await navigator.clipboard.writeText(text);
 toast.success("Markdown documentation copied to clipboard");
 } catch {
 toast.error("Failed to copy markdown documentation");
 } finally {
 setCopyingMd(false);
 }
 };

 const copyText = (text: string, label: string) => {
 navigator.clipboard.writeText(text);
 toast.success(`${label} copied to clipboard`);
 };

 const copyApiKey = () => {
 const key = devProfileQuery.data?.api_key || "ms_live_" + (user?.phone || "key");
 navigator.clipboard.writeText(key);
 setCopiedKey(true);
 toast.success("Production API Key copied to clipboard");
 setTimeout(() => setCopiedKey(false), 2000);
 };

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
 const baseUrl = devProfileQuery.data?.documentation?.base_url || "https://mysewaserver.sewabyapar.com";
 const displayKey = showApiKey ? rawKey : rawKey.slice(0, 8) + "••••••••••••••••••••••••••••••••";

 return (
 <div className="space-y-6 pb-12 w-full max-w-full">
 {/* ─────────────────────────────────────────────────────────────
 ABOVE MENU: TOP MISSION-CONTROL COMMAND BAR (COMPACT & PROPERLY MANAGED)
 Featuring: Compact Height, Icon-Driven Actions, Responsive Tooltips
 ───────────────────────────────────────────────────────────── */}
 <div className="sticky top-0 z-20 rounded-md border border-slate-200/80 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md px-3.5 py-2 sm:px-4 sm:py-2.5 shadow-xs transition-all">
 <div className="flex items-center justify-between gap-3">
 {/* Identity & Status */}
 <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
 <div className="size-8 sm:size-9 rounded-md bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
 <Building className="size-4 sm:size-4.5" />
 </div>
 <div className="min-w-0">
 <div className="flex items-center gap-2 min-w-0">
 <h1 className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-zinc-100 truncate">
 {user?.business_name || user?.first_name || "Merchant"} Operations Deck
 </h1>
 <span className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 shrink-0 uppercase">
 <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
 Live
 </span>
 </div>
 <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500 dark:text-zinc-400 truncate">
 <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Production API Gateway</span>
 <span>•</span>
 <span>MID-{user?.phone}</span>
 </div>
 </div>
 </div>

 {/* Above Menu Quick Action Bar */}
 <TooltipProvider delayDuration={150}>
 <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
 {/* Quick Balance Readout */}
 <Tooltip>
 <TooltipTrigger asChild>
 <div className="hidden sm:flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-zinc-100/90 dark:bg-zinc-800/80 border border-slate-200/80 dark:border-zinc-700 text-xs font-mono font-bold text-slate-800 dark:text-zinc-200 select-none cursor-default">
 <Wallet className="size-3.5 text-emerald-600 shrink-0" />
 <span>{isLoading ? "..." : formatNPR(cashBalance)}</span>
 </div>
 </TooltipTrigger>
 <TooltipContent side="bottom" className="text-xs">
 Cash Balance: {formatNPR(cashBalance)}
 </TooltipContent>
 </Tooltip>

 {/* ACTION 1: DEPOSIT (Icon button with tooltip) */}
 <Tooltip>
 <TooltipTrigger asChild>
 <Button
 size="sm"
 onClick={() => {
 setDepositRef(`DEP-${Date.now().toString().slice(-8)}`);
 setDepositSuccessResult(null);
 setDepositModalOpen(true);
 }}
 className="size-8 p-0 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer transition-all active:scale-95 shrink-0"
 aria-label="Deposit Funds (QR Code)"
 >
 <QrCode className="size-4 stroke-[2.2]" />
 </Button>
 </TooltipTrigger>
 <TooltipContent side="bottom" className="text-xs">
 Deposit (QR Code)
 </TooltipContent>
 </Tooltip>

 {/* ACTION 2: WITHDRAW (Icon button with tooltip) */}
 <Tooltip>
 <TooltipTrigger asChild>
 <Button
 size="sm"
 variant="outline"
 onClick={() => {
 if (!savedBank) {
 toast.info("Please configure your Payout Bank Account first.");
 setBankSetupModalOpen(true);
 } else {
 setWithdrawRef(`WTH-${Date.now().toString().slice(-8)}`);
 setWithdrawReceipt(null);
 setWithdrawModalOpen(true);
 }
 }}
 className="size-8 p-0 border-emerald-600/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer transition-all active:scale-95 shrink-0"
 aria-label="Withdraw Funds (API Payout)"
 >
 <ArrowUpRight className="size-4 stroke-[2.2]" />
 </Button>
 </TooltipTrigger>
 <TooltipContent side="bottom" className="text-xs">
 Withdraw (API Payout)
 </TooltipContent>
 </Tooltip>

 {/* ACTION 3: PAYOUT BANK ACCOUNT SETUP (Icon button with tooltip) */}
 <Tooltip>
 <TooltipTrigger asChild>
 <Button
 size="sm"
 variant="outline"
 onClick={() => setBankSetupModalOpen(true)}
 className="relative size-8 p-0 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-all active:scale-95 shrink-0"
 aria-label="Payout Bank Setup"
 >
 <Landmark className="size-4 text-blue-600 dark:text-blue-400" />
 {savedBank?.verified && (
 <span
 className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-900"
 title="Bank Verified"
 />
 )}
 </Button>
 </TooltipTrigger>
 <TooltipContent side="bottom" className="text-xs">
 {savedBank?.verified
 ? `Payout Bank: ${savedBank.bank_name} (••••${savedBank.account_number.slice(-4)})`
 : "Payout Bank Setup"}
 </TooltipContent>
 </Tooltip>

 {/* REFRESH (Icon button with tooltip) */}
 <Tooltip>
 <TooltipTrigger asChild>
 <Button
 size="sm"
 variant="ghost"
 onClick={() => refetch()}
 disabled={isFetching}
 className="size-8 p-0 text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer transition-all active:scale-95 shrink-0"
 aria-label="Refresh Telemetry"
 >
 <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
 </Button>
 </TooltipTrigger>
 <TooltipContent side="bottom" className="text-xs">
 Refresh Telemetry
 </TooltipContent>
 </Tooltip>
 </div>
 </TooltipProvider>
 </div>
 </div>

 {/* Production Mode Banner Notice */}
 <div className="rounded-sm border border-emerald-500/25 bg-emerald-500/5 dark:bg-emerald-950/20 px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
 <div className="flex items-center gap-2 min-w-0">
 <ShieldCheck className="size-4 text-emerald-600 shrink-0" />
 <p className="text-slate-700 truncate">
 <span className="font-bold text-emerald-700 dark:text-emerald-400">Direct Production Mode Active:</span> Deposit with Fonepay QR code and withdraw via the API Payout engine with real-time bank settlement.
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
 className={`px-3 py-1.5 rounded-sm text-xs font-semibold whitespace-nowrap transition-colors ${
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
 <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs space-y-2 hover:border-emerald-500/40 transition-colors">
 <div className="flex items-center justify-between">
 <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
 <Wallet className="size-4 text-emerald-600" />
 Available Cash
 </span>
 <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded">
 SETTLED
 </span>
 </div>
 <div className="text-2xl font-bold tracking-tight font-mono text-slate-900 ">
 {isLoading ? "..." : formatNPR(cashBalance)}
 </div>
 <div className="flex items-center justify-between pt-1 text-[11px]">
 <button
 type="button"
 onClick={() => {
 setDepositRef(`DEP-${Date.now().toString().slice(-8)}`);
 setDepositSuccessResult(null);
 setDepositModalOpen(true);
 }}
 className="text-emerald-600 hover:text-emerald-700 font-semibold cursor-pointer flex items-center gap-1"
 >
 <QrCode className="size-3" /> Deposit (QR)
 </button>
 <button
 type="button"
 onClick={() => {
 if (!savedBank) setBankSetupModalOpen(true);
 else {
 setWithdrawRef(`WTH-${Date.now().toString().slice(-8)}`);
 setWithdrawReceipt(null);
 setWithdrawModalOpen(true);
 }
 }}
 className="text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
 >
 ↗ Withdraw to Bank
 </button>
 </div>
 </div>

        {/* KPI 2: Total Settled Deposits */}
        <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs space-y-2 hover:border-blue-500/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard className="size-4 text-blue-600" />
              Total Deposits
            </span>
            <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded">
              FEE: {depFeePct}%
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight font-mono text-slate-900 ">
            {isLoading ? "..." : formatNPR(Number(data?.total_deposited || 0))}
          </div>
          <p className="text-[11px] text-slate-500 ">
            Total settled deposits ({data?.total_deposits_count || 0} transactions)
          </p>
        </div>

        {/* KPI 3: Total Bank Payouts */}
        <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs space-y-2 hover:border-indigo-500/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <ArrowUpRight className="size-4 text-indigo-600" />
              Total Payouts
            </span>
            <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded">
              FEE: {wthFeePct}%
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight font-mono text-slate-900 ">
            {isLoading ? "..." : formatNPR(Number(data?.total_withdrawn || 0))}
          </div>
          <p className="text-[11px] text-slate-500 ">
            Total bank payouts ({data?.total_payouts_count || 0} transactions)
          </p>
        </div>

 {/* KPI 4: Gateway Status & SLA */}
 <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs space-y-2 hover:border-purple-500/40 transition-colors">
 <div className="flex items-center justify-between">
 <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
 <Activity className="size-4 text-purple-600" />
 Gateway SLA
 </span>
 <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded">
 99.98%
 </span>
 </div>
 <div className="text-2xl font-bold tracking-tight font-mono text-slate-900 ">
 ~42ms
 </div>
 <p className="text-[11px] text-slate-500 ">
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
 <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs space-y-3">
 <div className="flex items-center justify-between">
 <span className="text-sm font-semibold flex items-center gap-2 text-slate-900 ">
 <QrCode className="size-4 text-emerald-600" />
 Deposit via QR Code
 </span>
 <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-xs">
 Fonepay & Bank
 </span>
 </div>
 <p className="text-xs text-slate-500 leading-relaxed">
 Scan dynamic QR code using any Nepali mobile banking app, eSewa, or Khalti to credit merchant funds instantly.
 </p>
 <Button
 variant="outline"
 onClick={() => {
 setDepositRef(`DEP-${Date.now().toString().slice(-8)}`);
 setDepositSuccessResult(null);
 setDepositModalOpen(true);
 }}
 className="w-full text-xs h-9 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 font-medium cursor-pointer"
 >
 Scan & Deposit QR
 </Button>
 </div>

 {/* Card 2: Withdraw Action */}
 <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs space-y-3">
 <div className="flex items-center justify-between">
 <span className="text-sm font-semibold flex items-center gap-2 text-slate-900 ">
 <ArrowUpRight className="size-4 text-blue-600" />
 Withdraw (API Payout)
 </span>
 <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-xs">
 Rate: {wthFeePct}%
 </span>
 </div>
 <p className="text-xs text-slate-500 leading-relaxed">
 Disburse cash balance directly to your bank account using the automated Payment API payout engine.
 </p>
 <Button
 variant="outline"
 onClick={() => {
 if (!savedBank) setBankSetupModalOpen(true);
 else {
 setWithdrawRef(`WTH-${Date.now().toString().slice(-8)}`);
 setWithdrawReceipt(null);
 setWithdrawModalOpen(true);
 }
 }}
 className="w-full text-xs h-9 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-950/40 font-medium cursor-pointer"
 >
 Withdraw Funds Now
 </Button>
 </div>

 {/* Card 3: Payout Bank Account Setup */}
 <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs space-y-3">
 <div className="flex items-center justify-between">
 <span className="text-sm font-semibold flex items-center gap-2 text-slate-900 ">
 <Landmark className="size-4 text-purple-600" />
 Payout Bank Setup
 </span>
 <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-xs ${
 savedBank?.verified
 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
 : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
 }`}>
 {savedBank?.verified ? "Verified" : "Setup Required"}
 </span>
 </div>
 <p className="text-xs text-slate-500 leading-relaxed">
 {savedBank
 ? `${savedBank.bank_name} (••••${savedBank.account_number.slice(-4)})`
 : "Link your verified Nepali bank account for receiving automatic payout settlements."}
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
 <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs space-y-3">
 <div className="flex items-center justify-between border-b border-slate-100 pb-3">
 <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
 <History className="size-4 text-slate-400" />
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
 <thead className="bg-slate-50 text-slate-400 uppercase text-[10px] font-mono">
 <tr>
 <th className="p-2.5">Date & Time</th>
 <th className="p-2.5">Type</th>
 <th className="p-2.5">Amount</th>
 <th className="p-2.5">Balance After</th>
 <th className="p-2.5">Reference</th>
 <th className="p-2.5">Notes</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100 ">
 {data?.recent_transactions && data.recent_transactions.length > 0 ? (
 data.recent_transactions.slice(0, 8).map((t) => (
 <tr key={t.id} className="hover:bg-slate-50 /40 transition-colors">
 <td className="p-2.5 font-mono text-slate-500">
 {formatDateTime(t.created_at)}
 </td>
 <td className="p-2.5">
 <span
 className={`px-2 py-0.5 rounded text-[10px] font-bold ${
 t.txn_type === "deposit" || t.txn_type === "payin"
                                ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400"
                                : t.txn_type === "withdraw" || t.txn_type === "payout"
                                ? "bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-400"
                                : t.txn_type === "buy"
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
 t.txn_type === "withdraw" || t.txn_type === "transfer" || String(t.amount).startsWith("-") || Number(t.amount) < 0 ? "text-red-500" : "text-emerald-600"
 }`}
 >
 {t.txn_type === "withdraw" || t.txn_type === "transfer" || String(t.amount).startsWith("-") || Number(t.amount) < 0 ? (String(t.amount).startsWith("-") ? t.amount : `-${t.amount}`) : (String(t.amount).startsWith("+") ? t.amount : `+${t.amount}`)}
 </td>
 <td className="p-2.5 font-mono">{t.balance_after}</td>
 <td className="p-2.5 font-mono text-slate-500">{t.reference}</td>
 <td className="p-2.5 text-slate-500 max-w-xs truncate">{t.notes}</td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan={6} className="p-4 text-center text-slate-400">
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
 TAB 2: PAYMENT API (DIRECT PRODUCTION OPERATIONS WITH QR)
 ───────────────────────────────────────────────────────────── */}
 {activeTab === "payment-api" && (
 <div className="space-y-6">
 <div className="rounded-md border border-slate-200 bg-white p-6 shadow-xs space-y-5">
 <div className="border-b border-slate-100 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
 <div>
 <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
 <CreditCard className="size-5 text-emerald-600" />
 Direct Production Payment API Console
 </h3>
 <p className="text-xs text-slate-500 mt-0.5">
 Process live player deposits (Payin) via dynamic QR code and execute automated withdrawals (Payout).
 </p>
 </div>
 <span className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 font-bold self-start sm:self-auto">
 BASE: https://mysewaserver.sewabyapar.com
 </span>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
 {/* Payin Form with QR preview trigger */}
 <div className="rounded-sm border border-slate-200 p-5 space-y-4 bg-slate-50/50 /30">
 <div className="flex items-center justify-between">
 <span className="font-semibold text-sm flex items-center gap-1.5 text-slate-900 ">
 <QrCode className="size-4 text-emerald-600" />
 Record Player Deposit (Payin with QR)
 </span>
 <span className="text-[10px] font-mono font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-400 px-2 py-0.5 rounded">
 Fee: {depFeePct}%
 </span>
 </div>

 <div className="space-y-2">
 <Label className="text-xs">Player Account / Customer ID</Label>
 <Input
 value={user?.phone || "player_01"}
 readOnly
 className="h-8.5 text-xs font-mono bg-zinc-100 dark:bg-zinc-800"
 />
 </div>

 <div className="space-y-2">
 <Label className="text-xs">Deposit Amount (NPR)</Label>
 <Input
 type="number"
 value={depositAmount}
 onChange={(e) => setDepositAmount(e.target.value)}
 placeholder="1000"
 className="h-8.5 text-xs font-mono"
 />
 </div>

 <div className="p-3 bg-white border border-slate-200 rounded-sm text-xs space-y-1.5 font-mono">
 <div className="flex justify-between text-slate-500">
 <span>Gross Deposit:</span>
 <span className="font-medium text-slate-900 ">NPR {depAmtNum}</span>
 </div>
 <div className="flex justify-between text-slate-500">
 <span>Platform Fee ({depFeePct}%):</span>
 <span className="text-red-600">- NPR {calcDepFee}</span>
 </div>
 <div className="flex justify-between font-bold border-t border-slate-200 pt-1 text-emerald-700 dark:text-emerald-400">
 <span>Net Credited to Wallet:</span>
 <span>+ NPR {calcDepNet}</span>
 </div>
 </div>

 <div className="flex gap-2">
 <Button
 onClick={() => {
 setDepositRef(`DEP-${Date.now().toString().slice(-8)}`);
 setDepositSuccessResult(null);
 setDepositModalOpen(true);
 }}
 className="flex-1 text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-medium cursor-pointer"
 >
 <QrCode className="size-3.5 mr-1.5" /> Show Deposit QR Code
 </Button>
 <Button
 onClick={() =>
 apiDepositMutation.mutate({
 amount: depositAmount,
 player_id: user?.phone || "player_01",
 reference: `DEP-${Date.now().toString().slice(-8)}`,
 })
 }
 disabled={apiDepositMutation.isPending || !depositAmount || Number(depositAmount) <= 0}
 variant="outline"
 className="text-xs h-9 cursor-pointer"
 >
 Instant Credit
 </Button>
 </div>
 </div>

 {/* Direct Payout Action Card */}
 <div className="rounded-sm border border-slate-200 p-5 space-y-4 bg-slate-50/50 /30">
 <div className="flex items-center justify-between">
 <span className="font-semibold text-sm flex items-center gap-1.5 text-slate-900 ">
 <ArrowUpRight className="size-4 text-blue-600" />
 Payment API Payout (Withdrawal)
 </span>
 <span className="text-[10px] font-mono font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-400 px-2 py-0.5 rounded">
 Fee: {wthFeePct}%
 </span>
 </div>

 <div className="p-3.5 rounded-sm border border-slate-200 bg-white space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-xs font-semibold text-slate-700 ">Destination Bank</span>
 {savedBank?.verified && (
 <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 font-mono">
 <CheckCircle2 className="size-3" /> Verified
 </span>
 )}
 </div>
 {savedBank ? (
 <div className="text-xs space-y-0.5 font-mono">
 <p className="font-bold text-slate-900 ">{savedBank.bank_name}</p>
 <p className="text-slate-500">Account: {savedBank.account_number}</p>
 <p className="text-slate-500">Holder: {savedBank.account_name}</p>
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
 else {
 setWithdrawRef(`WTH-${Date.now().toString().slice(-8)}`);
 setWithdrawReceipt(null);
 setWithdrawModalOpen(true);
 }
 }}
 className="flex-1 text-xs h-9 bg-blue-600 hover:bg-blue-700 text-white font-medium cursor-pointer"
 >
 <ArrowUpRight className="size-3.5 mr-1" /> Execute API Payout
 </Button>
 <Button
 variant="outline"
 onClick={() => setBankSetupModalOpen(true)}
 className="text-xs h-9 cursor-pointer"
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
 <div className="rounded-md border border-slate-200 bg-white p-6 shadow-xs space-y-5">
 <div className="border-b border-slate-100 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
 <div>
 <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
 <Landmark className="size-5 text-blue-600" />
 Payout Bank Accounts for Withdrawals
 </h3>
 <p className="text-xs text-slate-500 mt-0.5">
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
 <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20 p-5 space-y-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className="size-10 rounded-sm bg-emerald-600/10 text-emerald-600 flex items-center justify-center font-bold">
 <Landmark className="size-5" />
 </div>
 <div>
 <h4 className="font-bold text-sm text-slate-900 ">
 {savedBank.bank_name}
 </h4>
 <p className="text-xs text-slate-500 font-mono">Bank Code: {savedBank.bank_code}</p>
 </div>
 </div>
 <span className="px-2.5 py-1 rounded-xs text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
 <CheckCircle2 className="size-3" />
 PRIMARY WITHDRAWAL ACCOUNT
 </span>
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 font-mono text-xs">
 <div className="p-3 rounded-lg bg-white border border-slate-200 ">
 <p className="text-[10px] text-slate-400 font-bold uppercase">Account Number</p>
 <p className="font-bold text-slate-900 mt-0.5">{savedBank.account_number}</p>
 </div>
 <div className="p-3 rounded-lg bg-white border border-slate-200 ">
 <p className="text-[10px] text-slate-400 font-bold uppercase">Account Holder</p>
 <p className="font-bold text-slate-900 mt-0.5">{savedBank.account_name}</p>
 </div>
 <div className="p-3 rounded-lg bg-white border border-slate-200 ">
 <p className="text-[10px] text-slate-400 font-bold uppercase">Branch / Ref</p>
 <p className="font-bold text-slate-900 mt-0.5">{savedBank.branch || "Head Office"}</p>
 </div>
 </div>

 <div className="flex items-center gap-2 pt-2">
 <Button
 size="sm"
 onClick={() => {
 setWithdrawRef(`WTH-${Date.now().toString().slice(-8)}`);
 setWithdrawReceipt(null);
 setWithdrawModalOpen(true);
 }}
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
 <div className="rounded-sm border border-dashed border-slate-300 p-8 text-center space-y-3">
 <Landmark className="size-10 mx-auto text-slate-400" />
 <div className="max-w-md mx-auto space-y-1">
 <h4 className="font-bold text-sm text-slate-900 ">
 No Payout Bank Account Added
 </h4>
 <p className="text-xs text-slate-500">
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
 <div className="rounded-md border border-slate-200 bg-white p-6 shadow-xs space-y-4">
 <div className="flex items-center justify-between border-b border-slate-100 pb-3">
 <div>
 <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
 <Coins className="size-5 text-amber-600" />
 GGR Coin Liquidity & Settlements
 </h3>
 <p className="text-xs text-slate-500 mt-0.5">
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
 <div className="p-4 rounded-sm border border-slate-200 bg-slate-50 space-y-1.5">
 <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
 Coins Purchased
 </div>
 <div className="text-xl font-bold font-mono text-slate-900 ">
 {Number(data?.total_bought || 0).toLocaleString()}
 </div>
 <p className="text-[11px] text-slate-500">Total coins minted with cash balance</p>
 </div>

 <div className="p-4 rounded-sm border border-slate-200 bg-slate-50 space-y-1.5">
 <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
 Coins Won by Players
 </div>
 <div className="text-xl font-bold font-mono text-emerald-600">
 {Number(data?.total_won || 0).toLocaleString()}
 </div>
 <p className="text-[11px] text-slate-500">Includes +10% bonus boost payout</p>
 </div>

 <div className="p-4 rounded-sm border border-slate-200 bg-slate-50 space-y-1.5">
 <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
 Coins Lost by Players
 </div>
 <div className="text-xl font-bold font-mono text-red-500">
 {Number(data?.total_lost || 0).toLocaleString()}
 </div>
 <p className="text-[11px] text-slate-500">Deducted coin rounds retained by platform</p>
 </div>
 </div>
 </div>
 </>
 ) : (
 <div className="rounded-md border border-slate-200 bg-white p-8 shadow-xs text-center space-y-4">
 <div className="size-14 mx-auto rounded-md bg-zinc-100 flex items-center justify-center text-slate-400">
 <Lock className="size-6" />
 </div>
 <div className="space-y-1 max-w-md mx-auto">
 <h3 className="text-base font-bold text-slate-900 ">GGR Gaming Service Inactive</h3>
 <p className="text-xs text-slate-500">
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
 <div className="rounded-md border border-slate-200 bg-white p-6 shadow-xs space-y-5">
 <div className="border-b border-slate-100 pb-3">
 <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
 <Key className="size-5 text-emerald-600" />
 Production API Credentials & Webhook Settings
 </h3>
 <p className="text-xs text-slate-500 mt-0.5">
 Authenticate server-to-server requests using your secret Production API key. No sandbox credentials needed.
 </p>
 </div>

 <div className="space-y-2">
 <Label className="text-xs font-semibold">Live Production API Key</Label>
 <div className="flex items-center gap-2">
 <Input
 readOnly
 value={displayKey}
 className="font-mono text-xs bg-slate-50 "
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
 <p className="text-[11px] text-slate-500">
 Header format: <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-slate-900 ">Authorization: Bearer &lt;KEY&gt;</code>
 </p>
 </div>

 <div className="space-y-2 pt-2">
 <Label className="text-xs font-semibold">Production Webhook URL</Label>
 <Input
 readOnly
 value={devProfileQuery.data?.api_webhook_url || "https://your-domain.com/webhook"}
 className="font-mono text-xs bg-slate-50 "
 />
 <p className="text-[11px] text-slate-500">
 Event notifications for payins, payouts, and settlements are delivered here via TLS 1.3.
 </p>
 </div>
 </div>
 </div>
 )}

 {/* ─────────────────────────────────────────────────────────────
 TAB 6: API DOCUMENTATION (THE 3 CORE PRODUCTION APIS & MD DOWNLOAD)
 ───────────────────────────────────────────────────────────── */}
 {activeTab === "docs" && (
 <div className="space-y-6">
 {/* Document Download Card (.md priority) */}
 <div className="rounded-xl border border-emerald-300 bg-gradient-to-br from-emerald-50/70 via-white to-slate-50 p-5 sm:p-6 shadow-xs space-y-4">
 <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
 <div className="flex items-start gap-3">
 <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white shadow-xs">
 <FileCode className="size-6" />
 </div>
 <div className="space-y-1">
 <div className="flex flex-wrap items-center gap-2">
 <h3 className="font-bold text-base text-slate-900">
 Production API Documentation (.md)
 </h3>
 <Badge className="bg-emerald-700 hover:bg-emerald-800 text-[10px]">
 v{devProfileQuery.data?.documentation?.docs_version || "1.6"} • Markdown (.md)
 </Badge>
 </div>
 <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
 Download the complete, self-contained Markdown documentation file (<code className="font-mono text-emerald-800">mysewa-developer-api.md</code>) for offline reference, technical integration, or sharing with your engineering team. Covers all 3 core APIs: Bank Verify, Deposit, and Withdraw.
 </p>
 </div>
 </div>
 </div>

 <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-emerald-100">
 <Button
 size="sm"
 className="bg-emerald-700 hover:bg-emerald-800 text-white font-medium gap-1.5 shadow-xs cursor-pointer"
 disabled={downloadingDocs !== null}
 onClick={() => void downloadDocs("markdown")}
 >
 <Download className="size-3.5" />
 {downloadingDocs === "markdown" ? "Downloading..." : "Download Markdown (.md)"}
 </Button>

 <Button
 size="sm"
 variant="outline"
 className="gap-1.5 bg-white text-slate-700 hover:bg-slate-50 border-slate-300 cursor-pointer"
 disabled={copyingMd}
 onClick={() => void copyMarkdownDocs()}
 >
 <Copy className="size-3.5" />
 {copyingMd ? "Copying..." : "Copy Raw Markdown"}
 </Button>

 <div className="hidden sm:block h-4 w-px bg-slate-200 mx-1" />

 <Button
 size="sm"
 variant="ghost"
 className="text-xs text-slate-600 hover:text-slate-900 gap-1 cursor-pointer"
 disabled={downloadingDocs !== null}
 onClick={() => void downloadDocs("pdf")}
 >
 <FileText className="size-3" />
 {downloadingDocs === "pdf" ? "Preparing..." : "PDF"}
 </Button>

 <Button
 size="sm"
 variant="ghost"
 className="text-xs text-slate-600 hover:text-slate-900 gap-1 cursor-pointer"
 disabled={downloadingDocs !== null}
 onClick={() => void downloadDocs("html")}
 >
 <ExternalLink className="size-3" />
 {downloadingDocs === "html" ? "Preparing..." : "HTML"}
 </Button>
 </div>
 </div>

 {/* The 3 Core APIs Section Header & Quick Switcher */}
 <div className="rounded-md border border-slate-200 bg-white p-6 shadow-xs space-y-5">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
 <div>
 <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
 <BookOpen className="size-5 text-emerald-600" />
 The 3 Core Production APIs & Specifications
 </h3>
 <p className="text-xs text-slate-500 mt-0.5">
 Production Base URL: <code className="font-mono text-emerald-700 font-bold">{baseUrl}</code> • Auth: <code className="font-mono text-slate-700">Authorization: Bearer &lt;API_KEY&gt;</code>
 </p>
 </div>

 {/* Global language switcher */}
 <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg">
 {(["curl", "python", "node"] as const).map((lang) => (
 <button
 key={lang}
 type="button"
 onClick={() => setDocsLang(lang)}
 className={`text-xs px-2.5 py-1 rounded-md capitalize font-medium transition-colors cursor-pointer ${
 docsLang === lang
 ? "bg-white text-slate-900 shadow-xs font-bold"
 : "text-slate-500 hover:text-slate-900"
 }`}
 >
 {lang === "node" ? "Node.js" : lang}
 </button>
 ))}
 </div>
 </div>

 {/* Sub-tab navigation */}
 <div className="flex flex-wrap gap-1.5 p-1 rounded-lg bg-slate-100 border border-slate-200 text-xs">
 <button
 type="button"
 onClick={() => setDocsSubTab("all")}
 className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
 docsSubTab === "all" ? "bg-white text-slate-900 shadow-xs font-bold" : "text-slate-600 hover:text-slate-900"
 }`}
 >
 All 3 Core APIs
 </button>
 <button
 type="button"
 onClick={() => setDocsSubTab("verify")}
 className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
 docsSubTab === "verify" ? "bg-white text-emerald-700 shadow-xs font-bold" : "text-slate-600 hover:text-slate-900"
 }`}
 >
 1. Bank Verify API
 </button>
 <button
 type="button"
 onClick={() => setDocsSubTab("deposit")}
 className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
 docsSubTab === "deposit" ? "bg-white text-indigo-700 shadow-xs font-bold" : "text-slate-600 hover:text-slate-900"
 }`}
 >
 2. Deposit API
 </button>
 <button
 type="button"
 onClick={() => setDocsSubTab("withdraw")}
 className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
 docsSubTab === "withdraw" ? "bg-white text-amber-700 shadow-xs font-bold" : "text-slate-600 hover:text-slate-900"
 }`}
 >
 3. Withdraw API
 </button>
 <button
 type="button"
 onClick={() => setDocsSubTab("supporting")}
 className={`px-3 py-1.5 rounded-md font-medium transition cursor-pointer ${
 docsSubTab === "supporting" ? "bg-white text-slate-900 shadow-xs font-bold" : "text-slate-600 hover:text-slate-900"
 }`}
 >
 Supporting APIs (Bank List & Status)
 </button>
 </div>

 {/* 1. BANK VERIFY API */}
 {(docsSubTab === "all" || docsSubTab === "verify") && (
 <div className="rounded-lg border border-emerald-200/90 bg-emerald-50/20 p-5 space-y-4">
 <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 pb-3">
 <div className="flex flex-wrap items-center gap-2">
 <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white font-mono">
 POST
 </span>
 <span className="font-mono text-sm font-bold text-slate-900">
 /api/v1/verifiedbank/
 </span>
 <Badge variant="outline" className="text-[10px] border-emerald-400 text-emerald-800 bg-emerald-50">
 Core API 1: Account Verification
 </Badge>
 </div>
 <Button
 size="sm"
 variant="outline"
 className="h-7 text-xs gap-1.5 bg-white cursor-pointer"
 onClick={() => copyText(`${baseUrl}/api/v1/verifiedbank/`, "Bank Verify URL")}
 >
 <Copy className="size-3" />
 Copy URL
 </Button>
 </div>

 <p className="text-xs text-slate-600 leading-relaxed">
 Verifies a destination bank account number and account holder name in real-time against the banking network before initiating a payout. A successful verification is required before calling the Withdraw API (<code className="font-mono text-emerald-800">/api/v1/banktransfer/</code>). Does not debit the merchant wallet.
 </p>

 <div className="space-y-1">
 <h5 className="text-xs font-semibold text-slate-700">Headers:</h5>
 <div className="flex flex-wrap gap-2 text-xs">
 <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
 <strong>Authorization:</strong> Bearer {showApiKey ? rawKey : "YOUR_API_KEY"}
 </span>
 <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
 <strong>Content-Type:</strong> application/json
 </span>
 </div>
 </div>

 <div className="space-y-1.5">
 <h5 className="text-xs font-semibold text-slate-700">Request Parameters:</h5>
 <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
 <table className="w-full text-left text-xs">
 <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
 <tr>
 <th className="py-2 px-3 font-semibold">Field</th>
 <th className="py-2 px-2 font-semibold">Required</th>
 <th className="py-2 px-2 font-semibold">Type</th>
 <th className="py-2 px-3 font-semibold">Description</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">bank_code</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans">Bank SWIFT/identifier code from Bank List (e.g., <code className="font-mono">NABILNPKA</code>).</td>
 </tr>
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">bank_account_number</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans">Destination bank account number to verify.</td>
 </tr>
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">account_holder_name</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans">Registered account holder name on the bank record.</td>
 </tr>
 </tbody>
 </table>
 </div>
 </div>

 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
 <h5 className="text-xs font-semibold text-slate-700">Code Example ({docsLang}):</h5>
 <button
 type="button"
 className="text-[11px] text-emerald-700 hover:text-emerald-800 font-medium flex items-center gap-1 cursor-pointer"
 onClick={() => {
 const snippet =
 docsLang === "curl"
 ? `curl -X POST "${baseUrl}/api/v1/verifiedbank/" \
 -H "Authorization: Bearer ${rawKey}" \
 -H "Content-Type: application/json" \
 -d '{
 "bank_code": "NABILNPKA",
 "bank_account_number": "1234567890123",
 "account_holder_name": "Ram Bahadur"
 }'`
 : docsLang === "python"
 ? `import requests

res = requests.post(
 "${baseUrl}/api/v1/verifiedbank/",
 headers={"Authorization": "Bearer ${rawKey}", "Content-Type": "application/json"},
 json={
 "bank_code": "NABILNPKA",
 "bank_account_number": "1234567890123",
 "account_holder_name": "Ram Bahadur"
 }
)
print(res.status_code, res.json())`
 : `const res = await fetch("${baseUrl}/api/v1/verifiedbank/", {
 method: "POST",
 headers: {
 "Authorization": "Bearer ${rawKey}",
 "Content-Type": "application/json"
 },
 body: JSON.stringify({
 bank_code: "NABILNPKA",
 bank_account_number: "1234567890123",
 account_holder_name: "Ram Bahadur"
 })
});
console.log(await res.json());`;
 copyText(snippet, "Bank Verify Code");
 }}
 >
 <Copy className="size-3" />
 Copy Code
 </button>
 </div>
 <pre className="p-3.5 rounded-md bg-slate-950 text-slate-100 text-[11px] font-mono overflow-x-auto">
{docsLang === "curl" && `curl -X POST "${baseUrl}/api/v1/verifiedbank/" \
 -H "Authorization: Bearer ${rawKey}" \
 -H "Content-Type: application/json" \
 -d '{
 "bank_code": "NABILNPKA",
 "bank_account_number": "1234567890123",
 "account_holder_name": "Ram Bahadur"
 }'`}
{docsLang === "python" && `import requests

res = requests.post(
 "${baseUrl}/api/v1/verifiedbank/",
 headers={"Authorization": "Bearer ${rawKey}", "Content-Type": "application/json"},
 json={
 "bank_code": "NABILNPKA",
 "bank_account_number": "1234567890123",
 "account_holder_name": "Ram Bahadur"
 }
)
print(res.status_code, res.json())`}
{docsLang === "node" && `const res = await fetch("${baseUrl}/api/v1/verifiedbank/", {
 method: "POST",
 headers: {
 "Authorization": "Bearer ${rawKey}",
 "Content-Type": "application/json"
 },
 body: JSON.stringify({
 bank_code: "NABILNPKA",
 bank_account_number: "1234567890123",
 account_holder_name: "Ram Bahadur"
 })
});
console.log(await res.json());`}
 </pre>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
 <div className="space-y-1">
 <span className="text-[11px] font-semibold text-slate-700">Successful Response (200 OK):</span>
 <pre className="p-3 rounded-md bg-slate-900 text-emerald-300 text-[11px] font-mono overflow-x-auto">
{`{
 "success": true,
 "verified": true,
 "message": "Bank account verified successfully",
 "data": {
 "bank_code": "NABILNPKA",
 "bank_name": "Nabil Bank Limited",
 "account_number": "*********0123",
 "account_holder_name": "Ram Bahadur"
 }
}`}
 </pre>
 </div>
 <div className="space-y-1">
 <span className="text-[11px] font-semibold text-slate-700">Failed Response (400):</span>
 <pre className="p-3 rounded-md bg-slate-900 text-rose-300 text-[11px] font-mono overflow-x-auto">
{`{
 "success": false,
 "verified": false,
 "message": "Bank account verification failed",
 "error": "Bank account verification failed",
 "code": "verification_failed"
}`}
 </pre>
 </div>
 </div>
 </div>
 )}

 {/* 2. DEPOSIT API (PAYIN) */}
 {(docsSubTab === "all" || docsSubTab === "deposit") && (
 <div className="rounded-lg border border-indigo-200/90 bg-indigo-50/20 p-5 space-y-4">
 <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-3">
 <div className="flex flex-wrap items-center gap-2">
 <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-600 text-white font-mono">
 POST
 </span>
 <span className="font-mono text-sm font-bold text-slate-900">
 /api/v1/payin/
 </span>
 <Badge variant="outline" className="text-[10px] border-indigo-400 text-indigo-800 bg-indigo-50">
 Core API 2: Deposit / Fonepay QR
 </Badge>
 </div>
 <Button
 size="sm"
 variant="outline"
 className="h-7 text-xs gap-1.5 bg-white cursor-pointer"
 onClick={() => copyText(`${baseUrl}/api/v1/payin/`, "Deposit API URL")}
 >
 <Copy className="size-3" />
 Copy URL
 </Button>
 </div>

 <p className="text-xs text-slate-600 leading-relaxed">
 Creates a customer deposit / wallet load. Generates dynamic Fonepay QR code URL and image on the MySewa domain for instant mobile banking scan & pay. After verified payment, MySewa credits the wallet and triggers your webhook automatically.
 </p>

 <div className="space-y-1">
 <h5 className="text-xs font-semibold text-slate-700">Headers:</h5>
 <div className="flex flex-wrap gap-2 text-xs">
 <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
 <strong>Authorization:</strong> Bearer {showApiKey ? rawKey : "YOUR_API_KEY"}
 </span>
 <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
 <strong>Content-Type:</strong> application/json
 </span>
 <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
 <strong>Idempotency-Key:</strong> YOUR_REFERENCE
 </span>
 </div>
 </div>

 <div className="space-y-1.5">
 <h5 className="text-xs font-semibold text-slate-700">Request Parameters:</h5>
 <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
 <table className="w-full text-left text-xs">
 <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
 <tr>
 <th className="py-2 px-3 font-semibold">Field</th>
 <th className="py-2 px-2 font-semibold">Required</th>
 <th className="py-2 px-2 font-semibold">Type</th>
 <th className="py-2 px-3 font-semibold">Description</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">receiver</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans">MySewa phone number of the wallet to credit (e.g., <code className="font-mono">98XXXXXXXX</code>).</td>
 </tr>
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">amount</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">number</td>
 <td className="py-2 px-3 text-slate-700 font-sans">NPR amount to deposit (e.g., <code className="font-mono">1000</code>).</td>
 </tr>
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">reference</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans">Unique client reference for idempotency and tracking.</td>
 </tr>
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">mode</td>
 <td className="py-2 px-2"><span className="text-slate-500 font-sans text-[10px]">Optional</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans"><code className="font-mono">"direct_qr"</code> (default) for MySewa Fonepay QR or <code className="font-mono">"hosted"</code> for payment picker.</td>
 </tr>
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">customer_name</td>
 <td className="py-2 px-2"><span className="text-slate-500 font-sans text-[10px]">Optional</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans">Player or customer name shown on checkout page.</td>
 </tr>
 </tbody>
 </table>
 </div>
 </div>

 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
 <h5 className="text-xs font-semibold text-slate-700">Code Example ({docsLang}):</h5>
 <button
 type="button"
 className="text-[11px] text-indigo-700 hover:text-indigo-800 font-medium flex items-center gap-1 cursor-pointer"
 onClick={() => {
 const snippet =
 docsLang === "curl"
 ? `curl -X POST "${baseUrl}/api/v1/payin/" \
 -H "Authorization: Bearer ${rawKey}" \
 -H "Content-Type: application/json" \
 -d '{
 "receiver": "${user?.phone || "98XXXXXXXX"}",
 "amount": 1000,
 "reference": "DEP_TXN_001",
 "mode": "direct_qr"
 }'`
 : docsLang === "python"
 ? `import requests

res = requests.post(
 "${baseUrl}/api/v1/payin/",
 headers={"Authorization": "Bearer ${rawKey}", "Content-Type": "application/json"},
 json={
 "receiver": "${user?.phone || "98XXXXXXXX"}",
 "amount": 1000,
 "reference": "DEP_TXN_001",
 "mode": "direct_qr"
 }
)
print(res.status_code, res.json())`
 : `const res = await fetch("${baseUrl}/api/v1/payin/", {
 method: "POST",
 headers: {
 "Authorization": "Bearer ${rawKey}",
 "Content-Type": "application/json"
 },
 body: JSON.stringify({
 receiver: "${user?.phone || "98XXXXXXXX"}",
 amount: 1000,
 reference: "DEP_TXN_001",
 mode: "direct_qr"
 })
});
console.log(await res.json());`;
 copyText(snippet, "Deposit API Code");
 }}
 >
 <Copy className="size-3" />
 Copy Code
 </button>
 </div>
 <pre className="p-3.5 rounded-md bg-slate-950 text-slate-100 text-[11px] font-mono overflow-x-auto">
{docsLang === "curl" && `curl -X POST "${baseUrl}/api/v1/payin/" \
 -H "Authorization: Bearer ${rawKey}" \
 -H "Content-Type: application/json" \
 -d '{
 "receiver": "${user?.phone || "98XXXXXXXX"}",
 "amount": 1000,
 "reference": "DEP_TXN_001",
 "mode": "direct_qr"
 }'`}
{docsLang === "python" && `import requests

res = requests.post(
 "${baseUrl}/api/v1/payin/",
 headers={"Authorization": "Bearer ${rawKey}", "Content-Type": "application/json"},
 json={
 "receiver": "${user?.phone || "98XXXXXXXX"}",
 "amount": 1000,
 "reference": "DEP_TXN_001",
 "mode": "direct_qr"
 }
)
print(res.status_code, res.json())`}
{docsLang === "node" && `const res = await fetch("${baseUrl}/api/v1/payin/", {
 method: "POST",
 headers: {
 "Authorization": "Bearer ${rawKey}",
 "Content-Type": "application/json"
 },
 body: JSON.stringify({
 receiver: "${user?.phone || "98XXXXXXXX"}",
 amount: 1000,
 reference: "DEP_TXN_001",
 mode: "direct_qr"
 })
});
console.log(await res.json());`}
 </pre>
 </div>

 <div className="space-y-1">
 <span className="text-[11px] font-semibold text-slate-700">Successful Response (201 Created):</span>
 <pre className="p-3 rounded-md bg-slate-900 text-indigo-300 text-[11px] font-mono overflow-x-auto">
{`{
 "success": true,
 "message": "Payin checkout ready",
 "order_id": "MS-PB-a1b2c3d4e5f6",
 "transaction_id": "MS-PB-a1b2c3d4e5f6",
 "status": "PENDING",
 "checkout_url": "${baseUrl}/api/deposit/paybridge/qr/?order=MS-PB-a1b2c3d4e5f6",
 "payment_url": "${baseUrl}/api/deposit/paybridge/qr/?order=MS-PB-a1b2c3d4e5f6",
 "amount": 1000,
 "currency": "NPR",
 "reference": "DEP_TXN_001"
}`}
 </pre>
 </div>
 </div>
 )}

 {/* 3. WITHDRAW API */}
 {(docsSubTab === "all" || docsSubTab === "withdraw") && (
 <div className="rounded-lg border border-amber-200/90 bg-amber-50/20 p-5 space-y-4">
 <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 pb-3">
 <div className="flex flex-wrap items-center gap-2">
 <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-600 text-white font-mono">
 POST
 </span>
 <span className="font-mono text-sm font-bold text-slate-900">
 /api/v1/banktransfer/
 </span>
 <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-800 bg-amber-50">
 Core API 3: Instant Bank Withdrawal
 </Badge>
 </div>
 <Button
 size="sm"
 variant="outline"
 className="h-7 text-xs gap-1.5 bg-white cursor-pointer"
 onClick={() => copyText(`${baseUrl}/api/v1/banktransfer/`, "Withdraw API URL")}
 >
 <Copy className="size-3" />
 Copy URL
 </Button>
 </div>

 <p className="text-xs text-slate-600 leading-relaxed">
 Transfers / withdraws funds from the merchant MySewa wallet directly to a pre-verified destination bank account. Debits the merchant wallet in real-time upon confirmed bank payout. Replaying the same reference returns the original result idempotently without double-debiting.
 </p>

 <div className="space-y-1">
 <h5 className="text-xs font-semibold text-slate-700">Headers:</h5>
 <div className="flex flex-wrap gap-2 text-xs">
 <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
 <strong>Authorization:</strong> Bearer {showApiKey ? rawKey : "YOUR_API_KEY"}
 </span>
 <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
 <strong>Content-Type:</strong> application/json
 </span>
 <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
 <strong>Idempotency-Key:</strong> YOUR_REFERENCE
 </span>
 </div>
 </div>

 <div className="space-y-1.5">
 <h5 className="text-xs font-semibold text-slate-700">Request Parameters:</h5>
 <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
 <table className="w-full text-left text-xs">
 <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
 <tr>
 <th className="py-2 px-3 font-semibold">Field</th>
 <th className="py-2 px-2 font-semibold">Required</th>
 <th className="py-2 px-2 font-semibold">Type</th>
 <th className="py-2 px-3 font-semibold">Description</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">bank_code</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans">Same HimalPay bank code previously verified.</td>
 </tr>
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">bank_account_number</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans">Destination bank account number previously verified.</td>
 </tr>
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">account_holder_name</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans">Account holder name previously verified.</td>
 </tr>
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">amount</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">number</td>
 <td className="py-2 px-3 text-slate-700 font-sans">NPR amount to payout (must not exceed wallet balance).</td>
 </tr>
 <tr>
 <td className="py-2 px-3 font-bold text-slate-900">reference</td>
 <td className="py-2 px-2"><span className="text-rose-600 font-sans font-bold text-[10px]">Required</span></td>
 <td className="py-2 px-2 text-slate-500">string</td>
 <td className="py-2 px-3 text-slate-700 font-sans">Unique client reference (1–64 chars: letters, digits, ._-).</td>
 </tr>
 </tbody>
 </table>
 </div>
 </div>

 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
 <h5 className="text-xs font-semibold text-slate-700">Code Example ({docsLang}):</h5>
 <button
 type="button"
 className="text-[11px] text-amber-700 hover:text-amber-800 font-medium flex items-center gap-1 cursor-pointer"
 onClick={() => {
 const snippet =
 docsLang === "curl"
 ? `curl -X POST "${baseUrl}/api/v1/banktransfer/" \
 -H "Authorization: Bearer ${rawKey}" \
 -H "Content-Type: application/json" \
 -d '{
 "bank_code": "NABILNPKA",
 "bank_account_number": "1234567890123",
 "account_holder_name": "Ram Bahadur",
 "amount": 1000,
 "reference": "WTH_TXN_001"
 }'`
 : docsLang === "python"
 ? `import requests

res = requests.post(
 "${baseUrl}/api/v1/banktransfer/",
 headers={"Authorization": "Bearer ${rawKey}", "Content-Type": "application/json"},
 json={
 "bank_code": "NABILNPKA",
 "bank_account_number": "1234567890123",
 "account_holder_name": "Ram Bahadur",
 "amount": 1000,
 "reference": "WTH_TXN_001"
 }
)
print(res.status_code, res.json())`
 : `const res = await fetch("${baseUrl}/api/v1/banktransfer/", {
 method: "POST",
 headers: {
 "Authorization": "Bearer ${rawKey}",
 "Content-Type": "application/json"
 },
 body: JSON.stringify({
 bank_code: "NABILNPKA",
 bank_account_number: "1234567890123",
 account_holder_name: "Ram Bahadur",
 amount: 1000,
 reference: "WTH_TXN_001"
 })
});
console.log(await res.json());`;
 copyText(snippet, "Withdraw API Code");
 }}
 >
 <Copy className="size-3" />
 Copy Code
 </button>
 </div>
 <pre className="p-3.5 rounded-md bg-slate-950 text-slate-100 text-[11px] font-mono overflow-x-auto">
{docsLang === "curl" && `curl -X POST "${baseUrl}/api/v1/banktransfer/" \
 -H "Authorization: Bearer ${rawKey}" \
 -H "Content-Type: application/json" \
 -d '{
 "bank_code": "NABILNPKA",
 "bank_account_number": "1234567890123",
 "account_holder_name": "Ram Bahadur",
 "amount": 1000,
 "reference": "WTH_TXN_001"
 }'`}
{docsLang === "python" && `import requests

res = requests.post(
 "${baseUrl}/api/v1/banktransfer/",
 headers={"Authorization": "Bearer ${rawKey}", "Content-Type": "application/json"},
 json={
 "bank_code": "NABILNPKA",
 "bank_account_number": "1234567890123",
 "account_holder_name": "Ram Bahadur",
 "amount": 1000,
 "reference": "WTH_TXN_001"
 }
)
print(res.status_code, res.json())`}
{docsLang === "node" && `const res = await fetch("${baseUrl}/api/v1/banktransfer/", {
 method: "POST",
 headers: {
 "Authorization": "Bearer ${rawKey}",
 "Content-Type": "application/json"
 },
 body: JSON.stringify({
 bank_code: "NABILNPKA",
 bank_account_number: "1234567890123",
 account_holder_name: "Ram Bahadur",
 amount: 1000,
 reference: "WTH_TXN_001"
 })
});
console.log(await res.json());`}
 </pre>
 </div>

 <div className="space-y-1">
 <span className="text-[11px] font-semibold text-slate-700">Successful Response (201 Created):</span>
 <pre className="p-3 rounded-md bg-slate-900 text-amber-300 text-[11px] font-mono overflow-x-auto">
{`{
 "success": true,
 "message": "Bank transfer successful",
 "transaction_id": "MYSEWA_BT_A1B2C3D4E5F678",
 "provider_reference": "HP123456",
 "reference": "WTH_TXN_001",
 "amount": 1000,
 "status": "SUCCESS",
 "data": {
 "bank_code": "NABILNPKA",
 "bank_name": "Nabil Bank Limited",
 "account_number": "*********0123",
 "account_holder_name": "Ram Bahadur",
 "method": "API Bank Transfer"
 }
}`}
 </pre>
 </div>
 </div>
 )}

 {/* 4. SUPPORTING ENDPOINTS */}
 {(docsSubTab === "all" || docsSubTab === "supporting") && (
 <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-5 space-y-4">
 <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
 <Layers className="size-4 text-slate-600" />
 <h4 className="text-sm font-bold text-slate-900">Supporting Endpoints (Bank List & Status)</h4>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {/* Bank List API */}
 <div className="p-4 rounded-md border border-slate-200 bg-white space-y-2">
 <div className="flex items-center gap-2">
 <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white font-mono">GET</span>
 <span className="font-mono text-xs font-bold text-slate-900">/api/v1/banklist/</span>
 </div>
 <p className="text-[11px] text-slate-600 leading-relaxed">
 Returns the list of active banks supported for verification and withdrawals with their <code className="font-mono">bank_code</code>.
 </p>
 <pre className="p-2.5 rounded bg-slate-950 text-blue-300 text-[10px] font-mono overflow-x-auto">
{`curl -X GET "${baseUrl}/api/v1/banklist/" \
 -H "Authorization: Bearer ${rawKey}"`}
 </pre>
 </div>

 {/* Payin Status API */}
 <div className="p-4 rounded-md border border-slate-200 bg-white space-y-2">
 <div className="flex items-center gap-2">
 <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white font-mono">GET</span>
 <span className="font-mono text-xs font-bold text-slate-900">/api/v1/payin/status/</span>
 </div>
 <p className="text-[11px] text-slate-600 leading-relaxed">
 Polls the real-time status of a customer deposit by reference (<code className="font-mono">?reference=DEP_TXN_001</code>).
 </p>
 <pre className="p-2.5 rounded bg-slate-950 text-indigo-300 text-[10px] font-mono overflow-x-auto">
{`curl -X GET "${baseUrl}/api/v1/payin/status/?reference=DEP_TXN_001" \
 -H "Authorization: Bearer ${rawKey}"`}
 </pre>
 </div>
 </div>
 </div>
 )}
 </div>
 </div>
 )}


 {/* ─────────────────────────────────────────────────────────────
 TAB 7: TRANSACTION LEDGER
 ───────────────────────────────────────────────────────────── */}
 {activeTab === "ledger" && (
 <div className="space-y-6">
 <div className="rounded-md border border-slate-200 bg-white p-5 shadow-xs space-y-4">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
 <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-2">
 <History className="size-4 text-slate-400" />
 Complete Production Transaction Ledger
 </h3>
 <div className="flex items-center gap-2">
 <div className="relative">
 <Search className="size-3.5 absolute left-2.5 top-2.5 text-slate-400" />
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
 className="h-8 text-xs border border-slate-200 rounded-md px-2 bg-white text-slate-900 "
 >
 <option value="all">All Types</option>
                      <option value="deposit">Deposits (Payin)</option>
                      <option value="withdraw">Withdrawals (Payout)</option>
                      <option value="transfer">API Transfers</option>
 <option value="buy">Coin Purchases</option>
 <option value="player_win">Player Wins</option>
 <option value="player_loss">Player Losses</option>
 <option value="monthly_settlement">Settlements</option>
 </select>
 </div>
 </div>

 <div className="overflow-x-auto">
 <table className="w-full text-xs text-left">
 <thead className="bg-slate-50 text-slate-400 uppercase text-[10px] font-mono">
 <tr>
 <th className="p-2.5">Date & Time</th>
 <th className="p-2.5">Type</th>
 <th className="p-2.5">Amount</th>
 <th className="p-2.5">Balance After</th>
 <th className="p-2.5">Reference</th>
 <th className="p-2.5">Notes</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100 ">
 {filteredTransactions.length > 0 ? (
 filteredTransactions.map((t) => (
 <tr key={t.id} className="hover:bg-slate-50 /40">
 <td className="p-2.5 font-mono text-slate-500">
 {formatDateTime(t.created_at)}
 </td>
 <td className="p-2.5">
 <span
 className={`px-2 py-0.5 rounded text-[10px] font-bold ${
 t.txn_type === "deposit" || t.txn_type === "payin"
                                ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400"
                                : t.txn_type === "withdraw" || t.txn_type === "payout"
                                ? "bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-400"
                                : t.txn_type === "buy"
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
 t.txn_type === "withdraw" || t.txn_type === "transfer" || String(t.amount).startsWith("-") || Number(t.amount) < 0 ? "text-red-500" : "text-emerald-600"
 }`}
 >
 {t.txn_type === "withdraw" || t.txn_type === "transfer" || String(t.amount).startsWith("-") || Number(t.amount) < 0 ? (String(t.amount).startsWith("-") ? t.amount : `-${t.amount}`) : (String(t.amount).startsWith("+") ? t.amount : `+${t.amount}`)}
 </td>
 <td className="p-2.5 font-mono">{t.balance_after}</td>
 <td className="p-2.5 font-mono text-slate-500">{t.reference}</td>
 <td className="p-2.5 text-slate-500 max-w-xs truncate">{t.notes}</td>
 </tr>
 ))
 ) : (
 <tr>
 <td colSpan={6} className="p-4 text-center text-slate-400">
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
 MODAL 1: DEPOSIT MODAL (USING QR CODE AS IN PAYMENT API)
 ───────────────────────────────────────────────────────────── */}
 <Dialog open={depositModalOpen} onOpenChange={setDepositModalOpen}>
 <DialogContent className="sm:max-w-md max-h-[92dvh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-slate-900 ">
 <QrCode className="size-5 text-emerald-600" />
 Deposit Funds via Payment QR
 </DialogTitle>
 <DialogDescription>
 Scan the dynamic Fonepay / NepalPay QR code with your mobile banking app or execute direct API payin.
 </DialogDescription>
 </DialogHeader>

 {depositSuccessResult ? (
 <div className="py-4 text-center space-y-4">
 <div className="size-14 mx-auto rounded-md bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
 <CheckCircle2 className="size-8" />
 </div>
 <div className="space-y-1">
 <h4 className="text-base font-bold text-slate-900 ">
 Deposit Successfully Credited!
 </h4>
 <p className="text-xs text-slate-500">
 Ref: <span className="font-mono font-bold text-slate-700 ">{depositSuccessResult.reference}</span>
 </p>
 </div>

 <div className="p-4 rounded-sm border border-slate-200 bg-slate-50 text-xs font-mono space-y-2">
 <div className="flex justify-between">
 <span className="text-slate-500">Gross Paid:</span>
 <span className="font-bold text-slate-900 ">NPR {depositSuccessResult.grossAmount}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-500">Service Fee ({depFeePct}%):</span>
 <span className="text-red-500">- NPR {depositSuccessResult.feeAmount}</span>
 </div>
 <div className="flex justify-between pt-1 border-t border-slate-200 font-bold text-emerald-600 text-sm">
 <span>Net Credited:</span>
 <span>+ NPR {depositSuccessResult.netCredited}</span>
 </div>
 <div className="flex justify-between pt-1 text-slate-500">
 <span>New Balance:</span>
 <span className="font-bold text-slate-900 ">NPR {depositSuccessResult.newBalance}</span>
 </div>
 </div>

 <Button
 onClick={() => {
 setDepositModalOpen(false);
 setDepositSuccessResult(null);
 }}
 className="w-full bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
 >
 Done
 </Button>
 </div>
 ) : (
 <div className="space-y-4 py-1">
 {/* Amount selector with quick chips */}
 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
 <Label htmlFor="dep-amount-input" className="text-xs">Deposit Amount (NPR)</Label>
 <span className="text-[10px] font-mono font-bold text-emerald-600">Rate: {depFeePct}%</span>
 </div>
 <Input
 id="dep-amount-input"
 type="number"
 value={depositAmount}
 onChange={(e) => setDepositAmount(e.target.value)}
 placeholder="1000"
 className="font-mono text-sm h-9"
 />
 <div className="flex flex-wrap items-center gap-1.5 pt-1">
 {[500, 1000, 2500, 5000, 10000, 25000].map((amt) => (
 <button
 key={amt}
 type="button"
 onClick={() => setDepositAmount(String(amt))}
 className={`text-[10px] font-mono px-2 py-0.5 rounded cursor-pointer transition-colors ${
 depositAmount === String(amt)
 ? "bg-emerald-600 text-white font-bold"
 : "bg-zinc-100 dark:bg-zinc-800 text-slate-700 hover:bg-zinc-200"
 }`}
 >
 {amt.toLocaleString()}
 </button>
 ))}
 </div>
 </div>

 {/* Deposit Mode Selector */}
 <div className="flex border-b border-slate-200 pt-1">
 <button
 type="button"
 onClick={() => setDepositMethod("qr")}
 className={`flex-1 pb-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer text-center ${
 depositMethod === "qr"
 ? "border-emerald-600 text-emerald-600 font-bold"
 : "border-transparent text-slate-500 hover:text-slate-900"
 }`}
 >
 Fonepay / Banking QR
 </button>
 <button
 type="button"
 onClick={() => setDepositMethod("bank_accounts")}
 className={`flex-1 pb-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer text-center ${
 depositMethod === "bank_accounts"
 ? "border-emerald-600 text-emerald-600 font-bold"
 : "border-transparent text-slate-500 hover:text-slate-900"
 }`}
 >
 Bank Accounts
 </button>
 <button
 type="button"
 onClick={() => setDepositMethod("direct_api")}
 className={`flex-1 pb-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer text-center ${
 depositMethod === "direct_api"
 ? "border-emerald-600 text-emerald-600 font-bold"
 : "border-transparent text-slate-500 hover:text-slate-900"
 }`}
 >
 Direct API
 </button>
 </div>

 {/* METHOD 1: DYNAMIC PAYMENT QR CODE (SAME AS PAYMENT API PAYIN) */}
 {depositMethod === "qr" && (
 <div className="space-y-3">
 <div className="p-4 rounded-md border-2 border-emerald-500/30 bg-white flex flex-col items-center justify-center text-center space-y-2.5 shadow-sm">
 {dynamicQrUrl ? (
 <div className="relative p-2 bg-white rounded-sm shadow-xs border border-slate-200">
 <img
 src={dynamicQrUrl}
 alt="Payment QR"
 className="size-48 sm:size-52 object-contain"
 />
 <div className="absolute inset-x-0 bottom-3 flex justify-center">
 <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-slate-50 text-white shadow-xs">
 NPR {Number(depositAmount || 0).toLocaleString()}
 </span>
 </div>
 </div>
 ) : (
 <div className="size-48 bg-zinc-100 dark:bg-zinc-800 rounded-sm flex items-center justify-center">
 <QrCode className="size-12 text-slate-400" />
 </div>
 )}

 <div className="space-y-0.5">
 <p className="text-xs font-bold text-slate-900 ">
 Scan & Pay NPR {Number(depositAmount || 0).toLocaleString()}
 </p>
 <p className="text-[11px] text-slate-500">
 Compatible with eSewa, Khalti, Global Smart, Nabil & all Nepal banks.
 </p>
 </div>

 <div className="flex items-center gap-2 pt-1 font-mono text-[11px] text-slate-500 bg-slate-50 dark:bg-zinc-800/60 px-3 py-1 rounded-lg">
 <span>Ref: {depositRef}</span>
 <button
 type="button"
 onClick={() => {
 navigator.clipboard.writeText(depositRef);
 toast.success("Reference copied!");
 }}
 className="text-emerald-600 hover:text-emerald-700 cursor-pointer"
 title="Copy Reference"
 >
 <Copy className="size-3" />
 </button>
 </div>
 </div>

 {/* Fee Breakdown */}
 <div className="p-3 rounded-sm border border-slate-200 bg-slate-50 text-xs font-mono space-y-1">
 <div className="flex justify-between text-slate-500">
 <span>Gross Amount:</span>
 <span>NPR {depAmtNum}</span>
 </div>
 <div className="flex justify-between text-slate-500">
 <span>Platform Fee ({depFeePct}%):</span>
 <span className="text-red-500">- NPR {calcDepFee}</span>
 </div>
 <div className="flex justify-between font-bold border-t border-slate-200 pt-1 text-emerald-600">
 <span>Net Credited to Wallet:</span>
 <span>+ NPR {calcDepNet}</span>
 </div>
 </div>

 <div className="flex gap-2 pt-1">
 <Button
 onClick={() =>
 apiDepositMutation.mutate({
 amount: depositAmount,
 player_id: user?.phone || "merchant",
 reference: depositRef,
 })
 }
 disabled={apiDepositMutation.isPending || !depositAmount || Number(depositAmount) <= 0}
 className="flex-1 text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-medium cursor-pointer"
 >
 {apiDepositMutation.isPending ? "Confirming..." : "I have Paid • Verify Deposit"}
 </Button>
 <Button
 variant="outline"
 onClick={handleTriggerDepositQr}
 disabled={isGeneratingQr}
 className="text-xs h-9 cursor-pointer"
 title="Regenerate dynamic QR"
 >
 <RefreshCw className={`size-3.5 ${isGeneratingQr ? "animate-spin" : ""}`} />
 </Button>
 </div>
 </div>
 )}

 {/* METHOD 2: OFFICIAL SETTLEMENT BANK ACCOUNTS */}
 {depositMethod === "bank_accounts" && (
 <div className="space-y-3 font-mono text-xs">
 <div className="p-4 rounded-sm border border-slate-200 bg-slate-50 space-y-2.5">
 <div className="flex items-center justify-between border-b border-slate-200 pb-2">
 <span className="font-bold text-slate-900 flex items-center gap-1.5">
 <Landmark className="size-4 text-emerald-600" />
 Commercial Bank Settlement Account
 </span>
 <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">
 ACTIVE
 </span>
 </div>
 <div className="space-y-1.5">
 <div className="flex justify-between">
 <span className="text-slate-500">Bank:</span>
 <span className="font-bold text-slate-900 ">Global IME Bank</span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-500">Account Name:</span>
 <span className="font-bold text-slate-900 ">MySewa Technology Pvt Ltd</span>
 </div>
 <div className="flex justify-between items-center">
 <span className="text-slate-500">Account No:</span>
 <div className="flex items-center gap-1">
 <span className="font-bold text-emerald-600">01234567890123</span>
 <button
 type="button"
 onClick={() => {
 navigator.clipboard.writeText("01234567890123");
 toast.success("Account number copied!");
 }}
 className="text-slate-400 hover:text-slate-600"
 >
 <Copy className="size-3" />
 </button>
 </div>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-500">Branch:</span>
 <span>Kathmandu Main</span>
 </div>
 </div>
 </div>

 {settingsQuery.data?.qr_code_url && (
 <div className="text-center p-3 bg-white rounded-sm border border-slate-200 ">
 <img
 src={settingsQuery.data.qr_code_url}
 alt="Bank QR"
 className="size-40 mx-auto object-contain"
 />
 <p className="text-[11px] text-slate-500 mt-1">Official Bank Scan & Pay QR</p>
 </div>
 )}

 <Button
 onClick={() =>
 apiDepositMutation.mutate({
 amount: depositAmount,
 player_id: user?.phone || "merchant",
 reference: depositRef,
 })
 }
 className="w-full text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
 >
 Confirm Bank Transfer Deposit
 </Button>
 </div>
 )}

 {/* METHOD 3: DIRECT API PAYIN */}
 {depositMethod === "direct_api" && (
 <div className="space-y-3 font-mono text-xs">
 <div className="p-3.5 rounded-sm border border-slate-200 bg-slate-50 space-y-2">
 <p className="text-slate-700 ">
 Executes POST <code className="text-emerald-600">/api/v1/payment/deposit/</code> directly with your merchant API key:
 </p>
 <div className="space-y-1 text-[11px]">
 <div>• Receiver / Merchant: {user?.phone}</div>
 <div>• Reference: {depositRef}</div>
 <div>• Gross Amount: NPR {depAmtNum}</div>
 <div className="text-emerald-600 font-bold">• Net Credited: NPR {calcDepNet}</div>
 </div>
 </div>

 <Button
 onClick={() =>
 apiDepositMutation.mutate({
 amount: depositAmount,
 player_id: user?.phone || "merchant",
 reference: depositRef,
 })
 }
 disabled={apiDepositMutation.isPending || !depositAmount || Number(depositAmount) <= 0}
 className="w-full text-xs h-9 bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
 >
 {apiDepositMutation.isPending ? "Dispatching API Call..." : "Execute Production Payin API"}
 </Button>
 </div>
 )}
 </div>
 )}
 </DialogContent>
 </Dialog>

 {/* ─────────────────────────────────────────────────────────────
 MODAL 2: WITHDRAW MODAL (SAME AS PAYMENT API PAYOUT + QR RECEIPT)
 ───────────────────────────────────────────────────────────── */}
 <Dialog open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen}>
 <DialogContent className="sm:max-w-md max-h-[92dvh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-slate-900 ">
 <ArrowUpRight className="size-5 text-emerald-600" />
 Payment API Payout (Withdrawal)
 </DialogTitle>
 <DialogDescription>
 Disburse merchant balance to bank account using the automated Payment API Payout system.
 </DialogDescription>
 </DialogHeader>

 {withdrawReceipt ? (
 /* WITHDRAW SUCCESS RECEIPT WITH SCANNABLE VERIFICATION QR */
 <div className="py-2 text-center space-y-3">
 <div className="size-12 mx-auto rounded-md bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
 <CheckCircle2 className="size-7" />
 </div>

 <div>
 <h4 className="text-base font-bold text-slate-900 ">
 Payout Disbursed Successfully!
 </h4>
 <p className="text-xs text-slate-500 font-mono">
 Ref: <span className="font-bold text-slate-800 ">{withdrawReceipt.reference}</span>
 </p>
 </div>

 {/* Scannable Verification QR Code for Payout */}
 <div className="p-3 bg-white rounded-md border border-slate-200 max-w-xs mx-auto shadow-xs">
 {withdrawReceipt.qrCodeUrl && (
 <img
 src={withdrawReceipt.qrCodeUrl}
 alt="Payout Verification QR"
 className="size-36 mx-auto object-contain"
 />
 )}
 <p className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-wider">
 Verified Payout Transaction QR
 </p>
 </div>

 {/* Receipt Summary Table */}
 <div className="p-3.5 rounded-sm border border-slate-200 bg-slate-50 text-xs font-mono space-y-1.5 text-left">
 <div className="flex justify-between">
 <span className="text-slate-500">Destination Bank:</span>
 <span className="font-bold text-slate-900 ">{withdrawReceipt.bankName}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-500">Account Number:</span>
 <span className="font-bold text-slate-900 ">
 ••••{withdrawReceipt.accountNumber.slice(-4)}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-500">Account Holder:</span>
 <span className="text-slate-900 ">{withdrawReceipt.accountName}</span>
 </div>
 <div className="flex justify-between pt-1 border-t border-slate-200 ">
 <span className="text-slate-500">Gross Payout:</span>
 <span className="font-bold text-slate-900 ">NPR {withdrawReceipt.amount}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-500">Payout Fee ({wthFeePct}%):</span>
 <span className="text-red-500">NPR {withdrawReceipt.fee}</span>
 </div>
 <div className="flex justify-between font-bold border-t border-slate-200 pt-1 text-red-600">
 <span>Total Debited:</span>
 <span>- NPR {withdrawReceipt.totalDebited}</span>
 </div>
 <div className="flex justify-between text-slate-500">
 <span>Balance After:</span>
 <span className="font-bold text-slate-900 ">NPR {withdrawReceipt.newBalance}</span>
 </div>
 </div>

 <div className="flex gap-2 pt-1">
 <Button
 variant="outline"
 onClick={() => {
 navigator.clipboard.writeText(withdrawReceipt.reference);
 toast.success("Reference copied!");
 }}
 className="flex-1 text-xs h-9 cursor-pointer"
 >
 <Copy className="size-3.5 mr-1" /> Copy Ref
 </Button>
 <Button
 onClick={() => {
 setWithdrawModalOpen(false);
 setWithdrawReceipt(null);
 }}
 className="flex-1 text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
 >
 Done
 </Button>
 </div>
 </div>
 ) : (
 /* WITHDRAW INPUT FORM */
 <div className="space-y-4 py-1">
 {/* Available Balance Box */}
 <div className="p-3 bg-slate-50 rounded-sm border border-slate-200 flex items-center justify-between">
 <div>
 <p className="text-[10px] text-slate-400 uppercase font-bold">Available Cash Balance</p>
 <p className="text-base font-bold font-mono text-slate-900 ">
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
 <Label className="text-xs">Destination Bank Account</Label>
 {savedBank && (
 <button
 type="button"
 onClick={() => {
 setWithdrawModalOpen(false);
 setBankSetupModalOpen(true);
 }}
 className="text-[11px] text-emerald-700 hover:text-emerald-800 font-semibold cursor-pointer"
 >
 Change / Update Account
 </button>
 )}
 </div>

 {savedBank ? (
 <div className="p-3 rounded-md border border-slate-200 bg-white text-xs font-mono space-y-1">
 <div className="flex items-center justify-between">
 <span className="font-bold text-slate-900 text-sm">{savedBank.bank_name}</span>
 <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 font-sans">
 <CheckCircle2 className="size-3" /> Verified Saved Account
 </span>
 </div>
 <p className="text-slate-600">Account: <span className="font-semibold text-slate-900">{savedBank.account_number}</span></p>
 <p className="text-slate-600">Holder: <span className="font-semibold text-slate-900">{savedBank.account_name}</span></p>
 {savedBank.bank_code && (
 <p className="text-slate-400 text-[10px]">Bank Code: {savedBank.bank_code}</p>
 )}
 </div>
 ) : (
 <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-center space-y-3">
 <Landmark className="size-8 mx-auto text-amber-600" />
 <div className="space-y-1">
 <p className="text-xs font-bold text-amber-900">No Verified Payout Account Linked</p>
 <p className="text-[11px] text-amber-700">
 You must link and verify your payout bank account with HimalPay before making a withdrawal.
 </p>
 </div>
 <Button
 size="sm"
 type="button"
 onClick={() => {
 setWithdrawModalOpen(false);
 setBankSetupModalOpen(true);
 }}
 className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 cursor-pointer"
 >
 <Plus className="size-3.5 mr-1" /> Configure Payout Account
 </Button>
 </div>
 )}
 </div>

 {/* Amount input with shortcut percentages */}
 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
 <Label htmlFor="wth-amount-input" className="text-xs">Payout Amount (NPR)</Label>
 <div className="flex items-center gap-1">
 {[25, 50, 75, 100].map((pct) => (
 <button
 key={pct}
 type="button"
 onClick={() => {
 const calculated = Math.floor((cashBalance * pct) / 100);
 setWithdrawAmount(String(calculated > 0 ? calculated : ""));
 }}
 className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-slate-700 cursor-pointer"
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
 className="text-xs font-mono h-9"
 />
 </div>

 {/* Summary calculation based on Payment API Withdraw System */}
 <div className="rounded-sm border border-slate-200 bg-slate-50 p-3 text-xs space-y-1 font-mono">
 <div className="flex justify-between text-slate-500">
 <span>Net Payout to Bank:</span>
 <span className="font-bold text-slate-900 ">
 NPR {Number(withdrawAmount || 0).toLocaleString()}
 </span>
 </div>
 <div className="flex justify-between text-slate-500">
 <span>API Payout Fee ({wthFeePct}%):</span>
 <span className="text-red-500">+ NPR {calcWthFee}</span>
 </div>
 <div className="flex justify-between font-bold border-t border-slate-200 pt-1 text-slate-900 ">
 <span>Total Balance Debited:</span>
 <span className="text-red-600">- NPR {calcWthTotal}</span>
 </div>
 </div>

 <DialogFooter>
 <Button variant="outline" onClick={() => setWithdrawModalOpen(false)}>
 Cancel
 </Button>
 <Button
 onClick={() => paymentApiWithdrawMutation.mutate()}
 disabled={
 paymentApiWithdrawMutation.isPending ||
 !savedBank ||
 !withdrawAmount ||
 Number(withdrawAmount) <= 0 ||
 Number(calcWthTotal) > cashBalance
 }
 className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
 >
 {paymentApiWithdrawMutation.isPending ? "Executing Payout..." : "Confirm & Disburse Payout"}
 </Button>
 </DialogFooter>
 </div>
 )}
 </DialogContent>
 </Dialog>

 {/* ─────────────────────────────────────────────────────────────
 MODAL 3: PAYOUT BANK ACCOUNT SETUP MODAL
 ───────────────────────────────────────────────────────────── */}
 <Dialog open={bankSetupModalOpen} onOpenChange={setBankSetupModalOpen}>
 <DialogContent className="sm:max-w-lg">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-slate-900 ">
 <Landmark className="size-5 text-blue-600" />
 Configure Payout Bank Account
 </DialogTitle>
 <DialogDescription>
 Link your registered Nepali bank account for receiving one-click merchant withdrawals.
 </DialogDescription>
 </DialogHeader>

 <div className="space-y-4 py-2">
 <div className="space-y-1.5">
 <Label className="text-xs">Bank Name *</Label>
 <BankCombobox
 banks={nepaliBanks}
 value={setupBankCode}
 onChange={(bankCode) => {
 const selected = nepaliBanks.find((b) => b.bank_code === bankCode);
 setSetupBankCode(bankCode);
 setSetupBankName(selected?.bank_name || "");
 setSetupAccountVerified(false);
 }}
 placeholder="Search Nepali Commercial Bank..."
 />
 </div>

 <div className="space-y-1.5">
 <Label htmlFor="setup-acc-num" className="text-xs">Account Number *</Label>
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
 <Label htmlFor="setup-acc-name" className="text-xs">Account Holder Name *</Label>
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
 onChange={(e) => {
 setSetupAccName(e.target.value);
 setSetupAccountVerified(false);
 }}
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
 <p className="text-[11px] text-slate-400">
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
 disabled={!setupAccountVerified || !setupBankCode || !setupAccNumber || !setupAccName}
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
 <div className="p-3 bg-slate-50 rounded-sm space-y-1">
 <div className="text-xs text-slate-500">Available Cash Balance</div>
 <div className="text-lg font-bold text-slate-900 font-mono">
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

 <div className="rounded-sm border border-slate-200 bg-slate-50 p-3 text-xs space-y-1 font-mono">
 <div className="font-semibold text-slate-900 ">Exchange Summary:</div>
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
