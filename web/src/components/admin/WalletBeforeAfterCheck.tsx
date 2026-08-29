import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusChip } from "@/components/StatusChip";
import { apiClient, ApiError } from "@/lib/api";
import { formatDate, formatDateTime, formatNPR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WalletBalanceIssue } from "@/lib/types";
import { canWalletAdjust } from "@/lib/account-status";
import { useAuth } from "@/lib/auth";

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthStartISO(from = todayISO()) {
  return `${from.slice(0, 7)}-01`;
}

function formatTxnTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(9rem,38%)_1fr] gap-2 border-b border-border/70 py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground break-all">{value}</dd>
    </div>
  );
}

export function WalletBeforeAfterCheck() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const allowAdjust = canWalletAdjust(user);

  const [fromDate, setFromDate] = useState(() => monthStartISO());
  const [toDate, setToDate] = useState(() => todayISO());
  const [statusFilter, setStatusFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WalletBalanceIssue | null>(null);

  const listFilters = useMemo(
    () => ({
      status: statusFilter,
      start_date: fromDate,
      end_date: toDate,
      q: search.trim() || undefined,
    }),
    [statusFilter, fromDate, toDate, search],
  );

  const listQuery = useQuery({
    queryKey: ["admin", "statement", "before-after", listFilters],
    queryFn: () => apiClient.adminWalletBeforeAfter(listFilters),
    refetchOnMount: "always",
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "statement", "before-after"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
  };

  const scanMutation = useMutation({
    mutationFn: () =>
      apiClient.adminWalletBeforeAfterScan({ from_date: fromDate, to_date: toDate }),
    onSuccess: (res) => {
      toast.success(res.message || "Scan complete");
      invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Scan failed");
    },
  });

  const shareMutation = useMutation({
    mutationFn: (id: number) => apiClient.adminWalletBeforeAfterShare(id),
    onSuccess: (res) => {
      toast.success(res.message || "Issue confirmed and user emailed");
      setSelected(null);
      invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Confirmation failed");
    },
  });

  const items = listQuery.data?.items ?? [];
  const openIssues = listQuery.data?.summary?.open_issues ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">
          Compares each user&apos;s recorded wallet balance before and after a transaction.
          If an amount was deducted (or credited) but the after-balance did not change,
          it appears here so you can confirm the correction and notify the user.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="ba-from">From</Label>
            <Input
              id="ba-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ba-to">To</Label>
            <Input
              id="ba-to"
              type="date"
              value={toDate}
              max={todayISO()}
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
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ba-q">Search</Label>
            <Input
              id="ba-q"
              placeholder="Phone, name, reference…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending || !fromDate || !toDate}
          >
            <RefreshCw className={`mr-2 size-4 ${scanMutation.isPending ? "animate-spin" : ""}`} />
            {scanMutation.isPending ? "Checking…" : "Run before/after check"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {openIssues} open issue{openIssues === 1 ? "" : "s"}
            {listQuery.data?.count != null ? ` · ${listQuery.data.count} in this filter` : ""}
          </p>
        </div>
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading before/after issues…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No before/after mismatches in this range. Run a check after selecting dates.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Transaction</TableHead>
                <TableHead>Before → After</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const isOpen = item.status === "open";
                return (
                  <TableRow key={item.id} className={cn(isOpen && "bg-warning/5")}>
                    <TableCell className="align-top">
                      <div className="text-sm font-medium">{item.user_name || item.user_phone || "—"}</div>
                      {item.user_phone ? (
                        <div className="text-[11px] text-muted-foreground">{item.user_phone}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="font-medium">
                        {item.service_name || item.txn_type_display}
                        <span className="ml-1 capitalize text-muted-foreground">
                          · {item.direction}
                        </span>
                      </div>
                      <div className="text-sm tabular-nums">{formatNPR(item.amount)}</div>
                      <div className="font-mono text-[11px] text-muted-foreground break-all">
                        {item.txn_reference || `ID ${item.txn_id}`}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatDateTime(item.txn_at)}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm tabular-nums">
                      {formatNPR(item.balance_before)}
                      {" → "}
                      <span className="text-warning-foreground">{formatNPR(item.recorded_balance_after)}</span>
                      {isOpen ? (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-warning-foreground">
                          <AlertTriangle className="size-3" />
                          Amount not reflected
                        </div>
                      ) : (
                        <StatusChip status={item.status} compact className="mt-1" />
                      )}
                    </TableCell>
                    <TableCell className="align-top text-sm tabular-nums">
                      {formatNPR(item.expected_balance_after)}
                      <div className="text-[11px] text-muted-foreground">
                        Wallet now {formatNPR(item.current_wallet_balance)}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {isOpen && item.can_share && allowAdjust ? (
                        <Button size="sm" onClick={() => setSelected(item)}>
                          Issue Share
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {item.status_display || item.status}
                          {item.shared_at ? ` · ${formatDateTime(item.shared_at)}` : ""}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue Share</DialogTitle>
            <DialogDescription>
              Review the discrepancy, then confirm to correct the wallet and email the user.
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <dl className="rounded-lg border border-border bg-muted/20 px-3">
              <DetailRow label="User" value={selected.user_name || selected.user_phone || "—"} />
              <DetailRow label="Phone" value={selected.user_phone || "—"} />
              <DetailRow label="Previous balance" value={formatNPR(selected.balance_before)} />
              <DetailRow
                label={selected.direction === "credit" ? "Amount credited" : "Amount deducted"}
                value={formatNPR(selected.amount)}
              />
              <DetailRow label="Expected / actual balance" value={formatNPR(selected.expected_balance_after)} />
              <DetailRow label="System-displayed balance" value={formatNPR(selected.recorded_balance_after)} />
              <DetailRow label="Current wallet" value={formatNPR(selected.current_wallet_balance)} />
              <DetailRow label="Transaction date" value={formatDate(selected.txn_at)} />
              <DetailRow label="Transaction time" value={formatTxnTime(selected.txn_at)} />
              <DetailRow
                label="Transaction / reference ID"
                value={selected.txn_reference || `ID ${selected.txn_id}`}
              />
              <DetailRow
                label="Type / service"
                value={`${selected.txn_type_display}${selected.service_name ? ` · ${selected.service_name}` : ""}`}
              />
              <DetailRow label="Before balance" value={formatNPR(selected.balance_before)} />
              <DetailRow label="After balance (stored)" value={formatNPR(selected.recorded_balance_after)} />
              {selected.description ? (
                <DetailRow label="Details" value={selected.description} />
              ) : null}
              {selected.suggested_amount ? (
                <DetailRow
                  label="Correction"
                  value={`${selected.suggested_adjustment_type} ${formatNPR(selected.suggested_amount)}`}
                />
              ) : null}
            </dl>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Confirming writes a wallet ledger entry, updates the user&apos;s balance, records
            who confirmed and when, and emails the user. The same issue cannot be corrected twice.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button
              disabled={shareMutation.isPending || !selected}
              onClick={() => selected && shareMutation.mutate(selected.id)}
            >
              {shareMutation.isPending ? "Confirming…" : "Confirm & email user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
