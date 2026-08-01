import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Upload, QrCode } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { ACCOUNT_PENDING_MESSAGE, isAccountPending } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";

export const Route = createFileRoute("/app/load")({
  head: () => ({
    meta: [
      { title: "Load Wallet — MySewa Remittance Deposit" },
      {
        name: "description",
        content:
          "Fund your MySewa wallet: scan the company QR or transfer to the bank account, then submit your deposit with screenshot proof.",
      },
      { property: "og:title", content: "Load Wallet — MySewa" },
      {
        property: "og:description",
        content: "Submit a remittance deposit with proof and track approval status.",
      },
    ],
  }),
  component: LoadWallet,
});

function LoadWallet() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const accountPending = isAccountPending(user);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });

  const depositsQuery = useQuery({
    queryKey: ["deposits"],
    queryFn: () => apiClient.listDeposits(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const payment = settingsQuery.data?.config?.payment;
  const security = settingsQuery.data?.config?.security;
  const depositsEnabled = payment?.deposits_enabled !== false && !accountPending;
  const requireScreenshot = security?.require_deposit_screenshot !== false;
  const minDeposit = payment?.min_deposit ?? 100;
  const maxDeposit = payment?.max_deposit ?? 100000;
  const instructions = payment?.deposit_instructions?.trim() || "";

  const createMutation = useMutation({
    mutationFn: async () => {
      if (accountPending) throw new Error(ACCOUNT_PENDING_MESSAGE);
      if (!depositsEnabled) throw new Error("Wallet deposits are currently disabled.");
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount");
      if (amt < minDeposit) throw new Error(`Minimum deposit is Rs. ${minDeposit}`);
      if (maxDeposit > 0 && amt > maxDeposit) throw new Error(`Maximum deposit is Rs. ${maxDeposit}`);
      if (requireScreenshot && !file) throw new Error("Screenshot proof is required");
      const fd = new FormData();
      fd.append("amount", amount);
      if (note.trim()) fd.append("note", note.trim());
      if (file) fd.append("screenshot_proof", file);
      return apiClient.createDeposit(fd);
    },
    onSuccess: () => {
      toast.success("Deposit submitted", { description: "Status: pending admin approval" });
      setAmount("");
      setNote("");
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : "Submit failed");
    },
  });

  const bank = settingsQuery.data?.bank_details ?? {};
  const bankEntries = Object.entries(bank).filter(([, v]) => v);

  return (
    <UserShell title="Load Wallet" back="/app">
      <div className="grid gap-5 lg:grid-cols-2">
        {accountPending ? (
          <div className="lg:col-span-2">
            <AccountPendingBanner />
          </div>
        ) : null}
        {!depositsEnabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4 lg:col-span-2">
            <p className="text-[15px] font-medium text-destructive">Deposits temporarily unavailable</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Wallet deposits are currently disabled by the administrator. Please try again later.
            </p>
          </section>
        ) : null}

        <section className="inset-group p-4">
          <h2 className="text-[15px] font-semibold">Pay to MySewa</h2>
          {instructions ? (
            <p className="mt-2 text-[13px] text-muted-foreground whitespace-pre-wrap">{instructions}</p>
          ) : null}
          <div className="mt-3 flex gap-4">
            <div className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-separator bg-muted text-muted-foreground">
              {settingsQuery.data?.qr_code_url ? (
                <img
                  src={settingsQuery.data.qr_code_url}
                  alt="Deposit QR"
                  className="size-full object-contain"
                />
              ) : (
                <QrCode className="size-12" />
              )}
            </div>
            <dl className="flex-1 space-y-1.5 text-[14px]">
              {settingsQuery.isLoading ? (
                <p className="text-muted-foreground">Loading bank details…</p>
              ) : bankEntries.length === 0 ? (
                <p className="text-muted-foreground">Bank details not configured yet.</p>
              ) : (
                bankEntries.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</dt>
                    <dd className="text-right font-medium">{v}</dd>
                  </div>
                ))
              )}
            </dl>
          </div>
        </section>

        <section className="inset-group p-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount (NPR)</Label>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular h-12 rounded-xl text-[22px] font-semibold"
                required
                disabled={!depositsEnabled}
              />
              <p className="text-[12px] text-muted-foreground">
                Min Rs. {minDeposit}
                {maxDeposit > 0 ? ` · Max Rs. ${maxDeposit}` : ""}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Note (optional)</Label>
              <Textarea
                id="note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="rounded-xl"
                placeholder="e.g. Remittance from Qatar"
                disabled={!depositsEnabled}
              />
            </div>
            {requireScreenshot ? (
              <div className="space-y-1.5">
                <Label htmlFor="proof">Screenshot proof</Label>
                <label
                  htmlFor="proof"
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-separator px-4 py-4 text-[15px] text-muted-foreground"
                >
                  <Upload className="size-5" />
                  {file?.name ?? "Upload payment screenshot"}
                </label>
                <input
                  id="proof"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required={requireScreenshot}
                  disabled={!depositsEnabled}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="proof">Screenshot proof (optional)</Label>
                <label
                  htmlFor="proof"
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-separator px-4 py-4 text-[15px] text-muted-foreground"
                >
                  <Upload className="size-5" />
                  {file?.name ?? "Upload payment screenshot"}
                </label>
                <input
                  id="proof"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  disabled={!depositsEnabled}
                />
              </div>
            )}
            <Button
              type="submit"
              disabled={createMutation.isPending || !depositsEnabled}
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {createMutation.isPending ? "Submitting…" : "Submit deposit"}
            </Button>
          </form>
        </section>

        <section className="lg:col-span-2">
          <h2 className="mb-2 px-1 text-[17px] font-semibold">My deposits</h2>
          {depositsQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : !depositsQuery.data?.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              No deposits yet.
            </div>
          ) : (
            <ul className="inset-group divide-y divide-border">
              {depositsQuery.data.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">
                      {formatNPR(d.amount)}{" "}
                      <span className="text-[13px] font-normal text-muted-foreground">
                        · #{d.id}
                      </span>
                    </p>
                    <p className="truncate text-[13px] text-muted-foreground">
                      {d.note ?? "No note"} · {formatDateTime(d.created_at)}
                    </p>
                    {d.status === "rejected" && d.rejection_reason ? (
                      <p className="mt-0.5 text-[13px] text-destructive">
                        Reason: {d.rejection_reason}
                      </p>
                    ) : null}
                  </div>
                  <StatusChip status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </UserShell>
  );
}
