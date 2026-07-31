import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient, ApiError } from "@/lib/api";
import { OPERATORS } from "@/lib/constants";
import { formatNPR, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/topup")({
  head: () => ({
    meta: [
      { title: "Mobile Top-Up NTC & NCELL — MySewa" },
      {
        name: "description",
        content:
          "Recharge NTC or NCELL mobile numbers from your MySewa wallet balance with a clear charge and cashback breakdown.",
      },
      { property: "og:title", content: "Mobile Top-Up — MySewa" },
      {
        property: "og:description",
        content: "NTC and NCELL recharge straight from your wallet balance.",
      },
    ],
  }),
  component: TopUp,
});

function TopUp() {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState<1 | 2>(1);
  const [mobile, setMobile] = useState("");
  const [amount, setAmount] = useState("");
  const [charge, setCharge] = useState("0.00");
  const [cashback, setCashback] = useState("0.00");
  const [totalDebited, setTotalDebited] = useState("0.00");

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });
  const topupsEnabled = settingsQuery.data?.config?.payment?.topups_enabled !== false;
  const minTopup = settingsQuery.data?.config?.transactions?.min_topup ?? 10;
  const maxTopup = settingsQuery.data?.config?.transactions?.max_topup ?? 5000;

  const historyQuery = useQuery({
    queryKey: ["topups"],
    queryFn: () => apiClient.topupHistory(),
  });

  const amt = Number(amount) || 0;
  const serviceName = productId === 1 ? "NTC" : "NCELL";

  useEffect(() => {
    if (!topupsEnabled || amt < minTopup) {
      setCharge("0.00");
      setCashback("0.00");
      setTotalDebited("0.00");
      return;
    }
    const t = setTimeout(() => {
      apiClient
        .calculateCharge(serviceName, amt)
        .then((res) => {
          setCharge(String(res.charge));
          setCashback(String(res.cashback));
          setTotalDebited(String(res.total_debited));
        })
        .catch(() => {
          setCharge("0.00");
          setCashback("0.00");
          setTotalDebited(amt.toFixed(2));
        });
    }, 350);
    return () => clearTimeout(t);
  }, [amt, serviceName, topupsEnabled, minTopup]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!topupsEnabled) throw new Error("Mobile top-ups are currently disabled.");
      if (amt < minTopup) throw new Error(`Minimum top-up is Rs. ${minTopup}`);
      if (maxTopup > 0 && amt > maxTopup) throw new Error(`Maximum top-up is Rs. ${maxTopup}`);
      const body = { mobile_number: mobile.trim(), amount: amt, product_id: productId };
      if (productId === 1) return apiClient.topupNtc({ ...body, product_id: 1 });
      return apiClient.topupNcell({ ...body, product_id: 2 });
    },
    onSuccess: (res) => {
      toast.success(res.message || `${OPERATORS[productId]} top-up submitted`, {
        description: `Total debited ${formatNPR(res.data.total_debited || totalDebited)}`,
      });
      setMobile("");
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["topups"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Top-up failed");
    },
  });

  return (
    <UserShell title="Mobile Top-Up" back="/app">
      <div className="grid gap-5 lg:grid-cols-2">
        {!topupsEnabled ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4 lg:col-span-2">
            <p className="text-[15px] font-medium text-destructive">Top-ups temporarily unavailable</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Mobile top-ups are currently disabled by the administrator.
            </p>
          </section>
        ) : null}
        <section className="inset-group p-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitMutation.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
              {([1, 2] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setProductId(id)}
                  disabled={!topupsEnabled}
                  className={cn(
                    "rounded-lg py-2 text-[15px] font-medium transition-colors",
                    productId === id
                      ? "bg-surface text-brand-dark shadow-card"
                      : "text-muted-foreground",
                  )}
                >
                  {OPERATORS[id]}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mobile_number">Mobile number</Label>
              <Input
                id="mobile_number"
                inputMode="tel"
                placeholder="98XXXXXXXX"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="h-12 rounded-xl"
                required
                disabled={!topupsEnabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="topup_amount">Amount (NPR)</Label>
              <Input
                id="topup_amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular h-12 rounded-xl text-[22px] font-semibold"
                required
                disabled={!topupsEnabled}
              />
              <p className="text-[12px] text-muted-foreground">
                Min Rs. {minTopup}
                {maxTopup > 0 ? ` · Max Rs. ${maxTopup}` : ""}
              </p>
            </div>

            <div className="rounded-xl bg-muted p-3 text-[14px]">
              <Row label="Amount" value={formatNPR(amt)} />
              <Row label="Charge" value={formatNPR(charge)} />
              <Row label="Cashback" value={`− ${formatNPR(cashback)}`} />
              <div className="mt-2 border-t border-separator pt-2">
                <Row label="Total debited" value={formatNPR(totalDebited)} strong />
              </div>
            </div>

            <Button
              type="submit"
              disabled={submitMutation.isPending || !topupsEnabled}
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {submitMutation.isPending ? "Processing…" : "Confirm top-up"}
            </Button>
          </form>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-[17px] font-semibold">Recent top-ups</h2>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : !historyQuery.data?.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              No top-ups yet.
            </div>
          ) : (
            <ul className="inset-group divide-y divide-border">
              {historyQuery.data.map((t) => (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium">
                        {t.product_name || OPERATORS[t.product_id]} · {t.mobile_number}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {t.merchant_txn_id} · {formatDateTime(t.created_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-[15px] font-semibold">{formatNPR(t.amount)}</p>
                      <StatusChip status={t.status} compact className="mt-1" />
                    </div>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Charge {formatNPR(t.charge)} · Cashback {formatNPR(t.cashback)} · Debited{" "}
                    {formatNPR(t.total_debited)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </UserShell>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular", strong ? "font-semibold" : "font-medium")}>{value}</span>
    </div>
  );
}
