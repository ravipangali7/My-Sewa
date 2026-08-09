import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, Wallet } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { StatsCards } from "@/components/admin/StatsCards";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { StatementDiscrepancy } from "@/lib/types";

export const Route = createFileRoute("/admin/statement")({
  head: () => ({
    meta: [
      { title: "Statement — MySewa Admin" },
      {
        name: "description",
        content:
          "Compare HimalPay reseller statement with MySewa transactions and resolve wallet mismatches.",
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

function txnDetailPath(item: StatementDiscrepancy): string | null {
  if (!item.txn_id || !item.txn_type) return null;
  switch (item.txn_type) {
    case "topup":
      return `/admin/topups/${item.txn_id}`;
    case "data_pack":
      return `/admin/data-topups/${item.txn_id}`;
    case "internet":
      return `/admin/internet/${item.txn_id}`;
    case "water":
      return `/admin/water/${item.txn_id}`;
    case "community_electricity":
      return `/admin/community-electricity/${item.txn_id}`;
    case "bank_transfer":
      return `/admin/transfers`;
    case "remittance":
      return `/admin/remittances`;
    default:
      return null;
  }
}

function StatementPage() {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState(todayISO);
  const [toDate, setToDate] = useState(todayISO);
  const [statusFilter, setStatusFilter] = useState("open");
  const [issueFilter, setIssueFilter] = useState("all");
  const [solveTarget, setSolveTarget] = useState<StatementDiscrepancy | null>(null);
  const [ignoreTarget, setIgnoreTarget] = useState<StatementDiscrepancy | null>(null);

  const filters = useMemo(
    () => ({
      status: statusFilter,
      issue_type: issueFilter === "all" ? undefined : issueFilter,
    }),
    [statusFilter, issueFilter],
  );

  const listQuery = useQuery({
    queryKey: ["admin", "statement", filters],
    queryFn: () => apiClient.adminStatement(filters),
    refetchOnMount: "always",
  });

  const balanceQuery = useQuery({
    queryKey: ["admin", "statement", "balance"],
    queryFn: () => apiClient.adminStatementBalance(),
    retry: false,
  });

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
      if (warning) {
        toast.message(warning);
      }
      queryClient.invalidateQueries({ queryKey: ["admin", "statement"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Reconcile failed");
    },
  });

  const solveMutation = useMutation({
    mutationFn: (id: number) => apiClient.adminStatementSolve(id),
    onSuccess: () => {
      toast.success("Wallet adjusted and issue resolved");
      setSolveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "statement"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Solve failed");
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: (id: number) => apiClient.adminStatementIgnore(id),
    onSuccess: () => {
      toast.success("Issue ignored");
      setIgnoreTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "statement"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Ignore failed");
    },
  });

  const items = listQuery.data?.items ?? [];
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
      key: "open",
      label: "Open issues",
      value: String(summary?.open_issues ?? 0),
      icon: AlertTriangle,
      tone: (summary?.open_issues ?? 0) > 0 ? ("warning" as const) : ("default" as const),
    },
    {
      key: "hp",
      label: "HimalPay float",
      value: balanceRupees != null ? formatNPR(balanceRupees) : "—",
      icon: Wallet,
      tone: "brand" as const,
    },
  ];

  return (
    <AdminShell
      title="Statement"
      description="Compare HimalPay reseller statement with MySewa and fix wallet mismatches"
    >
      <StatsCards items={cards} />

      {balanceUnavailable ? (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-foreground">
          HimalPay float unavailable on LIVE API. Add portal login under{" "}
          <span className="font-medium">Admin → Settings → HimalPay</span> (phone/email +
          password) or ask HimalPay to enable{" "}
          <span className="font-mono text-xs">/wallet/reseller-balance</span>.
          {balanceQuery.data?.error ? (
            <p className="mt-1 text-xs text-muted-foreground">{balanceQuery.data.error}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Issue type</Label>
            <Select value={issueFilter} onValueChange={setIssueFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="status_mismatch">Status mismatch</SelectItem>
                <SelectItem value="amount_mismatch">Amount mismatch</SelectItem>
                <SelectItem value="missing_local">Missing in MySewa</SelectItem>
                <SelectItem value="missing_provider">Missing in HimalPay</SelectItem>
                <SelectItem value="wallet_not_applied">Wallet not applied</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending || !fromDate || !toDate}
          className="shrink-0"
        >
          <RefreshCw className={`mr-2 size-4 ${runMutation.isPending ? "animate-spin" : ""}`} />
          {runMutation.isPending ? "Checking…" : "Run check"}
        </Button>
      </div>

      {summary?.latest_run ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Last run #{summary.latest_run.id}: {summary.latest_run.from_date} →{" "}
          {summary.latest_run.to_date} · {summary.latest_run.status_display} · HP entries{" "}
          {summary.latest_run.hp_entries} · matched {summary.latest_run.matched}
          {summary.latest_run.finished_at
            ? ` · ${formatDateTime(summary.latest_run.finished_at)}`
            : null}
        </p>
      ) : null}

      <div className="mt-5">
        <AdminDataList
          isEmpty={!listQuery.isLoading && items.length === 0}
          empty={<AdminEmptyState>No statement issues for this filter.</AdminEmptyState>}
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Issue</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>HP / MySewa</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Suggested</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const detail = txnDetailPath(item);
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.issue_type_display}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {item.transaction_uuid || item.merchant_txn_id || "—"}
                          </div>
                          <StatusChip status={item.status} className="mt-1" />
                        </TableCell>
                        <TableCell>
                          <div>{item.wallet_service_name || item.txn_type_display || "—"}</div>
                          <div className="text-xs text-muted-foreground capitalize">
                            {item.direction || "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            HP {item.hp_status || "—"} / {formatNPR(item.hp_net_amount)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Local {item.local_status || "—"} /{" "}
                            {item.local_amount != null ? formatNPR(item.local_amount) : "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.user_phone ? (
                            <div>
                              <div>{item.user_name || item.user_phone}</div>
                              <div className="text-xs text-muted-foreground">{item.user_phone}</div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Unmatched</span>
                          )}
                          {detail ? (
                            <a href={detail} className="mt-1 block text-xs text-brand underline">
                              View txn
                            </a>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {item.suggested_adjustment_type && item.suggested_amount ? (
                            <span className="capitalize">
                              {item.suggested_adjustment_type} {formatNPR(item.suggested_amount)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.status === "open" ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                disabled={!item.can_solve || solveMutation.isPending}
                                onClick={() => setSolveTarget(item)}
                              >
                                Solve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setIgnoreTarget(item)}
                              >
                                Ignore
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {item.status_display}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          }
          mobile={
            <AdminMobileCardGrid>
              {items.map((item) => (
                <AdminMobileCard key={item.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{item.issue_type_display}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.transaction_uuid || item.merchant_txn_id || "—"}
                      </p>
                    </div>
                    <StatusChip status={item.status} compact />
                  </div>
                  <AdminMobileMeta
                    items={[
                      { label: "Service", value: item.wallet_service_name || "—" },
                      {
                        label: "HP",
                        value: `${item.hp_status || "—"} / ${formatNPR(item.hp_net_amount)}`,
                      },
                      {
                        label: "Local",
                        value: `${item.local_status || "—"} / ${
                          item.local_amount != null ? formatNPR(item.local_amount) : "—"
                        }`,
                      },
                      { label: "User", value: item.user_phone || "Unmatched" },
                      {
                        label: "Suggested",
                        value:
                          item.suggested_adjustment_type && item.suggested_amount
                            ? `${item.suggested_adjustment_type} ${formatNPR(item.suggested_amount)}`
                            : "—",
                      },
                    ]}
                  />
                  {item.status === "open" ? (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={!item.can_solve}
                        onClick={() => setSolveTarget(item)}
                      >
                        Solve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setIgnoreTarget(item)}
                      >
                        Ignore
                      </Button>
                    </div>
                  ) : null}
                </AdminMobileCard>
              ))}
            </AdminMobileCardGrid>
          }
        />
      </div>

      <AlertDialog open={!!solveTarget} onOpenChange={(o) => !o && setSolveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Solve statement issue?</AlertDialogTitle>
            <AlertDialogDescription>
              {solveTarget
                ? `This will ${solveTarget.suggested_adjustment_type} ${formatNPR(
                    solveTarget.suggested_amount || 0,
                  )} on ${solveTarget.user_phone || "user"} wallet. ${solveTarget.reason}`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => solveTarget && solveMutation.mutate(solveTarget.id)}
              disabled={solveMutation.isPending}
            >
              Confirm solve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              onClick={() => ignoreTarget && ignoreMutation.mutate(ignoreTarget.id)}
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
