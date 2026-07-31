import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { BankCombobox } from "@/components/BankCombobox";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiClient, ApiError } from "@/lib/api";
import { mergeBankLists } from "@/lib/nepali-banks";
import type { BankOption } from "@/lib/types";
import { formatNPR, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/transfer")({
  head: () => ({
    meta: [
      { title: "Fund Transfer — Send Money in Nepal | MySewa" },
      {
        name: "description",
        content:
          "Send money from your MySewa wallet to any Nepali bank account or mobile number: verify, review charges and confirm.",
      },
      { property: "og:title", content: "Fund Transfer — MySewa" },
      {
        property: "og:description",
        content: "Bank account or phone number transfers from your MySewa wallet.",
      },
    ],
  }),
  component: Transfer,
});

type TransferMethod = "bank" | "phone";

function Transfer() {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<TransferMethod>("bank");
  const [bank, setBank] = useState("");
  const [accNo, setAccNo] = useState("");
  const [accName, setAccName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("Fund Transfer");
  const [verified, setVerified] = useState(false);
  const [merchantTxnId, setMerchantTxnId] = useState<string | undefined>();
  const [charge, setCharge] = useState("0.00");
  const [cashback, setCashback] = useState("0.00");
  const [totalDebited, setTotalDebited] = useState("0.00");
  const [verifying, setVerifying] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });
  const transfersEnabled = settingsQuery.data?.config?.payment?.transfers_enabled !== false;
  const minTransfer = settingsQuery.data?.config?.transactions?.min_transfer ?? 10;
  const maxTransfer = settingsQuery.data?.config?.transactions?.max_transfer ?? 100000;
  const dailyLimit = settingsQuery.data?.config?.transactions?.daily_transfer_limit ?? 200000;
  const chargeEnabled =
    settingsQuery.data?.config?.transactions?.transfer_charge_enabled !== false;
  const cashbackEnabled =
    settingsQuery.data?.config?.transactions?.cashback_enabled !== false;

  const banksQuery = useQuery({
    queryKey: ["banks"],
    queryFn: async () => {
      const res = await apiClient.listBanks();
      return (res.banks || res.data?.banks || []) as BankOption[];
    },
    enabled: transfersEnabled,
  });

  const historyQuery = useQuery({
    queryKey: ["transfers"],
    queryFn: () => apiClient.transferHistory(),
  });

  const banks = useMemo(
    () => mergeBankLists(banksQuery.data ?? []),
    [banksQuery.data],
  );
  const amt = Number(amount) || 0;
  const isMobile = method === "phone";
  const destinationNumber = isMobile ? phone.trim() : accNo.trim();

  useEffect(() => {
    if (!bank && banks[0]) setBank(banks[0].bank_code);
  }, [banks, bank]);

  useEffect(() => {
    setVerified(false);
    setMerchantTxnId(undefined);
  }, [method]);

  useEffect(() => {
    if (!transfersEnabled || amt < minTransfer) {
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
  }, [amt, transfersEnabled, minTransfer]);

  const selectedBank = banks.find((b) => b.bank_code === bank);

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!transfersEnabled) throw new Error("Bank transfers are currently disabled.");
      if (amt < minTransfer) throw new Error(`Minimum transfer is Rs. ${minTransfer}`);
      if (maxTransfer > 0 && amt > maxTransfer) {
        throw new Error(`Maximum transfer is Rs. ${maxTransfer}`);
      }
      const body: Record<string, unknown> = {
        amount: amt,
        destination_bank: bank,
        destination_bank_name: selectedBank?.bank_name || "",
        destination_acc_no: destinationNumber,
        destination_acc_name: accName,
        is_destination_mobile: isMobile,
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
      setPhone("");
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

  async function verifyDestination() {
    if (!bank || !accName.trim()) {
      toast.error("Enter bank and account holder name");
      return;
    }
    if (isMobile) {
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10) {
        toast.error("Enter a valid Nepali mobile number");
        return;
      }
    } else if (accNo.trim().length < 5) {
      toast.error("Enter a valid account number");
      return;
    }
    setVerifying(true);
    try {
      const res = await apiClient.verifyBank({
        bank_code: bank,
        account_name: accName.trim(),
        account_number: destinationNumber,
        is_mobile: isMobile,
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
  }

  return (
    <UserShell title="Fund Transfer" back="/app">
      <div className="grid gap-5 lg:grid-cols-2">
        {!transfersEnabled ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4 lg:col-span-2">
            <p className="text-[15px] font-medium text-destructive">Transfers temporarily unavailable</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Fund transfers are currently disabled by the administrator.
            </p>
          </section>
        ) : null}
        <section className="inset-group p-4">
          <Tabs
            value={method}
            onValueChange={(v) => setMethod(v as TransferMethod)}
            className="mb-4"
          >
            <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl">
              <TabsTrigger value="bank" className="rounded-lg" disabled={!transfersEnabled}>
                Bank account
              </TabsTrigger>
              <TabsTrigger value="phone" className="rounded-lg" disabled={!transfersEnabled}>
                Phone number
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!verified) {
                toast.error(
                  isMobile
                    ? "Verify the destination phone number first"
                    : "Verify the destination account first",
                );
                return;
              }
              submitMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label>Destination bank</Label>
              <BankCombobox
                banks={banks}
                value={bank}
                loading={banksQuery.isLoading}
                disabled={!transfersEnabled}
                onChange={(v) => {
                  setBank(v);
                  setVerified(false);
                }}
              />
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
                disabled={!transfersEnabled}
              />
            </div>

            {isMobile ? (
              <div className="space-y-1.5">
                <Label htmlFor="phone">Destination phone number</Label>
                <div className="flex gap-2">
                  <Input
                    id="phone"
                    inputMode="tel"
                    placeholder="98XXXXXXXX"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setVerified(false);
                    }}
                    className="h-12 rounded-xl"
                    required
                    disabled={!transfersEnabled}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12 rounded-xl"
                    disabled={verifying || !transfersEnabled}
                    onClick={verifyDestination}
                  >
                    {verifying ? "…" : "Verify"}
                  </Button>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  Send to a bank account linked to this mobile number (same-bank style transfer).
                </p>
                {verified && (
                  <p className="text-[13px] text-success">Phone verified: {accName}</p>
                )}
              </div>
            ) : (
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
                    disabled={!transfersEnabled}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12 rounded-xl"
                    disabled={verifying || !transfersEnabled}
                    onClick={verifyDestination}
                  >
                    {verifying ? "…" : "Verify"}
                  </Button>
                </div>
                {verified && (
                  <p className="text-[13px] text-success">Account verified: {accName}</p>
                )}
              </div>
            )}

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
                disabled={!transfersEnabled}
              />
              <p className="text-[12px] text-muted-foreground">
                Min Rs. {minTransfer}
                {maxTransfer > 0 ? ` · Max Rs. ${maxTransfer}` : ""}
                {dailyLimit > 0 ? ` · Daily limit Rs. ${dailyLimit}` : ""}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="remarks">Transaction remarks</Label>
              <Input
                id="remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="h-12 rounded-xl"
                disabled={!transfersEnabled}
              />
            </div>

            <div className="rounded-xl bg-muted p-3 text-[14px]">
              <Row label="Amount" value={formatNPR(amt)} />
              {chargeEnabled ? <Row label="Charge" value={formatNPR(charge)} /> : null}
              {cashbackEnabled ? (
                <Row label="Cashback" value={`− ${formatNPR(cashback)}`} />
              ) : null}
              <div className="mt-2 border-t border-separator pt-2">
                <Row label="Total debited" value={formatNPR(totalDebited)} strong />
              </div>
            </div>

            <Button
              type="submit"
              disabled={submitMutation.isPending || !transfersEnabled}
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
                        {b.is_destination_mobile ? "Phone · " : ""}
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
