import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient, ApiError } from "@/lib/api";
import type { BankOption } from "@/lib/types";
import { formatNPR, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/transfer")({
  head: () => ({
    meta: [
      { title: "Bank Transfer — Send Money in Nepal | MySewa" },
      {
        name: "description",
        content:
          "Send money from your MySewa wallet to any supported Nepali bank account: verify the account, review the charge and confirm.",
      },
      { property: "og:title", content: "Bank Transfer — MySewa" },
      {
        property: "og:description",
        content: "Verified outbound bank transfers from your MySewa wallet balance.",
      },
    ],
  }),
  component: Transfer,
});

function Transfer() {
  const queryClient = useQueryClient();
  const [bank, setBank] = useState("");
  const [accNo, setAccNo] = useState("");
  const [accName, setAccName] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("Fund Transfer");
  const [verified, setVerified] = useState(false);
  const [merchantTxnId, setMerchantTxnId] = useState<string | undefined>();
  const [charge, setCharge] = useState("0.00");
  const [cashback, setCashback] = useState("0.00");
  const [totalDebited, setTotalDebited] = useState("0.00");
  const [verifying, setVerifying] = useState(false);

  const banksQuery = useQuery({
    queryKey: ["banks"],
    queryFn: async () => {
      const res = await apiClient.listBanks();
      return (res.banks || res.data?.banks || []) as BankOption[];
    },
  });

  const historyQuery = useQuery({
    queryKey: ["transfers"],
    queryFn: () => apiClient.transferHistory(),
  });

  const banks = banksQuery.data ?? [];
  const amt = Number(amount) || 0;

  useEffect(() => {
    if (!bank && banks[0]) setBank(banks[0].bank_code);
  }, [banks, bank]);

  useEffect(() => {
    if (amt < 10) {
      setCharge("0.00");
      setCashback("0.00");
      setTotalDebited("0.00");
      return;
    }
    const t = setTimeout(() => {
      apiClient
        .calculateTransfer(amt)
        .then((res) => {
          setCharge(String(res.data.charge));
          setCashback(String(res.data.cashback));
          setTotalDebited(String(res.data.total_debited));
        })
        .catch(() => {
          setCharge("0.00");
          setCashback("0.00");
          setTotalDebited(amt.toFixed(2));
        });
    }, 350);
    return () => clearTimeout(t);
  }, [amt]);

  const selectedBank = banks.find((b) => b.bank_code === bank);

  const submitMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        amount: amt,
        destination_bank: bank,
        destination_bank_name: selectedBank?.bank_name || "",
        destination_acc_no: accNo,
        destination_acc_name: accName,
        is_destination_mobile: false,
        transaction_remarks: remarks || "Fund Transfer",
      };
      if (merchantTxnId) body["merchant_txn_id"] = merchantTxnId;
      return apiClient.createTransfer(body);
    },
    onSuccess: (res) => {
      toast.success(res.message || "Transfer submitted", {
        description: `Total debited ${formatNPR(res.data.total_debited || totalDebited)}`,
      });
      setAccNo("");
      setAccName("");
      setAmount("");
      setVerified(false);
      setMerchantTxnId(undefined);
      queryClient.invalidateQueries({ queryKey: ["transfers"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Transfer failed");
    },
  });

  return (
    <UserShell title="Bank Transfer" back="/app">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="inset-group p-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!verified) {
                toast.error("Verify the destination account first");
                return;
              }
              submitMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label>Destination bank</Label>
              <Select
                value={bank}
                onValueChange={(v) => {
                  setBank(v);
                  setVerified(false);
                }}
              >
                <SelectTrigger className="h-12 w-full rounded-xl">
                  <SelectValue placeholder={banksQuery.isLoading ? "Loading banks…" : "Select bank"} />
                </SelectTrigger>
                <SelectContent>
                  {banks.map((b) => (
                    <SelectItem key={b.bank_code} value={b.bank_code}>
                      {b.bank_name} ({b.bank_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="accName">Account holder name</Label>
              <Input
                id="accName"
                value={accName}
                onChange={(e) => {
                  setAccName(e.target.value);
                  setVerified(false);
                }}
                className="h-12 rounded-xl"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="acc">Destination account number</Label>
              <div className="flex gap-2">
                <Input
                  id="acc"
                  value={accNo}
                  onChange={(e) => {
                    setAccNo(e.target.value);
                    setVerified(false);
                  }}
                  className="h-12 rounded-xl"
                  required
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-12 rounded-xl"
                  disabled={verifying}
                  onClick={async () => {
                    if (!bank || !accName.trim() || accNo.length < 5) {
                      toast.error("Enter bank, account name and number");
                      return;
                    }
                    setVerifying(true);
                    try {
                      const res = await apiClient.verifyBank({
                        bank_code: bank,
                        account_name: accName.trim(),
                        account_number: accNo.trim(),
                        is_mobile: false,
                      });
                      setVerified(!!res.data?.verified);
                      setMerchantTxnId(res.data?.merchant_txn_id);
                      toast.success(res.message || "Account verified");
                    } catch (err) {
                      setVerified(false);
                      toast.error(err instanceof ApiError ? err.message : "Verification failed");
                    } finally {
                      setVerifying(false);
                    }
                  }}
                >
                  {verifying ? "…" : "Verify"}
                </Button>
              </div>
              {verified && (
                <p className="text-[13px] text-success">Account verified: {accName}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tamount">Amount (NPR)</Label>
              <Input
                id="tamount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular h-12 rounded-xl text-[22px] font-semibold"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="remarks">Transaction remarks</Label>
              <Input
                id="remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="h-12 rounded-xl"
              />
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
              disabled={submitMutation.isPending}
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {submitMutation.isPending ? "Processing…" : "Confirm transfer"}
            </Button>
          </form>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-[17px] font-semibold">Recent transfers</h2>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : !historyQuery.data?.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              No transfers yet.
            </div>
          ) : (
            <ul className="inset-group divide-y divide-border">
              {historyQuery.data.map((b) => (
                <li key={b.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{b.destination_acc_name}</p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {b.destination_bank_name || b.destination_bank} · {b.destination_acc_no}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-[15px] font-semibold">{formatNPR(b.amount)}</p>
                      <StatusChip status={b.status} compact className="mt-1" />
                    </div>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {b.merchant_txn_id} · {formatDateTime(b.created_at)} · Debited{" "}
                    {formatNPR(b.total_debited)}
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
