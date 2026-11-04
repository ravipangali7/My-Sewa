import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  FileText,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { BackButton } from "@/components/BackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/StatusChip";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime, formatNPR } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { canUseFundTransferApi } from "@/lib/account-status";
import type { DeveloperApiEndpointSection, DeveloperApiTransfer } from "@/lib/types";

export const Route = createFileRoute("/app/developer")({
  head: () => ({
    meta: [
      { title: "Developer API — MySewa" },
      {
        name: "description",
        content: "MySewa Bank Verify, Deposit, and Withdraw API credentials, documentation, and transaction history.",
      },
    ],
  }),
  component: DeveloperApiPage,
});

type ApiFilterTab = "all_core" | "verified-bank" | "payin" | "bank-transfer" | "supporting";

function DeveloperApiPage() {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [downloading, setDownloading] = useState<"markdown" | "html" | "pdf" | null>(null);
  const [copyingMd, setCopyingMd] = useState(false);
  const [selectedTab, setSelectedTab] = useState<ApiFilterTab>("all_core");
  const allowed = canUseFundTransferApi(user);

  const profileQuery = useQuery({
    queryKey: ["developer", "profile"],
    queryFn: () => apiClient.developerProfile(),
    enabled: allowed,
  });
  const data = profileQuery.data;
  const docs = data?.documentation;

  useEffect(() => {
    if (data) setWebhookUrl(data.api_webhook_url || "");
  }, [data?.api_webhook_url]);

  const regenMutation = useMutation({
    mutationFn: () => apiClient.developerRegenerateKey(),
    onSuccess: (res) => {
      toast.success(res.message || t("developer.keyRegenerated"));
      setShowKey(true);
      queryClient.setQueryData(["developer", "profile"], res);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("developer.regenFailed")),
  });

  const webhookMutation = useMutation({
    mutationFn: (url: string) => apiClient.developerUpdateWebhook(url),
    onSuccess: (res) => {
      toast.success(res.message || t("developer.webhookSaved"));
      setWebhookUrl(res.api_webhook_url || "");
      queryClient.setQueryData(["developer", "profile"], res);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : t("developer.webhookSaveFailed")),
  });

  const download = async (format: "markdown" | "html" | "pdf") => {
    if (downloading) return;
    setDownloading(format);
    try {
      await apiClient.developerDownloadDocs(format);
      toast.success(t("developer.downloadSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("developer.downloadFailed"));
    } finally {
      setDownloading(null);
    }
  };

  const copyMarkdown = async () => {
    setCopyingMd(true);
    try {
      const text = await apiClient.developerGetDocsText("markdown");
      await navigator.clipboard.writeText(text);
      toast.success(t("developer.copiedMd"));
    } catch {
      toast.error(t("common.copyFailed"));
    } finally {
      setCopyingMd(false);
    }
  };

  const copy = async (value: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(ok);
    } catch {
      toast.error(t("common.copyFailed"));
    }
  };

  if (!allowed) {
    return (
      <UserShell title={t("developer.title")}>
        <div className="px-4 py-8">
          <BackButton to="/app/profile" label={t("common.goBack")} />
          <p className="mt-6 text-sm text-slate-500">{t("developer.notEnabled")}</p>
        </div>
      </UserShell>
    );
  }

  const sections = docs?.api_sections || [];
  const coreSections = sections.filter((s) => s.is_core || ["verified-bank", "payin", "bank-transfer"].includes(s.id));
  const supportingSections = sections.filter((s) => !s.is_core && !["verified-bank", "payin", "bank-transfer"].includes(s.id));

  // Determine sections to show based on selectedTab
  const visibleSections = useMemo(() => {
    if (selectedTab === "all_core") return coreSections;
    if (selectedTab === "supporting") return supportingSections;
    return sections.filter((s) => s.id === selectedTab);
  }, [selectedTab, coreSections, supportingSections, sections]);

  return (
    <UserShell title={t("developer.title")}>
      <div className="space-y-5 px-4 pb-12">
        <BackButton to="/app/profile" label={t("common.goBack")} />

        {profileQuery.isError && (
          <p className="text-sm text-slate-500">
            {profileQuery.error instanceof ApiError ? profileQuery.error.message : t("common.requestFailed")}
          </p>
        )}

        {data && docs && (
          <>
            {/* API Status & Key */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-600" />
                  <h2 className="text-sm font-semibold">{t("developer.status")}</h2>
                </div>
                <Badge className="bg-emerald-600 hover:bg-emerald-700">{t("developer.enabled")}</Badge>
              </div>
              <p className="text-xs text-slate-500">
                {t("developer.lastUsed")}: {data.api_last_used_at ? formatDateTime(data.api_last_used_at) : t("developer.never")}
              </p>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">{t("developer.apiKey")}</p>
                <p className="break-all rounded-md bg-slate-900 px-3 py-2.5 font-mono text-xs text-emerald-300">
                  {showKey ? data.api_key : data.api_key_masked}
                </p>
              </div>
              <p className="text-xs text-slate-500">{t("developer.keyWarning")}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {showKey ? t("developer.hideKey") : t("developer.showKey")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void copy(data.api_key, t("developer.keyCopied"))}>
                  <Copy className="size-3.5" />
                  {t("common.copy")}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="destructive">
                      <RefreshCw className="size-3.5" />
                      {t("developer.regenerate")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("developer.regenTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>{t("developer.regenBody")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => regenMutation.mutate()}>
                        {t("developer.regenerate")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </section>

            {/* Document Download Card (.md priority) */}
            <section className="rounded-xl border border-emerald-300 bg-gradient-to-br from-emerald-50/70 via-white to-slate-50 p-4 sm:p-5 shadow-sm space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white shadow-sm">
                    <FileCode className="size-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-900">{t("developer.downloadMd")}</h2>
                      <Badge className="bg-emerald-700 hover:bg-emerald-800 text-[10px]">
                        v{docs.docs_version || "1.6"} • .md
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed max-w-xl">
                      {t("developer.downloadMdDesc")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-emerald-100">
                <Button
                  size="sm"
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-medium gap-1.5 shadow-sm"
                  disabled={downloading !== null}
                  onClick={() => void download("markdown")}
                >
                  <Download className="size-3.5" />
                  {downloading === "markdown" ? t("common.processing") : "Download Markdown (.md)"}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 bg-white text-slate-700 hover:bg-slate-50 border-slate-300"
                  disabled={copyingMd}
                  onClick={() => void copyMarkdown()}
                >
                  <Copy className="size-3.5" />
                  {copyingMd ? t("common.processing") : t("developer.copyMd")}
                </Button>

                <div className="hidden sm:block h-4 w-px bg-slate-200 mx-1" />

                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-slate-600 hover:text-slate-900 gap-1"
                  disabled={downloading !== null}
                  onClick={() => void download("pdf")}
                >
                  <FileText className="size-3" />
                  {downloading === "pdf" ? t("common.processing") : "PDF"}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-slate-600 hover:text-slate-900 gap-1"
                  disabled={downloading !== null}
                  onClick={() => void download("html")}
                >
                  <ExternalLink className="size-3" />
                  {downloading === "html" ? t("common.processing") : "HTML"}
                </Button>
              </div>
            </section>

            {/* Payin Webhook URL */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-amber-500" />
                <h2 className="text-sm font-semibold">{t("developer.webhookTitle")}</h2>
              </div>
              <p className="text-xs text-slate-500">{t("developer.webhookHelp")}</p>
              <div className="space-y-1.5">
                <Input
                  id="developer_webhook_url"
                  type="url"
                  className="font-mono text-xs"
                  placeholder={t("developer.webhookPlaceholder")}
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={webhookMutation.isPending}
                  onClick={() => webhookMutation.mutate(webhookUrl.trim())}
                >
                  {t("developer.webhookSave")}
                </Button>
                {webhookUrl ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={webhookMutation.isPending}
                    onClick={() => {
                      setWebhookUrl("");
                      webhookMutation.mutate("");
                    }}
                  >
                    {t("developer.webhookClear")}
                  </Button>
                ) : null}
              </div>
            </section>

            {/* The 3 Core APIs Section Header & Tab Filter */}
            <section className="space-y-3 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Code2 className="size-5 text-emerald-600" />
                    <h2 className="text-base font-bold text-slate-900">{t("developer.coreApisTitle")}</h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{t("developer.coreApisLead")}</p>
                </div>
              </div>

              {/* Tab Selector */}
              <div className="flex flex-wrap gap-1.5 p-1 rounded-lg bg-slate-100 border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedTab("all_core")}
                  className={`px-3 py-1.5 rounded-md font-medium transition ${
                    selectedTab === "all_core"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  All 3 Core APIs
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTab("verified-bank")}
                  className={`px-3 py-1.5 rounded-md font-medium transition ${
                    selectedTab === "verified-bank"
                      ? "bg-white text-emerald-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  1. Bank Verify
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTab("payin")}
                  className={`px-3 py-1.5 rounded-md font-medium transition ${
                    selectedTab === "payin"
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  2. Deposit
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTab("bank-transfer")}
                  className={`px-3 py-1.5 rounded-md font-medium transition ${
                    selectedTab === "bank-transfer"
                      ? "bg-white text-amber-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  3. Withdraw
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTab("supporting")}
                  className={`px-3 py-1.5 rounded-md font-medium transition ${
                    selectedTab === "supporting"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Supporting APIs
                </button>
              </div>

              {/* Render Visible Sections */}
              <div className="space-y-4">
                {visibleSections.map((section, idx) => (
                  <ApiEndpointCard key={section.id} section={section} index={idx} copy={copy} />
                ))}
              </div>
            </section>

            {/* Integration Flow Guide */}
            {(docs.bank_flow?.length || docs.payin_flow?.length) ? (
              <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <Layers className="size-4 text-emerald-600" />
                  <h2 className="text-sm font-semibold">{t("developer.bankFlowTitle")}</h2>
                </div>

                <div className="rounded-lg bg-slate-950 p-3.5 font-mono text-xs text-slate-200 space-y-1">
                  <div className="text-slate-400 font-semibold mb-1 text-[11px] uppercase tracking-wider">
                    Recommended 3-Step Bank Lifecycle:
                  </div>
                  <div><span className="text-blue-400">1. GET</span>  /api/v1/banklist/ <span className="text-slate-500">(lookup code)</span></div>
                  <div><span className="text-emerald-400">2. POST</span> /api/v1/verifiedbank/ <span className="text-slate-500">(verify account)</span></div>
                  <div><span className="text-amber-400">3. POST</span> /api/v1/banktransfer/ <span className="text-slate-500">(withdraw / payout)</span></div>
                </div>

                {docs.bank_flow ? (
                  <ol className="space-y-2 text-xs text-slate-600">
                    {docs.bank_flow.map((step, index) => (
                      <li key={step} className="flex gap-2.5">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                          {index + 1}
                        </span>
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>
            ) : null}

            {/* API Transaction History */}
            <ApiTransactionHistory />

            {/* Security Guidelines */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-slate-600" />
                <h2 className="text-sm font-semibold">{t("developer.security")}</h2>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-600">
                {docs.security.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-slate-400">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-xs text-slate-500 text-center pt-2">
              <Link to="/app/history" className="text-emerald-700 hover:underline">
                {t("developer.viewHistory")}
              </Link>
            </p>
          </>
        )}
      </div>
    </UserShell>
  );
}

function ApiEndpointCard({
  section,
  index,
  copy,
}: {
  section: DeveloperApiEndpointSection;
  index: number;
  copy: (val: string, msg: string) => Promise<void>;
}) {
  const t = useT();
  const [langTab, setLangTab] = useState<"curl" | "python" | "javascript">("curl");

  const methodColor =
    section.method === "GET"
      ? "bg-blue-600"
      : section.id === "verified-bank"
        ? "bg-emerald-600"
        : section.id === "payin"
          ? "bg-indigo-600"
          : section.id === "bank-transfer"
            ? "bg-amber-600"
            : "bg-slate-700";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`${methodColor} text-white font-mono text-[11px]`}>{section.method}</Badge>
          <h3 className="text-sm font-bold text-slate-900">{section.title}</h3>
          {section.is_core ? (
            <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-800 bg-emerald-50">
              Core API
            </Badge>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={() => void copy(section.url || section.path, t("developer.endpointCopied"))}
        >
          <Copy className="size-3" />
          {t("developer.copyEndpoint")}
        </Button>
      </div>

      {/* URL banner */}
      <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 break-all flex items-center justify-between gap-2">
        <span>{section.method} {section.url || section.path}</span>
      </div>

      <p className="text-xs text-slate-600 leading-relaxed">{section.purpose}</p>

      {/* Headers */}
      {section.headers && section.headers.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-slate-700">Headers:</h4>
          <div className="flex flex-wrap gap-2 text-xs">
            {section.headers.map((h) => (
              <span
                key={h.name}
                className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700"
              >
                <strong>{h.name}:</strong> {h.example}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Query Parameters (if any) */}
      {section.query && section.query.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-700">Query Parameters:</h4>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3 font-semibold">Parameter</th>
                  <th className="py-2 px-2 font-semibold">Required</th>
                  <th className="py-2 px-2 font-semibold">Type</th>
                  <th className="py-2 px-3 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {section.query.map((q) => (
                  <tr key={q.name} className="hover:bg-slate-50/50">
                    <td className="py-2 px-3 font-mono font-medium text-slate-900">{q.name}</td>
                    <td className="py-2 px-2">
                      {q.required ? (
                        <span className="inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Required</span>
                      ) : (
                        <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">Optional</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-slate-500 font-mono text-[11px]">{q.type}</td>
                    <td className="py-2 px-3 text-slate-600">{q.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Request Parameters (Body) */}
      {section.request_body && Object.keys(section.request_body).length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-700">Request Parameters:</h4>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3 font-semibold">Field</th>
                  <th className="py-2 px-2 font-semibold">Required</th>
                  <th className="py-2 px-2 font-semibold">Type</th>
                  <th className="py-2 px-3 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(section.request_body).map(([key, val]) => (
                  <tr key={key} className="hover:bg-slate-50/50">
                    <td className="py-2 px-3 font-mono font-medium text-slate-900">{key}</td>
                    <td className="py-2 px-2">
                      {val.required ? (
                        <span className="inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Required</span>
                      ) : (
                        <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">Optional</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-slate-500 font-mono text-[11px]">{val.type}</td>
                    <td className="py-2 px-3 text-slate-600">{val.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Code Examples Tabs */}
      {section.examples && (section.examples.curl || section.examples.python || section.examples.javascript) ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-700">Code Example:</h4>
            <div className="flex gap-1 text-[11px]">
              {(["curl", "python", "javascript"] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLangTab(lang)}
                  className={`px-2 py-0.5 rounded font-mono transition ${
                    langTab === lang ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {lang === "curl" ? "cURL" : lang === "python" ? "Python" : "JavaScript"}
                </button>
              ))}
            </div>
          </div>
          <DocBlock
            title={`${langTab === "curl" ? "cURL" : langTab === "python" ? "Python" : "JavaScript"} Example`}
          >
            {section.examples[langTab] || ""}
          </DocBlock>
        </div>
      ) : null}

      {/* Request & Response Blocks */}
      <div className="grid gap-3 sm:grid-cols-2">
        {section.request_example ? (
          <DocBlock title={t("developer.request")}>
            {JSON.stringify(section.request_example, null, 2)}
          </DocBlock>
        ) : null}

        <DocBlock title={`${t("developer.success")} (${section.success_http || "200 OK"})`}>
          {JSON.stringify(section.success_response, null, 2)}
        </DocBlock>
      </div>

      {section.failed_response ? (
        <DocBlock title="Failed Response Example">
          {JSON.stringify(section.failed_response, null, 2)}
        </DocBlock>
      ) : null}

      {/* Notes */}
      {section.notes && section.notes.length > 0 && (
        <div className="rounded-md bg-slate-50 border border-slate-200/80 p-3 text-xs text-slate-600 space-y-1">
          <div className="font-semibold text-slate-700">Important Notes:</div>
          <ul className="space-y-1 list-disc list-inside">
            {section.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ApiTransactionHistory() {
  const t = useT();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DeveloperApiTransfer | null>(null);

  const query = useQuery({
    queryKey: ["developer", "transfers", q, status, startDate, endDate, page],
    queryFn: () => {
      const filters: {
        q?: string;
        status?: string;
        start_date?: string;
        end_date?: string;
        page: number;
        page_size: number;
      } = { page, page_size: 20 };
      if (q.trim()) filters.q = q.trim();
      if (status !== "all") filters.status = status;
      if (startDate) filters.start_date = startDate;
      if (endDate) filters.end_date = endDate;
      return apiClient.developerTransfers(filters);
    },
  });

  const items = query.data?.items ?? [];
  const empty = !query.isLoading && items.length === 0;
  const emptyFiltered = empty && Boolean(q.trim() || status !== "all" || startDate || endDate);

  const rangeLabel = useMemo(() => {
    const count = query.data?.count ?? 0;
    const size = query.data?.page_size ?? 20;
    const current = query.data?.page ?? page;
    if (!count) return "";
    const from = (current - 1) * size + 1;
    const to = Math.min(current * size, count);
    return `${from}–${to} / ${count}`;
  }, [page, query.data]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{t("developer.historyTitle")}</h2>
        <p className="mt-1 text-xs text-slate-500">{t("developer.historyLead")}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder={t("developer.historySearch")}
            className="h-10 rounded-md pl-9 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("common.status")}</Label>
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
            className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-xs"
          >
            <option value="all">{t("list.allStatuses")}</option>
            <option value="success">{t("developer.statusSuccess")}</option>
            <option value="failed">{t("developer.statusFailed")}</option>
            <option value="pending">{t("developer.statusPending")}</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">{t("list.startDate")}</Label>
            <Input type="date" value={startDate} onChange={(e) => { setPage(1); setStartDate(e.target.value); }} className="h-10 rounded-md text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("list.endDate")}</Label>
            <Input type="date" value={endDate} onChange={(e) => { setPage(1); setEndDate(e.target.value); }} className="h-10 rounded-md text-xs" />
          </div>
        </div>
      </div>

      {empty && (
        <div className="rounded-md border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
          {emptyFiltered ? t("developer.historyEmptyFiltered") : t("developer.historyEmpty")}
        </div>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {items.map((item) => (
            <li key={`${item.method}-${item.id}`}>
              <button
                type="button"
                onClick={() => setSelected(item)}
                className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-slate-50"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {item.reference || item.transaction_id || `#${item.id}`}
                    </span>
                    <Badge variant="outline" className="text-[10px]">{item.method}</Badge>
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {item.receiver || "—"} • {formatDateTime(item.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <p className="font-mono text-xs font-semibold">
                      {item.amount ? formatNPR(item.amount) : "—"}
                    </p>
                    <StatusChip status={item.status} />
                  </div>
                  <ChevronRight className="size-4 text-slate-500" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.data && query.data.count > 0 ? (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{rangeLabel}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!query.data.has_previous}
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
            >
              {t("common.prev")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!query.data.has_next}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("common.next")}
            </Button>
          </div>
        </div>
      ) : null}

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-5">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>{t("developer.historyDetail")}</SheetTitle>
          </SheetHeader>
          {selected ? (
            <dl className="space-y-3 text-sm">
              <Detail label={t("developer.txnId")} value={selected.transaction_id || "—"} />
              <Detail label={t("developer.sender")} value={selected.sender || "—"} />
              <Detail label={t("common.recipient")} value={selected.receiver || "—"} />
              <Detail label={t("common.amount")} value={selected.amount ? formatNPR(selected.amount) : "—"} />
              <Detail label={t("developer.reference")} value={selected.reference || "—"} />
              <div>
                <dt className="text-xs text-slate-500">{t("common.status")}</dt>
                <dd className="mt-1"><StatusChip status={selected.status} /></dd>
              </div>
              <Detail label={t("developer.method")} value={selected.method} />
              {selected.provider_reference ? (
                <Detail label={t("developer.providerReference")} value={selected.provider_reference} />
              ) : null}
              {selected.account_number ? (
                <Detail label={t("developer.accountNumber")} value={selected.account_number} />
              ) : null}
              <Detail label={t("common.date")} value={formatDateTime(selected.created_at)} />
              {selected.status === "FAILED" ? (
                <Detail
                  label={t("developer.failureReason")}
                  value={selected.error_message || selected.error_code || "—"}
                />
              ) : null}
            </dl>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-all font-medium">{value}</dd>
    </div>
  );
}

function DocBlock({ title, children }: { title: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-600">{title}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
        >
          {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-2.5 text-[11px] font-mono text-slate-100">
        {children}
      </pre>
    </div>
  );
}
