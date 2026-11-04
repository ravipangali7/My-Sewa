import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Building,
  Gamepad2,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldCheck,
  FileCheck,
  FileText,
  Upload,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  History,
  Percent,
} from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import { adminLiveQueryOptions } from "@/lib/refresh";
import { formatDateTime, formatNPR } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin/api-users_/$userId")({
  head: () => ({
    meta: [{ title: "Developer API Partner — MySewa Admin" }],
  }),
  component: AdminApiUserDetailPage,
});

export function AdminApiUserDetailPage() {
  const { userId } = Route.useParams();
  const id = Number(userId);
  const { user: authUser } = useAuth();
  const isPureShareholder = authUser?.role === "shareholder" && !authUser?.is_superuser;
  const queryClient = useQueryClient();

  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [returnUrl, setReturnUrl] = useState("");

  // Business KYC Editable Form State
  const [businessName, setBusinessName] = useState("");
  const [panNo, setPanNo] = useState("");
  const [companyRegNo, setCompanyRegNo] = useState("");
  const [citizenshipNo, setCitizenshipNo] = useState("");

  // Per-User API Cut Percentages (Deposit 2.5%, Withdraw 3%)
  const [apiDepositPercent, setApiDepositPercent] = useState("");
  const [apiWithdrawPercent, setApiWithdrawPercent] = useState("");

  // Files state
  const [panDocFile, setPanDocFile] = useState<File | null>(null);
  const [companyRegDocFile, setCompanyRegDocFile] = useState<File | null>(null);
  const [citizenshipFrontFile, setCitizenshipFrontFile] = useState<File | null>(null);
  const [citizenshipBackFile, setCitizenshipBackFile] = useState<File | null>(null);

  // Document Preview Modal
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null);
  const [previewDocTitle, setPreviewDocTitle] = useState("");

  const userQuery = useQuery({
    queryKey: ["admin", "api-users", id],
    queryFn: () => apiClient.adminGetApiUser(id),
    enabled: Number.isFinite(id),
    ...adminLiveQueryOptions(),
  });
  const logsQuery = useQuery({
    queryKey: ["admin", "api-users", id, "logs"],
    queryFn: () => apiClient.adminApiUserLogs(id),
    enabled: Number.isFinite(id),
    ...adminLiveQueryOptions(),
  });

  const u = userQuery.data;

  useEffect(() => {
    if (u) {
      setWebhookUrl(u.api_webhook_url || "");
      setReturnUrl(u.api_return_url || "");
      setBusinessName(u.business_name || "");
      setPanNo(u.pan_no || "");
      setCompanyRegNo(u.company_registration_no || "");
      setCitizenshipNo(u.citizenship_no || u.citizenship_number || "");
      setApiDepositPercent(
        u.api_deposit_percent != null
          ? String(u.api_deposit_percent)
          : u.effective_api_deposit_percent || "2.50"
      );
      setApiWithdrawPercent(
        u.api_withdraw_percent != null
          ? String(u.api_withdraw_percent)
          : u.effective_api_withdraw_percent || "3.00"
      );
    }
  }, [u]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "api-users"] });
    queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
  };

  const handleSaveFeePercentages = () => {
    updateMutation.mutate({
      api_deposit_percent: apiDepositPercent.trim() !== "" ? apiDepositPercent.trim() : null,
      api_withdraw_percent: apiWithdrawPercent.trim() !== "" ? apiWithdrawPercent.trim() : null,
    } as any);
  };

  const handleResetFeeDefaults = () => {
    setApiDepositPercent("2.50");
    setApiWithdrawPercent("3.00");
    updateMutation.mutate({
      api_deposit_percent: "2.50",
      api_withdraw_percent: "3.00",
    } as any);
  };

  const updateMutation = useMutation({
    mutationFn: (formDataOrObj: FormData | Record<string, unknown>) =>
      apiClient.adminSetApiUserAccess(id, formDataOrObj as any),
    onSuccess: (res) => {
      toast.success(res.message || "API Partner updated successfully");
      invalidate();
      setPanDocFile(null);
      setCompanyRegDocFile(null);
      setCitizenshipFrontFile(null);
      setCitizenshipBackFile(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Update failed"),
  });

  const handleSaveKycAndServices = () => {
    const fd = new FormData();
    fd.append("business_name", businessName.trim());
    fd.append("pan_no", panNo.trim());
    fd.append("company_registration_no", companyRegNo.trim());
    fd.append("citizenship_no", citizenshipNo.trim());

    if (panDocFile) fd.append("pan_document", panDocFile);
    if (companyRegDocFile) fd.append("company_registration_document", companyRegDocFile);
    if (citizenshipFrontFile) fd.append("citizenship_front", citizenshipFrontFile);
    if (citizenshipBackFile) fd.append("citizenship_back", citizenshipBackFile);

    updateMutation.mutate(fd);
  };

  const revealMutation = useMutation({
    mutationFn: () => apiClient.adminRevealApiKey(id),
    onSuccess: (data) => {
      setRevealedKey(data.api_key || "");
      setShowKey(true);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not reveal key"),
  });

  const regenMutation = useMutation({
    mutationFn: () => apiClient.adminRegenerateApiKey(id),
    onSuccess: (res) => {
      toast.success(res.message);
      setRevealedKey(res.data.api_key || "");
      setShowKey(true);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not regenerate key"),
  });

  const displayKey = showKey && revealedKey ? revealedKey : u?.api_key_masked || "—";

  const copyKey = async () => {
    if (!revealedKey) {
      toast.error("Reveal the key first");
      return;
    }
    try {
      await navigator.clipboard.writeText(revealedKey);
      toast.success("API key copied to clipboard");
    } catch {
      toast.error("Could not copy key");
    }
  };

  const isGgr = Boolean(u?.is_ggr_user || u?.is_ggr);
  const isPayin = Boolean(u?.can_api_payin);
  const isPayout = Boolean(u?.can_api_payout ?? u?.can_fund_transfer);

  return (
    <AdminShell
      title={u ? `API Partner — ${u.business_name || u.phone}` : "API Partner"}
      description="Manage Developer API access, active services (GGR Gaming, Pay In, Pay Out), Business KYC, and audit trails."
      dense
    >
      <div className="mb-4">
        <BackButton to="/admin/api-users" label="Back to Developer API Partners" />
      </div>

      {userQuery.isError && (
        <p className="text-sm text-muted-foreground">
          {userQuery.error instanceof ApiError ? userQuery.error.message : "Partner not found."}
        </p>
      )}

      {u && (
        <div className="space-y-4 pb-10">
          {/* Top Overview & Service Control Strip */}
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-sm bg-slate-100 text-slate-700">
                  <Building className="size-5 text-emerald-600" />
                </div>
                <div>
                  <h2 className="font-bold text-sm text-slate-900">{u.business_name || "Unnamed Business"}</h2>
                  <p className="text-xs text-slate-500 font-mono">
                    {u.phone} · {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || "No name"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant={u.is_api_user ? "default" : "secondary"}>
                  {u.is_api_user ? "API Active" : "API Disabled"}
                </Badge>
                {!isPureShareholder && (
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs border-slate-200">
                    <Link to="/admin/users/$userId" params={{ userId }}>
                      View Master User Profile
                    </Link>
                  </Button>
                )}
              </div>
            </div>

            {/* 3 Core Services Controls */}
            <div className="grid gap-3 sm:grid-cols-3">
              {/* Service 1: GGR Gaming */}
              <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50/40 p-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                    <Gamepad2 className="h-4 w-4 text-amber-600" />
                    <span>GGR Gaming Coin</span>
                  </div>
                  <p className="text-[11px] text-slate-500">Gameplay bets, wins, and 10% monthly profit cut.</p>
                </div>
                <Switch
                  checked={isGgr}
                  disabled={isPureShareholder || updateMutation.isPending}
                  onCheckedChange={(checked) =>
                    updateMutation.mutate({ is_ggr_user: checked } as any)
                  }
                />
              </div>

              {/* Service 2: Pay In API */}
              <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50/40 p-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                    <ArrowDownLeft className="h-4 w-4 text-blue-600" />
                    <span>Pay In / Deposit API</span>
                  </div>
                  <p className="text-[11px] text-slate-500">PayBridgeNP wallet load checkout initiated via API.</p>
                </div>
                <Switch
                  checked={isPayin}
                  disabled={isPureShareholder || updateMutation.isPending || !u.is_api_user}
                  onCheckedChange={(checked) =>
                    updateMutation.mutate({ can_api_payin: checked } as any)
                  }
                />
              </div>

              {/* Service 3: Pay Out API */}
              <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                    <ArrowUpRight className="h-4 w-4 text-emerald-600" />
                    <span>Pay Out / Transfer API</span>
                  </div>
                  <p className="text-[11px] text-slate-500">Fund transfer & bank withdrawal execution via API.</p>
                </div>
                <Switch
                  checked={isPayout}
                  disabled={isPureShareholder || updateMutation.isPending || !u.is_api_user}
                  onCheckedChange={(checked) =>
                    updateMutation.mutate({ can_api_payout: checked } as any)
                  }
                />
              </div>
            </div>
          </div>

          {/* Section: API Cut Charges (Deposit 2.5% & Withdraw 3%) */}
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                  <Percent className="h-4 w-4 text-emerald-600" />
                  API Transaction Cut Charges (Instant Deposit &amp; Withdraw)
                </h2>
                <p className="text-[11px] text-slate-500">
                  Customizable cut charge rates on this account when using API. Settable by Super Admin and Shareholders.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
                  Deposit Cut: {u.effective_api_deposit_percent || u.api_deposit_percent || "2.50"}%
                </Badge>
                <Badge variant="outline" className="text-[10px] font-mono font-semibold bg-blue-50 text-blue-700 border-blue-200">
                  Withdraw Cut: {u.effective_api_withdraw_percent || u.api_withdraw_percent || "3.00"}%
                </Badge>
              </div>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2 text-xs">
              <div className="space-y-1">
                <Label htmlFor="api_deposit_percent" className="text-[11px] font-bold text-slate-700">
                  Deposit API Cut Percentage (%)
                </Label>
                <div className="relative">
                  <Input
                    id="api_deposit_percent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="2.50"
                    value={apiDepositPercent}
                    onChange={(e) => setApiDepositPercent(e.target.value)}
                    className="text-xs h-8 border-slate-200 font-mono pr-8"
                  />
                  <span className="absolute right-2.5 top-2 text-xs text-slate-400 font-mono">%</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  Default: 2.50%. Automatically deducted upon instant deposit on their account using API.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="api_withdraw_percent" className="text-[11px] font-bold text-slate-700">
                  Withdraw API Cut Percentage (%)
                </Label>
                <div className="relative">
                  <Input
                    id="api_withdraw_percent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="3.00"
                    value={apiWithdrawPercent}
                    onChange={(e) => setApiWithdrawPercent(e.target.value)}
                    className="text-xs h-8 border-slate-200 font-mono pr-8"
                  />
                  <span className="absolute right-2.5 top-2 text-xs text-slate-400 font-mono">%</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  Default: 3.00%. Automatically deducted upon instant withdraw / payout on their account using API.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">
                {isPureShareholder
                  ? "Logged in as Shareholder Partner. You can set cut charge rates for this user."
                  : "Super Admin & Shareholder Governance: cut charges are distributed to equity shareholders."}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-slate-200"
                  disabled={updateMutation.isPending}
                  onClick={handleResetFeeDefaults}
                >
                  Reset Defaults (2.5% / 3%)
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                  disabled={updateMutation.isPending}
                  onClick={handleSaveFeePercentages}
                >
                  {updateMutation.isPending ? "Saving..." : "Save Cut Percentages"}
                </Button>
              </div>
            </div>
          </div>

          {/* Section 2: Business KYC & Legal Documentation */}
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Business KYC & Legal Document Verification
                </h2>
                <p className="text-[11px] text-slate-500">
                  Business PAN, Company Registration, and Citizenship documents submitted for this API Partner.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-xs border uppercase ${
                    u.business_kyc_status === "verified"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                      : u.business_kyc_status === "pending"
                      ? "bg-amber-50 text-amber-800 border-amber-300"
                      : "bg-slate-100 text-slate-500 border-slate-200"
                  }`}
                >
                  KYC {u.business_kyc_status || "Incomplete"}
                </span>
              </div>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2 text-xs">
              {/* Business Name */}
              <div>
                <Label htmlFor="kyc_business_name" className="text-[11px] text-slate-600">
                  Business / Company Entity Name
                </Label>
                <Input
                  id="kyc_business_name"
                  value={businessName}
                  disabled={isPureShareholder}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Kathmandu Gaming Pvt. Ltd."
                  className="text-xs h-8 mt-1 border-slate-200"
                />
              </div>

              {/* PAN Number */}
              <div>
                <Label htmlFor="kyc_pan_no" className="text-[11px] text-slate-600">
                  Business PAN Number
                </Label>
                <Input
                  id="kyc_pan_no"
                  value={panNo}
                  disabled={isPureShareholder}
                  onChange={(e) => setPanNo(e.target.value)}
                  placeholder="e.g. 601234567"
                  className="text-xs h-8 mt-1 font-mono border-slate-200"
                />
              </div>

              {/* Business PAN Document */}
              <div className="rounded-xs border border-slate-200 bg-slate-50/50 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5 text-emerald-600" />
                    Business PAN Document
                  </span>
                  {u.pan_document_url && (
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewDocTitle(`Business PAN Document — ${u.business_name || u.phone}`);
                        setPreviewDocUrl(u.pan_document_url || null);
                      }}
                      className="text-[11px] text-emerald-700 hover:underline font-bold flex items-center gap-0.5 cursor-pointer"
                    >
                      <Eye className="h-3 w-3" />
                      View Document
                    </button>
                  )}
                </div>

                {!isPureShareholder && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setPanDocFile(e.target.files?.[0] || null)}
                      className="text-xs h-7 text-slate-500 file:mr-2 file:h-5 file:rounded-xs file:border-0 file:bg-slate-200 file:px-2 file:text-[11px]"
                    />
                    {panDocFile && <span className="text-[10px] text-emerald-600 font-medium">Selected</span>}
                  </div>
                )}
              </div>

              {/* Company Registration Number */}
              <div>
                <Label htmlFor="kyc_company_reg_no" className="text-[11px] text-slate-600">
                  Company Registration Number
                </Label>
                <Input
                  id="kyc_company_reg_no"
                  value={companyRegNo}
                  disabled={isPureShareholder}
                  onChange={(e) => setCompanyRegNo(e.target.value)}
                  placeholder="e.g. 123456/080/081"
                  className="text-xs h-8 mt-1 font-mono border-slate-200"
                />
              </div>

              {/* Company Registration Document */}
              <div className="rounded-xs border border-slate-200 bg-slate-50/50 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5 text-blue-600" />
                    Company Registration Document
                  </span>
                  {u.company_registration_document_url && (
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewDocTitle(`Company Registration Document — ${u.business_name || u.phone}`);
                        setPreviewDocUrl(u.company_registration_document_url || null);
                      }}
                      className="text-[11px] text-blue-700 hover:underline font-bold flex items-center gap-0.5 cursor-pointer"
                    >
                      <Eye className="h-3 w-3" />
                      View Document
                    </button>
                  )}
                </div>

                {!isPureShareholder && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setCompanyRegDocFile(e.target.files?.[0] || null)}
                      className="text-xs h-7 text-slate-500 file:mr-2 file:h-5 file:rounded-xs file:border-0 file:bg-slate-200 file:px-2 file:text-[11px]"
                    />
                    {companyRegDocFile && <span className="text-[10px] text-blue-600 font-medium">Selected</span>}
                  </div>
                )}
              </div>

              {/* Citizenship Number */}
              <div>
                <Label htmlFor="kyc_citizenship_no" className="text-[11px] text-slate-600">
                  Citizenship Number
                </Label>
                <Input
                  id="kyc_citizenship_no"
                  value={citizenshipNo}
                  disabled={isPureShareholder}
                  onChange={(e) => setCitizenshipNo(e.target.value)}
                  placeholder="e.g. 27-01-78-12345"
                  className="text-xs h-8 mt-1 font-mono border-slate-200"
                />
              </div>

              {/* Citizenship Front Document */}
              <div className="rounded-xs border border-slate-200 bg-slate-50/50 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                    Citizenship Front Document
                  </span>
                  {u.citizenship_front_url && (
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewDocTitle(`Citizenship Front — ${u.business_name || u.phone}`);
                        setPreviewDocUrl(u.citizenship_front_url || null);
                      }}
                      className="text-[11px] text-amber-700 hover:underline font-bold flex items-center gap-0.5 cursor-pointer"
                    >
                      <Eye className="h-3 w-3" />
                      View Document
                    </button>
                  )}
                </div>

                {!isPureShareholder && (
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setCitizenshipFrontFile(e.target.files?.[0] || null)}
                    className="text-xs h-7 text-slate-500 file:mr-2 file:h-5 file:rounded-xs file:border-0 file:bg-slate-200 file:px-2 file:text-[11px]"
                  />
                )}
              </div>

              {/* Citizenship Back Document */}
              <div className="rounded-xs border border-slate-200 bg-slate-50/50 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 text-[11px] flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                    Citizenship Back Document
                  </span>
                  {u.citizenship_back_url && (
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewDocTitle(`Citizenship Back — ${u.business_name || u.phone}`);
                        setPreviewDocUrl(u.citizenship_back_url || null);
                      }}
                      className="text-[11px] text-amber-700 hover:underline font-bold flex items-center gap-0.5 cursor-pointer"
                    >
                      <Eye className="h-3 w-3" />
                      View Document
                    </button>
                  )}
                </div>

                {!isPureShareholder && (
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setCitizenshipBackFile(e.target.files?.[0] || null)}
                    className="text-xs h-7 text-slate-500 file:mr-2 file:h-5 file:rounded-xs file:border-0 file:bg-slate-200 file:px-2 file:text-[11px]"
                  />
                )}
              </div>
            </div>

            {!isPureShareholder && (
              <div className="flex justify-end pt-2">
                <Button
                  size="sm"
                  disabled={updateMutation.isPending}
                  onClick={handleSaveKycAndServices}
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                >
                  {updateMutation.isPending ? "Saving Business KYC..." : "Save Business KYC Documents & Info"}
                </Button>
              </div>
            )}
          </div>

          {/* Section 3: API Credentials, Webhooks & URLs */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* API Key Box */}
            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <KeyRound className="h-4 w-4 text-slate-700" />
                  API Secret Key
                </h3>
                <span className="text-[10px] text-slate-400 font-mono">Bearer Auth</span>
              </div>

              <div className="rounded-xs bg-slate-50 border border-slate-200 p-2.5 font-mono text-xs text-slate-800 break-all select-all">
                {displayKey}
              </div>

              <p className="text-[10px] text-slate-400 font-mono">
                Issued {u.api_key_created_at ? formatDateTime(u.api_key_created_at) : "—"} · Last used{" "}
                {u.api_last_used_at ? formatDateTime(u.api_last_used_at) : "never"}
              </p>

              {!isPureShareholder && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-slate-200"
                    onClick={() => {
                      if (showKey && revealedKey) {
                        setShowKey(false);
                        return;
                      }
                      revealMutation.mutate();
                    }}
                    disabled={revealMutation.isPending}
                  >
                    {showKey && revealedKey ? <EyeOff className="size-3.5 mr-1" /> : <Eye className="size-3.5 mr-1" />}
                    {showKey && revealedKey ? "Hide key" : "Reveal key"}
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-slate-200"
                    onClick={() => void copyKey()}
                    disabled={!revealedKey}
                  >
                    <Copy className="size-3.5 mr-1" />
                    Copy
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" className="h-7 text-xs ml-auto">
                        <RefreshCw className="size-3.5 mr-1" />
                        Regenerate
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-white border-slate-200 shadow-xl rounded-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-sm font-bold text-slate-900">
                          Regenerate API Partner Key?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-xs text-slate-500">
                          The previous API key will be revoked immediately. Any integrations currently running
                          with the old key will get HTTP 401 until updated.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="h-8 text-xs border-slate-200">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => regenMutation.mutate()}
                          className="h-8 text-xs bg-rose-600 hover:bg-rose-500 text-white"
                        >
                          Confirm Regenerate
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>

            {/* Webhook & Return URL Box */}
            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-3 text-xs">
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <ExternalLink className="h-4 w-4 text-blue-600" />
                Pay In Webhook & Return URLs
              </h3>

              <div>
                <Label htmlFor="webhook_input" className="text-[11px] text-slate-600">
                  Pay In Webhook URL (Server-to-Server)
                </Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    id="webhook_input"
                    value={webhookUrl}
                    disabled={isPureShareholder}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://partner-game.example/api/mysewa-payin-webhook"
                    className="text-xs h-8 font-mono border-slate-200"
                  />
                  {!isPureShareholder && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs border-slate-200 shrink-0"
                      disabled={updateMutation.isPending}
                      onClick={() => updateMutation.mutate({ api_webhook_url: webhookUrl.trim() } as any)}
                    >
                      Save
                    </Button>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="return_input" className="text-[11px] text-slate-600">
                  Return URL (Player Browser Success Page)
                </Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    id="return_input"
                    value={returnUrl}
                    disabled={isPureShareholder}
                    onChange={(e) => setReturnUrl(e.target.value)}
                    placeholder="https://partner-game.example/wallet/deposit/success"
                    className="text-xs h-8 font-mono border-slate-200"
                  />
                  {!isPureShareholder && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs border-slate-200 shrink-0"
                      disabled={updateMutation.isPending}
                      onClick={() => updateMutation.mutate({ api_return_url: returnUrl.trim() } as any)}
                    >
                      Save
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Transaction & Activity Audit Logs */}
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
            <h3 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
              <History className="h-4 w-4 text-slate-700" />
              API Partner Transaction History
            </h3>

            <Tabs defaultValue="payin" className="w-full">
              <TabsList className="bg-slate-100 p-0.5 rounded-sm h-8">
                <TabsTrigger value="payin" className="text-xs h-7 px-3 rounded-xs font-semibold">
                  Pay In History ({(logsQuery.data?.payin_items ?? []).length})
                </TabsTrigger>
                <TabsTrigger value="payout" className="text-xs h-7 px-3 rounded-xs font-semibold">
                  Pay Out History ({(logsQuery.data?.items ?? []).length})
                </TabsTrigger>
                <TabsTrigger value="ggr" className="text-xs h-7 px-3 rounded-xs font-semibold">
                  GGR Coin Activity ({(logsQuery.data?.ggr_items ?? []).length})
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: PAY IN LOGS */}
              <TabsContent value="payin" className="pt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Receiver</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Order / Txn ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(logsQuery.data?.payin_items ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-xs text-slate-400 py-6 text-center">
                          No API Pay In transactions recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (logsQuery.data?.payin_items ?? []).map((row) => (
                        <TableRow key={`payin-${row.id}`}>
                          <TableCell className="text-xs font-mono text-slate-500">
                            {formatDateTime(row.created_at)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.reference || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{row.receiver || "—"}</TableCell>
                          <TableCell className="text-xs font-bold text-slate-900 font-mono">
                            {row.amount != null ? formatNPR(Number(row.amount)) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                row.status === "success" || row.status === "completed"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-500">
                            {row.transaction_id || row.order_id || row.error_code || "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* TAB 2: PAY OUT LOGS */}
              <TabsContent value="payout" className="pt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Receiver</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Txn ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(logsQuery.data?.items ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-xs text-slate-400 py-6 text-center">
                          No API Pay Out transactions recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (logsQuery.data?.items ?? []).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-xs font-mono text-slate-500">
                            {formatDateTime(row.created_at)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.reference || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{row.receiver || "—"}</TableCell>
                          <TableCell className="text-xs font-bold text-slate-900 font-mono">
                            {row.amount != null ? formatNPR(Number(row.amount)) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.status === "success" ? "default" : "secondary"}>
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-500">
                            {row.transaction_id || row.error_code || "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* TAB 3: GGR COIN LOGS */}
              <TabsContent value="ggr" className="pt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Balance After</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(logsQuery.data?.ggr_items ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-xs text-slate-400 py-6 text-center">
                          No GGR Coin transactions recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (logsQuery.data?.ggr_items ?? []).map((row) => (
                        <TableRow key={`ggr-${row.id}`}>
                          <TableCell className="text-xs font-mono text-slate-500">
                            {formatDateTime(row.created_at)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{row.txn_type_label || row.txn_type}</Badge>
                          </TableCell>
                          <TableCell
                            className={`text-xs font-bold font-mono ${
                              Number(row.amount) >= 0 ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {Number(row.amount) >= 0 ? "+" : ""}
                            {formatNPR(Number(row.amount))}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-slate-700">
                            {formatNPR(Number(row.balance_after))}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-500">{row.reference || "—"}</TableCell>
                          <TableCell className="text-xs text-slate-500">{row.notes || "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}

      {/* DOCUMENT PREVIEW MODAL */}
      <Dialog open={Boolean(previewDocUrl)} onOpenChange={(open) => !open && setPreviewDocUrl(null)}>
        <DialogContent className="sm:max-w-2xl bg-white border-slate-200 shadow-xl rounded-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-slate-900 flex items-center justify-between">
              <span>{previewDocTitle || "Document Preview"}</span>
              {previewDocUrl && (
                <a
                  href={previewDocUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-normal mr-4"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open raw
                </a>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 flex items-center justify-center min-h-[300px] bg-slate-50 rounded-xs border border-slate-200 overflow-hidden">
            {previewDocUrl ? (
              <img
                src={previewDocUrl}
                alt={previewDocTitle}
                className="max-h-[60vh] max-w-full object-contain rounded-xs shadow-xs"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <p className="text-xs text-slate-400">No document image loaded.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
