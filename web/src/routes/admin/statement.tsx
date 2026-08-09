import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, Users, Wallet } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { StatsCards } from "@/components/admin/StatsCards";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime, formatNPR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StatementLedgerRow } from "@/lib/types";

export const Route = createFileRoute("/admin/statement")({
  head: () => ({
    meta: [
      { title: "Statement — MySewa Admin" },
      {
        name: "description",
        content:
          "Ledger compare HimalPay and MySewa transactions by user, review mismatches, and correct wallets.",
      },
      { property: "og:title", content: "Statement — MySewa Admin" },
    ],
  }),
  component: StatementPage,
});

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthStartISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

function txnDetailPath(row: StatementLedgerRow): string | null {
  const ms = row.mysewa;
  if (!ms?.txn_id || !ms.txn_type) return null;
  switch (ms.txn_type) {
    case "topup":
      return `/admin/topups/${ms.txn_id}`;
    case "data_pack":
      return `/admin/data-topups/${ms.txn_id}`;
    case "internet":
      return `/admin/internet/${ms.txn_id}`;
    case "water":
      return `/admin/water/${ms.txn_id}`;
    case "community_electricity":
      return `/admin/community-electricity/${ms.txn_id}`;
    case "bank_transfer":
      return `/admin/transfers`;
    case "remittance":
      return `/admin/remittances`;
    case "deposit":
      return `/admin/deposits/${ms.txn_id}`;
    case "wallet_adjustment":
      return row.user_id ? `/admin/wallets` : null;
    default:
      return null;
  }
}

function matchLabel(state: string): string {
  switch (state) {
    case "matched":
      return "Matched";
    case "local_only":
      return "MySewa only";
    case "status_mismatch":
      return "Status mismatch";
    case "amount_mismatch":
      return "Amount mismatch";
    case "missing_local":
      return "Missing in MySewa";
    case "missing_provider":
      return "Missing in HimalPay";
    case "wallet_not_applied":
      return "Wallet not applied";
    default:
      return state.replace(/_/g, " ");
  }
}

function matchTone(state: string): string {
  if (state === "matched") return "bg-success/10 text-success";
  if (state === "local_only") return "bg-muted text-muted-foreground";
  return "bg-warning/15 text-warning-foreground";
}

type CorrectDraft = {
  row: StatementLedgerRow;
  adjustment_type: "credit" | "debit";
  amount: string;
  reason: string;
};

function StatementPage() {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState(monthStartISO);
  const [toDate, setToDate] = useState(todayISO);
  const [matchFilter, setMatchFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("");
  const [search, setSearch] = useState("");
  const [ignoreTarget, setIgnoreTarget] = useState<StatementLedgerRow | null>(null);
  const [correctDraft, setCorrectDraft] = useState<CorrectDraft | null>(null);

  const ledgerFilters = useMemo(
    () => ({
      from_date: fromDate,
      to_date: toDate,
      match_state: matchFilter === "all" ? undefined : matchFilter,
      user: userFilter.trim() || undefined,
      q: search.trim() || undefined,
    }),
    [fromDate, toDate, matchFilter, userFilter, search],
  );

  const ledgerQuery = useQuery({
    queryKey: ["admin", "statement", "ledger", ledgerFilters],
    queryFn: () => apiClient.adminStatementLedger(ledgerFilters),
    refetchOnMount: "always",
  });

  const balanceQuery = useQuery({
    queryKey: ["admin", "statement", "balance"],
    queryFn: () => apiClient.adminStatementBalance(),
    retry: false,
  });

  const listQuery = useQuery({
    queryKey: ["admin", "statement", "summary"],
    queryFn: () => apiClient.adminStatement({ status: "open" }),
    refetchOnMount: "always",
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "statement"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
  };

  const runMutation = useMutation({
    mutationFn: () =>
      apiClient.adminStatementRun({ from_date: fromDate, to_date: toDate }),
    onSuccess: (res) => {
      const warning =
        typeof (res as { warning?: string }).warning === "string"
          ? (res as { warning?: string }).warning
          : res.data?.error_message;
      toast.success(
        `Check done — ${res.data.issues_new} new issue(s), ${res.data.issues_open} open`,
      );
      if (warning) toast.message(warning);
      invalidateAll();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Reconcile failed");
    },
  });

  const solveMutation = useMutation({
    mutationFn: (row: StatementLedgerRow) => {
      if (!row.discrepancy_id) {
        return Promise.reject(new Error("No open discrepancy to solve"));
      }
      return apiClient.adminStatementSolve(row.discrepancy_id);
    },
    onSuccess: () => {
      toast.success("Wallet adjusted, issue resolved, user emailed");
      invalidateAll();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Solve failed");
    },
  });

  const correctMutation = useMutation({
    mutationFn: (draft: CorrectDraft) => {
      if (!draft.row.user_id && !draft.row.discrepancy_id) {
        return Promise.reject(new Error("No user to correct"));
      }
      return apiClient.adminStatementCorrect({
        user_id: draft.row.user_id as number,
        adjustment_type: draft.adjustment_type,
        amount: draft.amount,
        reason: draft.reason,
        discrepancy_id: draft.row.discrepancy_id,
        transaction_uuid: draft.row.himalpay?.transaction_uuid || undefined,
      });
    },
    onSuccess: (res) => {
      toast.success(res.message || "Correction applied and user emailed");
      setCorrectDraft(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Correction failed");
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: (row: StatementLedgerRow) => {
      if (!row.discrepancy_id) {
        return Promise.reject(new Error("No open discrepancy"));
      }
      return apiClient.adminStatementIgnore(row.discrepancy_id);
    },
    onSuccess: () => {
      toast.success("Issue ignored");
      setIgnoreTarget(null);
      invalidateAll();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Ignore failed");
    },
  });

  const byUser = ledgerQuery.data?.by_user ?? [];
  const counts = ledgerQuery.data?.counts;
  const summary = listQuery.data?.summary;
  const balance = balanceQuery.data?.data;
  const balanceUnavailable = Boolean(
    balanceQuery.data?.unavailable || (balanceQuery.data?.error && !balance),
  );
  const balanceRupees =
    typeof balance?.total_balance_in_rupees === "number"
      ? balance.total_balance_in_rupees
      : typeof balance?.balance_in_rupees === "number"
        ? balance.balance_in_rupees
        : null;

  const cards = [
    {
      key: "total",
      label: "Ledger rows",
      value: String(counts?.total ?? 0),
      icon: CheckCircle2,
      tone: "default" as const,
    },
    {
      key: "users",
      label: "Users",
      value: String(counts?.users ?? byUser.filter((g) => g.user_id).length),
      icon: Users,
      tone: "brand" as const,
    },
    {
      key: "open",
      label: "Open issues",
      value: String(summary?.open_issues ?? counts?.issues ?? 0),
      icon: AlertTriangle,
      tone: (summary?.open_issues ?? counts?.issues ?? 0) > 0 ? ("warning" as const) : ("default" as const),
    },
    {
      key: "hp",
      label: "HimalPay float",
      value: balanceRupees != null ? formatNPR(balanceRupees) : "—",
      icon: Wallet,
      tone: "brand" as const,
    },
  ];

  const openCorrect = (row: StatementLedgerRow) => {
    const suggestedType =
      row.suggested_adjustment_type === "credit" || row.suggested_adjustment_type === "debit"
        ? row.suggested_adjustment_type
        : "credit";
    setCorrectDraft({
      row,
      adjustment_type: suggestedType,
      amount: row.suggested_amount || "",
      reason: row.reason || "",
    });
  };

  return (
    <AdminShell
      title="Statement"
      description="HimalPay ↔ MySewa ledger by user — review, reconcile, and correct wallets"
    >
      <StatsCards items={cards} />

      {balanceUnavailable ? (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-foreground">
          HimalPay float unavailable on LIVE API. Add portal login under{" "}
          <span className="font-medium">Admin → Settings → HimalPay</span>.
          {balanceQuery.data?.error ? (
            <p className="mt-1 text-xs text-muted-foreground">{balanceQuery.data.error}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="date"
              value={toDate}
              max={todayISO()}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Match</Label>
            <Select value={matchFilter} onValueChange={setMatchFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All rows</SelectItem>
                <SelectItem value="matched">Matched</SelectItem>
                <SelectItem value="local_only">MySewa only</SelectItem>
                <SelectItem value="status_mismatch">Status mismatch</SelectItem>
                <SelectItem value="amount_mismatch">Amount mismatch</SelectItem>
                <SelectItem value="missing_local">Missing in MySewa</SelectItem>
                <SelectItem value="missing_provider">Missing in HimalPay</SelectItem>
                <SelectItem value="wallet_not_applied">Wallet not applied</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user">User phone / name</Label>
            <Input
              id="user"
              placeholder="Filter by user"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 xl:col-span-2">
            <Label htmlFor="q">Search</Label>
            <Input
              id="q"
              placeholder="UUID, merchant id, service…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending || !fromDate || !toDate}
          >
            <RefreshCw className={`mr-2 size-4 ${runMutation.isPending ? "animate-spin" : ""}`} />
            {runMutation.isPending ? "Checking…" : "Run check"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Shows all MySewa transactions in range (through today). Run check to refresh
            HimalPay rows for the same window.
          </p>
        </div>
      </div>

      {ledgerQuery.data?.run ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Ledger {ledgerQuery.data.from_date} → {ledgerQuery.data.to_date}
          {ledgerQuery.data.run.finished_at
            ? ` · last HP sync ${formatDateTime(ledgerQuery.data.run.finished_at)}`
            : null}
          {" · "}
          {counts?.matched ?? 0} matched · {counts?.local_only ?? 0} MySewa-only ·{" "}
          {counts?.issues ?? 0} issues
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          MySewa-side rows load from the database for this range. Run check to pull HimalPay
          statement entries.
        </p>
      )}

      <div className="mt-5 space-y-6">
        {ledgerQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading ledger…</p>
        ) : byUser.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No transactions in this range. Widen the dates or run a check.
          </div>
        ) : (
          byUser.map((group) => (
            <section
              key={String(group.user_id ?? group.user_phone ?? "unmatched")}
              className="overflow-hidden rounded-xl border border-border bg-surface"
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {group.user_name || group.user_phone || "Unmatched (no MySewa user)"}
                  </h2>
                  {group.user_phone ? (
                    <p className="text-xs text-muted-foreground">{group.user_phone}</p>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {group.row_count} txn{group.row_count === 1 ? "" : "s"}
                  {group.issue_count > 0 ? (
                    <span className="ml-2 text-warning-foreground">
                      · {group.issue_count} issue{group.issue_count === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
              </header>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[220px]">HimalPay</TableHead>
                      <TableHead className="w-28">Match</TableHead>
                      <TableHead className="min-w-[220px]">MySewa</TableHead>
                      <TableHead className="text-right min-w-[160px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.rows.map((row) => {
                      const hp = row.himalpay;
                      const ms = row.mysewa;
                      const detail = txnDetailPath(row);
                      const isIssue =
                        row.match_state !== "matched" && row.match_state !== "local_only";
                      return (
                        <TableRow
                          key={row.key}
                          className={cn(isIssue && "bg-warning/5")}
                        >
                          <TableCell className="align-top">
                            {hp ? (
                              <div className="space-y-0.5">
                                <div className="font-medium">
                                  {hp.service || "—"}{" "}
                                  <span className="capitalize text-muted-foreground">
                                    · {hp.direction || "—"}
                                  </span>
                                </div>
                                <div className="text-sm tabular-nums">
                                  {formatNPR(hp.net_amount)}{" "}
                                  <span className="text-xs text-muted-foreground">
                                    ({hp.status || "—"})
                                  </span>
                                </div>
                                <div className="font-mono text-[11px] text-muted-foreground break-all">
                                  {hp.transaction_uuid}
                                </div>
                                {hp.created_at ? (
                                  <div className="text-[11px] text-muted-foreground">
                                    {formatDateTime(hp.created_at)}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            <span
                              className={cn(
                                "inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium",
                                matchTone(row.match_state),
                              )}
                            >
                              {matchLabel(row.match_state)}
                            </span>
                            {row.reason && isIssue ? (
                              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                                {row.reason}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="align-top">
                            {ms ? (
                              <div className="space-y-0.5">
                                <div className="font-medium">
                                  {ms.txn_type_display || ms.txn_type}
                                </div>
                                <div className="text-sm tabular-nums">
                                  {formatNPR(ms.amount)}{" "}
                                  <StatusChip status={ms.status} compact className="ml-1" />
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {ms.merchant_txn_id || ms.provider_txn_id || `ID ${ms.txn_id}`}
                                </div>
                                {ms.created_at ? (
                                  <div className="text-[11px] text-muted-foreground">
                                    {formatDateTime(ms.created_at)}
                                  </div>
                                ) : null}
                                {detail ? (
                                  <a
                                    href={detail}
                                    className="mt-0.5 inline-block text-xs text-brand underline"
                                  >
                                    View txn
                                  </a>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="align-top text-right">
                            <div className="flex flex-col items-end gap-1.5">
                              {row.can_solve ? (
                                <Button
                                  size="sm"
                                  disabled={solveMutation.isPending}
                                  onClick={() => solveMutation.mutate(row)}
                                >
                                  Solve
                                  {row.suggested_amount
                                    ? ` (${row.suggested_adjustment_type} ${formatNPR(row.suggested_amount)})`
                                    : ""}
                                </Button>
                              ) : null}
                              {row.can_correct ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openCorrect(row)}
                                >
                                  Correct
                                </Button>
                              ) : null}
                              {row.discrepancy_id && isIssue ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setIgnoreTarget(row)}
                                >
                                  Ignore
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </section>
          ))
        )}
      </div>

      <Dialog open={!!correctDraft} onOpenChange={(o) => !o && setCorrectDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correct wallet</DialogTitle>
            <DialogDescription>
              Adjust this user&apos;s wallet and email them explaining the correction.
              {correctDraft?.row.user_phone
                ? ` User: ${correctDraft.row.user_phone}`
                : null}
            </DialogDescription>
          </DialogHeader>
          {correctDraft ? (
            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={correctDraft.adjustment_type}
                  onValueChange={(v) =>
                    setCorrectDraft({
                      ...correctDraft,
                      adjustment_type: v as "credit" | "debit",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">Credit (add to wallet)</SelectItem>
                    <SelectItem value="debit">Debit (deduct from wallet)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="corr-amount">Amount (NPR)</Label>
                <Input
                  id="corr-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={correctDraft.amount}
                  onChange={(e) =>
                    setCorrectDraft({ ...correctDraft, amount: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="corr-reason">Explanation (emailed to user)</Label>
                <Textarea
                  id="corr-reason"
                  rows={3}
                  value={correctDraft.reason}
                  onChange={(e) =>
                    setCorrectDraft({ ...correctDraft, reason: e.target.value })
                  }
                  placeholder="Describe what was wrong and how it was fixed"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                correctMutation.isPending ||
                !correctDraft?.amount ||
                !correctDraft?.reason.trim()
              }
              onClick={() => correctDraft && correctMutation.mutate(correctDraft)}
            >
              {correctMutation.isPending ? "Applying…" : "Apply & email user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!ignoreTarget} onOpenChange={(o) => !o && setIgnoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ignore this issue?</AlertDialogTitle>
            <AlertDialogDescription>
              The discrepancy will be marked ignored without changing any wallet balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => ignoreTarget && ignoreMutation.mutate(ignoreTarget)}
              disabled={ignoreMutation.isPending}
            >
              Ignore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}
