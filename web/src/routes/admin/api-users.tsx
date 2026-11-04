import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Eye,
  KeyRound,
  Plus,
  Search,
  Building,
  Gamepad2,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldCheck,
  FileText,
  FileCheck,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  X,
  Upload,
} from "lucide-react";
import { useState, useMemo } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { adminLiveQueryOptions } from "@/lib/refresh";
import { useAuth } from "@/lib/auth";
import type { AdminApiUser } from "@/lib/types";

export const Route = createFileRoute("/admin/api-users")({
  head: () => ({
    meta: [
      { title: "Developer API Partners — MySewa Admin" },
      {
        name: "description",
        content: "Manage Developer API Partners, GGR Gaming, Pay In & Pay Out services, and Business KYC documents.",
      },
    ],
  }),
  component: AdminApiUsersPage,
});

type ServiceFilter = "all" | "ggr" | "payin" | "payout";

export function AdminApiUsersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isPureShareholder = user?.role === "shareholder" && !user?.is_superuser;

  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all");

  // Add / Select API Partner Modal State
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<{
    id: number;
    phone: string;
    first_name: string;
    last_name: string;
    email: string | null;
    business_name?: string;
    pan_no?: string;
    company_registration_no?: string;
    citizenship_no?: string;
  } | null>(null);

  // Modal Service Flags
  const [modalGgr, setModalGgr] = useState(true);
  const [modalPayin, setModalPayin] = useState(true);
  const [modalPayout, setModalPayout] = useState(true);

  // Modal Business KYC Fields
  const [modalBusinessName, setModalBusinessName] = useState("");
  const [modalPanNo, setModalPanNo] = useState("");
  const [modalPanDoc, setModalPanDoc] = useState<File | null>(null);
  const [modalCompanyRegNo, setModalCompanyRegNo] = useState("");
  const [modalCompanyRegDoc, setModalCompanyRegDoc] = useState<File | null>(null);
  const [modalCitizenshipNo, setModalCitizenshipNo] = useState("");
  const [modalCitizenshipFront, setModalCitizenshipFront] = useState<File | null>(null);
  const [modalCitizenshipBack, setModalCitizenshipBack] = useState<File | null>(null);

  // Document Viewer Preview Modal
  const [docPreviewUrl, setDocPreviewUrl] = useState<string | null>(null);
  const [docPreviewTitle, setDocPreviewTitle] = useState("");

  const query = useQuery({
    queryKey: ["admin", "api-users", q, showAll],
    queryFn: () => apiClient.adminApiUsers({ q, api_only: isPureShareholder ? true : !showAll }),
    ...adminLiveQueryOptions(),
  });
  const items = query.data?.items ?? [];

  // Search candidate users for registration modal
  const candidateQuery = useQuery({
    queryKey: ["admin", "api-users", "candidates", candidateSearch],
    queryFn: () => apiClient.adminSearchPartnerCandidates(candidateSearch),
    enabled: partnerModalOpen && candidateSearch.length >= 2,
  });

  const toggleServiceMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: {
        is_api_user?: boolean;
        is_ggr_user?: boolean;
        can_api_payin?: boolean;
        can_api_payout?: boolean;
      };
    }) => apiClient.adminSetApiUserAccess(id, payload),
    onSuccess: (res) => {
      toast.success(res.message || "API Partner service updated");
      queryClient.invalidateQueries({ queryKey: ["admin", "api-users"] });
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not update service access"),
  });

  const registerPartnerMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCandidate) {
        throw new Error("Please select a user to register as API Partner.");
      }
      const formData = new FormData();
      formData.append("user_id", String(selectedCandidate.id));
      formData.append("phone", selectedCandidate.phone);
      formData.append("is_ggr_user", String(modalGgr));
      formData.append("can_api_payin", String(modalPayin));
      formData.append("can_api_payout", String(modalPayout));
      formData.append("business_name", modalBusinessName.trim());
      formData.append("pan_no", modalPanNo.trim());
      formData.append("company_registration_no", modalCompanyRegNo.trim());
      formData.append("citizenship_no", modalCitizenshipNo.trim());

      if (modalPanDoc) formData.append("pan_document", modalPanDoc);
      if (modalCompanyRegDoc) formData.append("company_registration_document", modalCompanyRegDoc);
      if (modalCitizenshipFront) formData.append("citizenship_front", modalCitizenshipFront);
      if (modalCitizenshipBack) formData.append("citizenship_back", modalCitizenshipBack);

      return apiClient.adminSelectApiPartner(formData);
    },
    onSuccess: (res) => {
      toast.success(res.message || "API Partner successfully registered!");
      setPartnerModalOpen(false);
      resetModalForm();
      queryClient.invalidateQueries({ queryKey: ["admin", "api-users"] });
      queryClient.invalidateQueries({ queryKey: ["shareholder-dashboard"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : (err as Error).message || "Registration failed"),
  });

  const resetModalForm = () => {
    setSelectedCandidate(null);
    setCandidateSearch("");
    setModalBusinessName("");
    setModalPanNo("");
    setModalPanDoc(null);
    setModalCompanyRegNo("");
    setModalCompanyRegDoc(null);
    setModalCitizenshipNo("");
    setModalCitizenshipFront(null);
    setModalCitizenshipBack(null);
    setModalGgr(true);
    setModalPayin(true);
    setModalPayout(true);
  };

  const handleSelectCandidate = (candidate: typeof selectedCandidate) => {
    if (!candidate) return;
    setSelectedCandidate(candidate);
    setModalBusinessName(candidate.business_name || [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") || "");
    setModalPanNo(candidate.pan_no || "");
    setModalCompanyRegNo(candidate.company_registration_no || "");
    setModalCitizenshipNo(candidate.citizenship_no || "");
  };

  const filteredItems = useMemo(() => {
    if (serviceFilter === "all") return items;
    if (serviceFilter === "ggr") return items.filter((u) => u.is_ggr_user || u.is_ggr);
    if (serviceFilter === "payin") return items.filter((u) => u.can_api_payin);
    if (serviceFilter === "payout") return items.filter((u) => u.can_api_payout ?? u.can_fund_transfer);
    return items;
  }, [items, serviceFilter]);

  const stats = query.data?.stats ?? {
    total: items.length,
    enabled: items.filter((u) => u.is_api_user).length,
    ggr_count: items.filter((u) => u.is_ggr_user).length,
    payin_count: items.filter((u) => u.can_api_payin).length,
    payout_count: items.filter((u) => u.can_api_payout ?? u.can_fund_transfer).length,
  };

  return (
    <AdminShell
      title="Developer API (API Partners)"
      description="Manage API Partners, service controls (GGR Gaming, Pay In, Pay Out), credentials, and Business KYC documentation."
      dense
    >
      {/* Metric Strip */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-2xs">
          <p className="text-[11px] font-medium text-slate-500">API Partners</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold tracking-tight text-slate-900">{stats.total}</span>
            <Building className="h-4 w-4 text-slate-400" />
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-2xs">
          <p className="text-[11px] font-medium text-slate-500">GGR Gaming Active</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold tracking-tight text-amber-700">{stats.ggr_count ?? 0}</span>
            <Gamepad2 className="h-4 w-4 text-amber-500" />
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-2xs">
          <p className="text-[11px] font-medium text-slate-500">Pay In Service</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold tracking-tight text-blue-700">{stats.payin_count ?? 0}</span>
            <ArrowDownLeft className="h-4 w-4 text-blue-500" />
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-3 shadow-2xs">
          <p className="text-[11px] font-medium text-slate-500">Pay Out Service</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold tracking-tight text-emerald-700">{stats.payout_count ?? 0}</span>
            <ArrowUpRight className="h-4 w-4 text-emerald-500" />
          </div>
        </div>
      </div>

      {/* Action and Filter Bar */}
      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search partner by phone, business name, PAN, registration no..."
              className="pl-8 text-xs bg-white border-slate-200"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {(
              [
                { id: "all", label: "All" },
                { id: "ggr", label: "GGR Gaming" },
                { id: "payin", label: "Pay In" },
                { id: "payout", label: "Pay Out" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setServiceFilter(tab.id)}
                className={`rounded-xs px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  serviceFilter === tab.id
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {!isPureShareholder && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap cursor-pointer ml-auto sm:ml-2">
              <Switch checked={showAll} onCheckedChange={setShowAll} />
              <span>Show non-API users</span>
            </label>
          )}
        </div>

        {!isPureShareholder && (
          <Button
            size="sm"
            onClick={() => {
              resetModalForm();
              setPartnerModalOpen(true);
            }}
            className="h-8 rounded-sm text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-2xs shrink-0"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Register / Select API Partner
          </Button>
        )}
      </div>

      {/* Main List / Table */}
      <AdminDataList
        isEmpty={!query.isLoading && filteredItems.length === 0}
        empty={
          <AdminEmptyState>
            No API partners found matching your search. Click &ldquo;Register / Select API Partner&rdquo; to add one.
          </AdminEmptyState>
        }
        mobile={
          <AdminMobileCardGrid>
            {filteredItems.map((u) => (
              <PartnerCard
                key={u.id}
                user={u}
                isShareholder={isPureShareholder}
                toggling={toggleServiceMutation.isPending}
                onToggleService={(payload) => toggleServiceMutation.mutate({ id: u.id, payload })}
                onPreviewDoc={(title, url) => {
                  setDocPreviewTitle(title);
                  setDocPreviewUrl(url);
                }}
              />
            ))}
          </AdminMobileCardGrid>
        }
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner / Business</TableHead>
                <TableHead>Active Services (GGR, Pay In, Pay Out)</TableHead>
                <TableHead>Cut Charges (Dep / Wth)</TableHead>
                <TableHead>Business KYC & Documents</TableHead>
                <TableHead>API Key</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((u) => {
                const isGgr = Boolean(u.is_ggr_user || u.is_ggr);
                const isPayin = Boolean(u.can_api_payin);
                const isPayout = Boolean(u.can_api_payout ?? u.can_fund_transfer);
                const isApi = Boolean(u.is_api_user);

                return (
                  <TableRow key={u.id} className="hover:bg-slate-50/70">
                    {/* Partner Column */}
                    <TableCell>
                      <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <Building className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        <span>{u.business_name || u.phone}</span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {u.phone} · {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || "No name"}
                      </div>
                    </TableCell>

                    {/* Services Column */}
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* GGR Service */}
                        <button
                          type="button"
                          disabled={isPureShareholder || toggleServiceMutation.isPending}
                          onClick={() =>
                            toggleServiceMutation.mutate({
                              id: u.id,
                              payload: { is_ggr_user: !isGgr },
                            })
                          }
                          title={isGgr ? "Disable GGR Gaming Service" : "Enable GGR Gaming Service"}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-bold border transition-colors cursor-pointer ${
                            isGgr
                              ? "bg-amber-50 text-amber-800 border-amber-300"
                              : "bg-slate-100 text-slate-400 border-slate-200"
                          }`}
                        >
                          <Gamepad2 className="h-3 w-3" />
                          GGR
                        </button>

                        {/* Pay In Service */}
                        <button
                          type="button"
                          disabled={isPureShareholder || toggleServiceMutation.isPending}
                          onClick={() =>
                            toggleServiceMutation.mutate({
                              id: u.id,
                              payload: { can_api_payin: !isPayin },
                            })
                          }
                          title={isPayin ? "Disable Pay In API" : "Enable Pay In API"}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-bold border transition-colors cursor-pointer ${
                            isPayin
                              ? "bg-blue-50 text-blue-800 border-blue-300"
                              : "bg-slate-100 text-slate-400 border-slate-200"
                          }`}
                        >
                          <ArrowDownLeft className="h-3 w-3" />
                          Pay In
                        </button>

                        {/* Pay Out Service */}
                        <button
                          type="button"
                          disabled={isPureShareholder || toggleServiceMutation.isPending}
                          onClick={() =>
                            toggleServiceMutation.mutate({
                              id: u.id,
                              payload: { can_api_payout: !isPayout },
                            })
                          }
                          title={isPayout ? "Disable Pay Out API" : "Enable Pay Out API"}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-bold border transition-colors cursor-pointer ${
                            isPayout
                              ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                              : "bg-slate-100 text-slate-400 border-slate-200"
                          }`}
                        >
                          <ArrowUpRight className="h-3 w-3" />
                          Pay Out
                        </button>

                        {/* Master API switch */}
                        <span
                          className={`text-[9px] px-1 py-0.2 rounded-xs font-mono font-bold ${
                            isApi ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {isApi ? "API Active" : "Disabled"}
                        </span>
                      </div>
                    </TableCell>

                    {/* Cut Charges Column */}
                    <TableCell>
                      <div className="flex flex-col gap-1 text-[11px] font-mono">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold" title="Deposit API Cut Fee">
                          Dep: {u.effective_api_deposit_percent || u.api_deposit_percent || "2.50"}%
                        </span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-blue-50 text-blue-700 border border-blue-200 font-semibold" title="Withdraw API Cut Fee">
                          Wth: {u.effective_api_withdraw_percent || u.api_withdraw_percent || "3.00"}%
                        </span>
                      </div>
                    </TableCell>

                    {/* Business KYC Column */}
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          {u.pan_no ? (
                            <span className="font-mono bg-slate-100 px-1 py-0.2 rounded-xs text-[11px] text-slate-700 font-semibold border border-slate-200">
                              PAN: {u.pan_no}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">No PAN</span>
                          )}

                          {u.company_registration_no && (
                            <span className="font-mono bg-slate-100 px-1 py-0.2 rounded-xs text-[11px] text-slate-700 border border-slate-200">
                              Reg: {u.company_registration_no}
                            </span>
                          )}
                        </div>

                        {/* Document click to preview */}
                        <div className="flex items-center gap-1.5 text-[10px]">
                          {u.pan_document_url && (
                            <button
                              type="button"
                              onClick={() => {
                                setDocPreviewTitle(`Business PAN Document — ${u.business_name || u.phone}`);
                                setDocPreviewUrl(u.pan_document_url || null);
                              }}
                              className="text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-0.5 font-medium cursor-pointer"
                            >
                              <FileCheck className="h-3 w-3 text-emerald-600" />
                              PAN Doc
                            </button>
                          )}

                          {u.company_registration_document_url && (
                            <button
                              type="button"
                              onClick={() => {
                                setDocPreviewTitle(`Company Registration Document — ${u.business_name || u.phone}`);
                                setDocPreviewUrl(u.company_registration_document_url || null);
                              }}
                              className="text-blue-700 hover:text-blue-800 hover:underline flex items-center gap-0.5 font-medium cursor-pointer"
                            >
                              <FileCheck className="h-3 w-3 text-blue-600" />
                              Reg Doc
                            </button>
                          )}

                          {(u.citizenship_front_url || u.citizenship_back_url) && (
                            <button
                              type="button"
                              onClick={() => {
                                setDocPreviewTitle(`Citizenship Document — ${u.business_name || u.phone}`);
                                setDocPreviewUrl(u.citizenship_front_url || u.citizenship_back_url || null);
                              }}
                              className="text-amber-700 hover:text-amber-800 hover:underline flex items-center gap-0.5 font-medium cursor-pointer"
                            >
                              <ShieldCheck className="h-3 w-3 text-amber-600" />
                              Citizenship
                            </button>
                          )}

                          {!u.pan_document_url && !u.company_registration_document_url && !u.citizenship_front_url && (
                            <span className="text-slate-400 text-[10px] italic">No documents uploaded</span>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    {/* API Key Column */}
                    <TableCell className="font-mono text-xs text-slate-600">
                      {u.api_key_masked || "—"}
                    </TableCell>

                    {/* Last Used Column */}
                    <TableCell className="text-xs text-slate-500">
                      {u.api_last_used_at ? formatDateTime(u.api_last_used_at) : "Never used"}
                    </TableCell>

                    {/* Actions Column */}
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline" className="h-7 text-xs border-slate-200">
                        <Link to="/admin/api-users/$userId" params={{ userId: String(u.id) }}>
                          <Eye className="size-3.5 mr-1 text-slate-600" />
                          Manage & KYC
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        }
      />

      {/* MODAL: REGISTER / SELECT API PARTNER */}
      <Dialog open={partnerModalOpen} onOpenChange={setPartnerModalOpen}>
        <DialogContent className="sm:max-w-xl bg-white border-slate-200 shadow-xl rounded-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-slate-900 font-bold text-base">
              <Building className="h-5 w-5 text-emerald-600" />
              Register / Select Developer API Partner
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Select any existing MySewa user, configure their active Developer services, and record Business KYC documentation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* Step 1: Select User */}
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-3">
              <Label className="font-bold text-slate-800 text-xs">1. Select User Account</Label>
              {!selectedCandidate ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      placeholder="Search registered user by phone, name, or email..."
                      value={candidateSearch}
                      onChange={(e) => setCandidateSearch(e.target.value)}
                      className="pl-8 text-xs bg-white border-slate-200"
                    />
                  </div>

                  {candidateQuery.isLoading && (
                    <p className="text-[11px] text-slate-400">Searching user accounts...</p>
                  )}

                  {candidateQuery.data?.items && candidateQuery.data.items.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-xs border border-slate-200 bg-white divide-y divide-slate-100">
                      {candidateQuery.data.items.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => handleSelectCandidate(c)}
                          className="p-2 hover:bg-slate-50 cursor-pointer flex items-center justify-between"
                        >
                          <div>
                            <p className="font-bold text-slate-800 text-xs">{c.phone}</p>
                            <p className="text-[11px] text-slate-500">
                              {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "No name"}
                              {c.business_name ? ` · ${c.business_name}` : ""}
                            </p>
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 text-[11px] text-emerald-700">
                            Select
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-xs border border-emerald-200 bg-emerald-50/60 p-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-bold text-slate-900 text-xs">{selectedCandidate.phone}</p>
                      <p className="text-[11px] text-slate-600">
                        {[selectedCandidate.first_name, selectedCandidate.last_name].filter(Boolean).join(" ")}
                        {selectedCandidate.email ? ` (${selectedCandidate.email})` : ""}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedCandidate(null)}
                    className="h-6 text-[11px] border-slate-200 bg-white"
                  >
                    Change
                  </Button>
                </div>
              )}
            </div>

            {/* Step 2: Enabled Services */}
            <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
              <Label className="font-bold text-slate-800 text-xs">2. Active Developer Services</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="flex items-center justify-between rounded-xs border border-amber-200 bg-amber-50/50 p-2">
                  <div>
                    <p className="font-bold text-slate-800 text-xs">GGR Gaming</p>
                    <p className="text-[10px] text-slate-500">10% profit cut</p>
                  </div>
                  <Switch checked={modalGgr} onCheckedChange={setModalGgr} />
                </div>

                <div className="flex items-center justify-between rounded-xs border border-blue-200 bg-blue-50/50 p-2">
                  <div>
                    <p className="font-bold text-slate-800 text-xs">Pay In API</p>
                    <p className="text-[10px] text-slate-500">PayBridge wallet loads</p>
                  </div>
                  <Switch checked={modalPayin} onCheckedChange={setModalPayin} />
                </div>

                <div className="flex items-center justify-between rounded-xs border border-emerald-200 bg-emerald-50/50 p-2">
                  <div>
                    <p className="font-bold text-slate-800 text-xs">Pay Out API</p>
                    <p className="text-[10px] text-slate-500">Fund & bank payout</p>
                  </div>
                  <Switch checked={modalPayout} onCheckedChange={setModalPayout} />
                </div>
              </div>
            </div>

            {/* Step 3: Business KYC Info & Documents */}
            <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <Label className="font-bold text-slate-800 text-xs">3. Business KYC & Legal Documents</Label>
                <span className="text-[10px] text-slate-500 font-mono">PAN · Registration · Citizenship</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="modal_business_name" className="text-[11px] text-slate-600">
                    Business / Company Name
                  </Label>
                  <Input
                    id="modal_business_name"
                    value={modalBusinessName}
                    onChange={(e) => setModalBusinessName(e.target.value)}
                    placeholder="e.g. Kathmandu Gaming Pvt. Ltd."
                    className="text-xs h-8 mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="modal_pan_no" className="text-[11px] text-slate-600">
                    Business PAN Number
                  </Label>
                  <Input
                    id="modal_pan_no"
                    value={modalPanNo}
                    onChange={(e) => setModalPanNo(e.target.value)}
                    placeholder="e.g. 601234567"
                    className="text-xs h-8 mt-1 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label className="text-[11px] text-slate-600">Business PAN Document (Image / PDF)</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setModalPanDoc(e.target.files?.[0] || null)}
                      className="text-xs h-8 text-slate-500 file:mr-2 file:h-6 file:rounded-xs file:border-0 file:bg-slate-100 file:px-2 file:text-xs"
                    />
                    {modalPanDoc && <span className="text-[10px] text-emerald-600 font-medium">Selected</span>}
                  </div>
                </div>

                <div>
                  <Label htmlFor="modal_company_reg_no" className="text-[11px] text-slate-600">
                    Company Registration Number
                  </Label>
                  <Input
                    id="modal_company_reg_no"
                    value={modalCompanyRegNo}
                    onChange={(e) => setModalCompanyRegNo(e.target.value)}
                    placeholder="e.g. 123456/080/081"
                    className="text-xs h-8 mt-1 font-mono"
                  />
                </div>

                <div>
                  <Label htmlFor="modal_citizenship_no" className="text-[11px] text-slate-600">
                    Citizenship Number (Representative)
                  </Label>
                  <Input
                    id="modal_citizenship_no"
                    value={modalCitizenshipNo}
                    onChange={(e) => setModalCitizenshipNo(e.target.value)}
                    placeholder="e.g. 27-01-78-12345"
                    className="text-xs h-8 mt-1 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label className="text-[11px] text-slate-600">Company Registration Document</Label>
                  <Input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setModalCompanyRegDoc(e.target.files?.[0] || null)}
                    className="text-xs h-8 mt-1 text-slate-500 file:mr-2 file:h-6 file:rounded-xs file:border-0 file:bg-slate-100 file:px-2 file:text-xs"
                  />
                </div>

                <div>
                  <Label className="text-[11px] text-slate-600">Citizenship Front Document</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setModalCitizenshipFront(e.target.files?.[0] || null)}
                    className="text-xs h-8 mt-1 text-slate-500 file:mr-2 file:h-6 file:rounded-xs file:border-0 file:bg-slate-100 file:px-2 file:text-xs"
                  />
                </div>

                <div>
                  <Label className="text-[11px] text-slate-600">Citizenship Back Document</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setModalCitizenshipBack(e.target.files?.[0] || null)}
                    className="text-xs h-8 mt-1 text-slate-500 file:mr-2 file:h-6 file:rounded-xs file:border-0 file:bg-slate-100 file:px-2 file:text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPartnerModalOpen(false)}
              className="h-8 text-xs border-slate-200"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={registerPartnerMutation.isPending || !selectedCandidate}
              onClick={() => registerPartnerMutation.mutate()}
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            >
              {registerPartnerMutation.isPending ? "Configuring..." : "Confirm & Save API Partner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DOCUMENT PREVIEW MODAL */}
      <Dialog open={Boolean(docPreviewUrl)} onOpenChange={(open) => !open && setDocPreviewUrl(null)}>
        <DialogContent className="sm:max-w-2xl bg-white border-slate-200 shadow-xl rounded-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-slate-900 flex items-center justify-between">
              <span>{docPreviewTitle || "Document Preview"}</span>
              {docPreviewUrl && (
                <a
                  href={docPreviewUrl}
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
            {docPreviewUrl ? (
              <img
                src={docPreviewUrl}
                alt={docPreviewTitle}
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

function PartnerCard({
  user,
  isShareholder,
  toggling,
  onToggleService,
  onPreviewDoc,
}: {
  user: AdminApiUser;
  isShareholder: boolean;
  toggling: boolean;
  onToggleService: (payload: { is_ggr_user?: boolean; can_api_payin?: boolean; can_api_payout?: boolean }) => void;
  onPreviewDoc: (title: string, url: string) => void;
}) {
  const isGgr = Boolean(user.is_ggr_user || user.is_ggr);
  const isPayin = Boolean(user.can_api_payin);
  const isPayout = Boolean(user.can_api_payout ?? user.can_fund_transfer);

  return (
    <AdminMobileCard>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-slate-900 text-xs flex items-center gap-1">
            <Building className="h-3.5 w-3.5 text-slate-500" />
            {user.business_name || user.phone}
          </p>
          <p className="text-[11px] text-slate-500 font-mono">
            {user.phone} · {[user.first_name, user.last_name].filter(Boolean).join(" ") || "No name"}
          </p>
        </div>
        <Badge variant={user.is_api_user ? "default" : "secondary"}>
          {user.is_api_user ? "API Active" : "Disabled"}
        </Badge>
      </div>

      <div className="my-2 flex flex-wrap items-center gap-1">
        <span
          className={`px-1.5 py-0.5 rounded-xs text-[10px] font-bold border ${
            isGgr ? "bg-amber-50 text-amber-800 border-amber-300" : "bg-slate-100 text-slate-400 border-slate-200"
          }`}
        >
          GGR: {isGgr ? "ON" : "OFF"}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded-xs text-[10px] font-bold border ${
            isPayin ? "bg-blue-50 text-blue-800 border-blue-300" : "bg-slate-100 text-slate-400 border-slate-200"
          }`}
        >
          Pay In: {isPayin ? "ON" : "OFF"}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded-xs text-[10px] font-bold border ${
            isPayout ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-slate-100 text-slate-400 border-slate-200"
          }`}
        >
          Pay Out: {isPayout ? "ON" : "OFF"}
        </span>
      </div>

      <AdminMobileMeta
        items={[
          { label: "Deposit Cut", value: `${user.effective_api_deposit_percent || user.api_deposit_percent || "2.50"}%` },
          { label: "Withdraw Cut", value: `${user.effective_api_withdraw_percent || user.api_withdraw_percent || "3.00"}%` },
          { label: "PAN No", value: user.pan_no || "—" },
          { label: "Company Reg", value: user.company_registration_no || "—" },
          { label: "Citizenship", value: user.citizenship_no || "—" },
          { label: "API Key", value: user.api_key_masked || "—" },
        ]}
      />

      <Button asChild size="sm" variant="outline" className="mt-2 w-full text-xs h-7 border-slate-200">
        <Link to="/admin/api-users/$userId" params={{ userId: String(user.id) }}>
          <Eye className="size-3.5 mr-1" />
          Manage Partner & KYC
        </Link>
      </Button>
    </AdminMobileCard>
  );
}
