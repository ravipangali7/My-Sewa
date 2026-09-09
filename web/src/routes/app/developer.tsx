import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMemo, useState } from "react";
import { ChevronRight, Copy, Download, Eye, EyeOff, RefreshCw, Search } from "lucide-react";
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
import type { DeveloperApiTransfer } from "@/lib/types";

export const Route = createFileRoute("/app/developer")({
  head: () => ({
    meta: [
      { title: "Developer API — MySewa" },
      {
        name: "description",
        content: "MySewa Fund Transfer API credentials, documentation, and API transaction history.",
      },
    ],
  }),
  component: DeveloperApiPage,
});

function DeveloperApiPage() {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [downloading, setDownloading] = useState<"markdown" | "html" | "pdf" | null>(null);
  const allowed = canUseFundTransferApi(user);

  const profileQuery = useQuery({
    queryKey: ["developer", "profile"],
    queryFn: () => apiClient.developerProfile(),
    enabled: allowed,
  });
  const data = profileQuery.data;
  const docs = data?.documentation;

  const regenMutation = useMutation({
    mutationFn: () => apiClient.developerRegenerateKey(),
    onSuccess: (res) => {
      toast.success(res.message || t("developer.keyRegenerated"));
      setShowKey(true);
      queryClient.setQueryData(["developer", "profile"], res);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("developer.regenFailed")),
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
          <p className="mt-6 text-sm text-muted-foreground">{t("developer.notEnabled")}</p>
        </div>
      </UserShell>
    );
  }

  return (
    <UserShell title={t("developer.title")}>
      <div className="space-y-5 px-4 pb-8">
        <BackButton to="/app/profile" label={t("common.goBack")} />

        {profileQuery.isError && (
          <p className="text-sm text-muted-foreground">
            {profileQuery.error instanceof ApiError ? profileQuery.error.message : t("common.requestFailed")}
          </p>
        )}

        {data && docs && (
          <>
            <section className="rounded-2xl border border-border bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t("developer.status")}</h2>
                <Badge>{t("developer.enabled")}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("developer.lastUsed")}: {data.api_last_used_at ? formatDateTime(data.api_last_used_at) : t("developer.never")}
              </p>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t("developer.apiKey")}</p>
                <p className="break-all rounded-xl bg-muted px-3 py-2 font-mono text-xs">
                  {showKey ? data.api_key : data.api_key_masked}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{t("developer.keyWarning")}</p>
              <div className="flex flex-wrap gap-2">
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

            <section className="rounded-2xl border border-border bg-white p-4 space-y-3">
              <h2 className="text-sm font-semibold">{t("developer.howTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("developer.howLead")}</p>
              <ol className="space-y-2 text-sm">
                {(docs.how_it_works || []).map((step, index) => (
                  <li key={step} className="flex gap-2">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-2xl border border-border bg-white p-4 space-y-2">
              <h2 className="text-sm font-semibold">{t("developer.docsTitle")}</h2>
              <p className="text-xs text-muted-foreground break-all">
                {docs.method} {docs.endpoint}
              </p>
              <p className="text-sm">{docs.authentication.header}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloading !== null}
                  onClick={() => void download("pdf")}
                >
                  <Download className="size-3.5" />
                  {downloading === "pdf" ? t("common.processing") : "PDF"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloading !== null}
                  onClick={() => void download("html")}
                >
                  <Download className="size-3.5" />
                  {downloading === "html" ? t("common.processing") : "HTML"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloading !== null}
                  onClick={() => void download("markdown")}
                >
                  <Download className="size-3.5" />
                  {downloading === "markdown" ? t("common.processing") : "Markdown"}
                </Button>
              </div>
            </section>

            {(docs.bank_flow?.length || docs.api_sections?.length) ? (
              <section className="rounded-2xl border border-border bg-white p-4 space-y-3">
                <h2 className="text-sm font-semibold">{t("developer.bankFlowTitle")}</h2>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
{`1. GET /api/v1/banklist/
2. POST /api/v1/verifiedbank/
3. POST /api/v1/banktransfer/`}
                </pre>
                <ol className="space-y-2 text-sm">
                  {(docs.bank_flow || []).map((step, index) => (
                    <li key={step} className="flex gap-2">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {(docs.api_sections || []).map((section) => (
              <section key={section.id} className="rounded-2xl border border-border bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={section.method === "GET" ? "bg-blue-600" : ""}>{section.method}</Badge>
                  <h2 className="text-sm font-semibold">{section.title}</h2>
                </div>
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {section.method} {section.url || section.path}
                </p>
                <p className="text-sm text-muted-foreground">{section.purpose}</p>
                {section.request_example ? (
                  <DocBlock title={t("developer.request")}>
                    {JSON.stringify(section.request_example, null, 2)}
                  </DocBlock>
                ) : null}
                <DocBlock title={t("developer.success")}>
                  {JSON.stringify(section.success_response, null, 2)}
                </DocBlock>
                {section.failed_response ? (
                  <DocBlock title={t("developer.statusFailed")}>
                    {JSON.stringify(section.failed_response, null, 2)}
                  </DocBlock>
                ) : null}
                {section.examples?.curl ? <DocBlock title="cURL">{section.examples.curl}</DocBlock> : null}
              </section>
            ))}

            <ApiTransactionHistory />

            <DocBlock title={t("developer.request")}>
              {JSON.stringify(docs.request_example ?? { receiver: "98XXXXXXXX", amount: 1000, reference: "ORDER-10001" }, null, 2)}
            </DocBlock>
            <DocBlock title={t("developer.success")}>
              {JSON.stringify(docs.success_response, null, 2)}
            </DocBlock>
            <ul className="space-y-1 text-sm">
              {docs.validation.map((rule) => (
                <li key={rule}>• {rule}</li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">{docs.idempotency}</p>
            <DocBlock title="cURL">{docs.examples.curl}</DocBlock>
            <DocBlock title="Python">{docs.examples.python}</DocBlock>
            <DocBlock title="JavaScript">{docs.examples.javascript}</DocBlock>
            <section className="rounded-2xl border border-border bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">{t("developer.errors")}</h2>
              <ul className="space-y-1 text-sm">
                {docs.error_responses.map((item) => (
                  <li key={`${item.http}-${item.code}-${item.message ?? ""}`}>
                    <span className="font-mono text-xs">{item.http}</span> {item.error}{" "}
                    <span className="text-muted-foreground">({item.code})</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-2xl border border-border bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">{t("developer.security")}</h2>
              <ul className="space-y-1 text-sm">
                {docs.security.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </section>
            <p className="text-xs text-muted-foreground">
              <Link to="/app/history" className="text-brand underline">
                {t("developer.viewHistory")}
              </Link>
            </p>
          </>
        )}
      </div>
    </UserShell>
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
    <section className="rounded-2xl border border-border bg-white p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{t("developer.historyTitle")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("developer.historyLead")}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder={t("developer.historySearch")}
            className="h-10 rounded-xl pl-9"
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
            className="h-10 w-full rounded-xl border border-input bg-transparent px-3 text-sm"
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
            <Input type="date" value={startDate} onChange={(e) => { setPage(1); setStartDate(e.target.value); }} className="h-10 rounded-xl" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("list.endDate")}</Label>
            <Input type="date" value={endDate} onChange={(e) => { setPage(1); setEndDate(e.target.value); }} className="h-10 rounded-xl" />
          </div>
        </div>
      </div>

      {query.isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : empty ? (
        <div className="rounded-xl bg-muted/60 px-4 py-8 text-center">
          <p className="text-sm font-medium">{t("developer.historyEmptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {emptyFiltered ? t("developer.historyEmptyFiltered") : t("developer.historyEmpty")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {items.map((row) => (
            <li key={`${row.method}-${row.id}-${row.transaction_id}`}>
              <button
                type="button"
                onClick={() => setSelected(row)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.receiver || "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.reference || "—"} · {formatDateTime(row.created_at)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{row.amount ? formatNPR(row.amount) : "—"}</p>
                  <StatusChip status={row.status} compact className="mt-1" />
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.data && query.data.count > 0 ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{rangeLabel}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!query.data.has_previous} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              {t("developer.prev")}
            </Button>
            <Button size="sm" variant="outline" disabled={!query.data.has_next} onClick={() => setPage((p) => p + 1)}>
              {t("developer.next")}
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
                <dt className="text-xs text-muted-foreground">{t("common.status")}</dt>
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
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all font-medium">{value}</dd>
    </div>
  );
}

function DocBlock({ title, children }: { title: string; children: string }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
        {children}
      </pre>
    </section>
  );
}
