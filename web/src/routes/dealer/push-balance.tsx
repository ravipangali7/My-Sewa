import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Phone, Search, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { PortalShell } from "@/components/layout/PortalShell";
import { PullToRefresh } from "@/components/PullToRefresh";
import { TransactionPinDialog } from "@/components/TransactionPinDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth";
import { isAccountPending, isWalletTxnLocked, walletTxnLockMessageKey } from "@/lib/account-status";
import { formatNPR } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { adminLiveQueryOptions, liveQueryOptions, refreshAppData, settingsQueryOptions } from "@/lib/refresh";
import type { PushBalanceUser } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dealer/push-balance")({
  head: () => ({
    meta: [
      { title: "Push Balance — Dealer Portal" },
      {
        name: "description",
        content: "Push wallet balance from your Dealer wallet into Users assigned to you.",
      },
    ],
  }),
  component: PushBalancePage,
});

function formatCardBalance(value: string | number) {
  const n = typeof value === "string" ? Number(value) : value;
  const amount = Number.isFinite(n) ? n : 0;
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;
}

function PushBalancePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, wallet } = useAuth();
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<PushBalanceUser | null>(null);
  const [amount, setAmount] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.role !== "dealer") {
      void navigate({ to: "/dealer" });
    }
  }, [user, navigate]);

  const listQuery = useQuery({
    queryKey: ["dealer", "push-balance"],
    queryFn: () => apiClient.dealerPushBalanceUsers(),
    ...adminLiveQueryOptions(),
    enabled: user?.role === "dealer",
  });
  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    ...liveQueryOptions(),
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
    ...settingsQueryOptions(),
  });

  const items = listQuery.data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((u) => {
      const hay = [
        u.display_name,
        u.phone,
        u.email ?? "",
        u.business_name ?? "",
        u.first_name,
        u.last_name,
        u.nickname ?? "",
        u.role_label,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q]);

  const dealerBalance = Number(walletQuery.data?.balance ?? wallet?.balance ?? 0);
  const amt = Number(amount);
  const minTransfer = settingsQuery.data?.config?.transactions?.min_transfer ?? 10;
  const maxTransfer = settingsQuery.data?.config?.transactions?.max_transfer ?? 100000;
  const accountPending = isAccountPending(user);
  const walletLocked = isWalletTxnLocked(walletQuery.data ?? wallet, user);
  const walletLockMessage = t(walletTxnLockMessageKey(walletQuery.data ?? wallet, user));

  const mutation = useMutation({
    mutationFn: (transaction_pin: string) => {
      if (!selected) throw new Error(t("pushBalance.pickUser"));
      if (accountPending) throw new Error(t("account.pending"));
      if (walletLocked) throw new Error(walletLockMessage);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error(t("load.validAmount"));
      if (amt < minTransfer) throw new Error(t("transfer.minError", { min: minTransfer }));
      if (maxTransfer > 0 && amt > maxTransfer) {
        throw new Error(t("transfer.maxError", { max: maxTransfer }));
      }
      if (dealerBalance < amt) {
        throw new Error(
          t("transfer.insufficient", {
            required: formatNPR(amt),
            available: formatNPR(dealerBalance),
          }),
        );
      }
      return apiClient.dealerPushBalance({
        user_id: selected.id,
        amount: Number(amt.toFixed(2)),
        remarks: "Push Balance",
        transaction_pin,
      });
    },
    onSuccess: (res) => {
      setPinOpen(false);
      setPinError(null);
      toast.success(res.message || t("pushBalance.success"), {
        description: t("transfer.debited", { amount: formatNPR(res.data.amount) }),
      });
      if (res.recipient) {
        queryClient.setQueryData(
          ["dealer", "push-balance"],
          (current: { items: PushBalanceUser[] } | undefined) => {
            const next = (current?.items ?? items).map((u) =>
              u.id === res.recipient.id ? res.recipient : u,
            );
            return { items: next };
          },
        );
      }
      setSelected(null);
      setAmount("");
      void queryClient.invalidateQueries({ queryKey: ["dealer"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet-transfers"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const body = err.body as Record<string, unknown>;
        const errors = body["errors"] as Record<string, string[]> | undefined;
        if (errors?.["transaction_pin"]?.[0] || body["code"] === "pin_not_set") {
          setPinError(errors?.["transaction_pin"]?.[0] || t("pin.incorrect"));
          return;
        }
        if (body["error"] === "Insufficient balance") {
          setPinOpen(false);
          toastApiError(err, {
            title: t("pushBalance.failed"),
            fallback: t("transfer.insufficient", {
              required: formatNPR(String(body["required"] ?? amt)),
              available: formatNPR(String(body["available"] ?? dealerBalance)),
            }),
          });
          return;
        }
      }
      setPinOpen(false);
      toastApiError(err, { title: t("pushBalance.failed"), fallback: t("pushBalance.failed") });
    },
  });

  function goBack() {
    if (selected) {
      setSelected(null);
      setAmount("");
      setPinOpen(false);
      setPinError(null);
      return;
    }
    void navigate({ to: "/dealer" });
  }

  const title = t("pushBalance.title");

  return (
    <PortalShell title={title} immersive>
      <div className="flex min-h-dvh flex-col bg-[#0A1B3D] text-white">
        <header
          className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-center px-2 pt-[var(--safe-area-top,env(safe-area-inset-top,0px))]"
          style={{ background: "#0A1B3D" }}
        >
          <button
            type="button"
            onClick={goBack}
            aria-label={t("common.goBack")}
            className="absolute left-1 inline-flex size-11 items-center justify-center text-white"
          >
            <ArrowLeft className="size-6" strokeWidth={2.25} />
          </button>
          <h1 className="text-[18px] font-bold tracking-wide text-white">{title}</h1>
        </header>

        <PullToRefresh onRefresh={() => refreshAppData(queryClient, { force: true })}>
          {selected ? (
            <AmountStep
              user={selected}
              amount={amount}
              onAmountChange={setAmount}
              dealerBalance={dealerBalance}
              minTransfer={minTransfer}
              maxTransfer={maxTransfer}
              disabled={accountPending || walletLocked || mutation.isPending}
              onContinue={() => {
                if (!Number.isFinite(amt) || amt <= 0) {
                  toast.error(t("load.validAmount"));
                  return;
                }
                if (amt < minTransfer) {
                  toast.error(t("transfer.minError", { min: minTransfer }));
                  return;
                }
                if (maxTransfer > 0 && amt > maxTransfer) {
                  toast.error(t("transfer.maxError", { max: maxTransfer }));
                  return;
                }
                if (dealerBalance < amt) {
                  toast.error(
                    t("transfer.insufficient", {
                      required: formatNPR(amt),
                      available: formatNPR(dealerBalance),
                    }),
                  );
                  return;
                }
                setPinError(null);
                setPinOpen(true);
              }}
            />
          ) : (
            <UserList
              loading={listQuery.isLoading}
              items={filtered}
              searchOpen={searchOpen}
              q={q}
              onQChange={setQ}
              onSelect={(u) => {
                setSelected(u);
                setAmount("");
              }}
            />
          )}
        </PullToRefresh>

        {!selected ? (
          <button
            type="button"
            aria-label={searchOpen ? t("common.cancel") : t("common.search")}
            onClick={() => {
              setSearchOpen((open) => {
                if (open) setQ("");
                return !open;
              });
            }}
            className="fixed right-5 bottom-[max(1.25rem,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] z-30 inline-flex size-14 items-center justify-center rounded-full bg-[#26C6DA] text-black shadow-[0_4px_14px_rgba(0,0,0,0.35)]"
          >
            {searchOpen ? <X className="size-6" strokeWidth={2.25} /> : <Search className="size-6" strokeWidth={2.25} />}
          </button>
        ) : null}

        <TransactionPinDialog
          open={pinOpen}
          onOpenChange={(open) => {
            setPinOpen(open);
            if (!open) setPinError(null);
          }}
          hasPin={Boolean(user?.has_transaction_pin)}
          confirming={mutation.isPending}
          error={pinError}
          title={t("pushBalance.pinTitle")}
          description={t("pushBalance.pinBody")}
          onConfirm={(pin) => mutation.mutate(pin)}
        />
      </div>
    </PortalShell>
  );
}

function UserList({
  loading,
  items,
  searchOpen,
  q,
  onQChange,
  onSelect,
}: {
  loading: boolean;
  items: PushBalanceUser[];
  searchOpen: boolean;
  q: string;
  onQChange: (value: string) => void;
  onSelect: (user: PushBalanceUser) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-[430px] px-3 pb-24 pt-2">
      {searchOpen ? (
        <div className="mb-3">
          <Input
            autoFocus
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder={t("pushBalance.searchPlaceholder")}
            className="h-11 rounded-lg border-white/20 bg-white text-foreground"
          />
        </div>
      ) : null}
      {loading ? (
        <p className="py-16 text-center text-sm text-white/70">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/70">{t("pushBalance.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((u) => (
            <li key={u.id}>
              <UserCard user={u} onPush={() => onSelect(u)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserCard({
  user,
  onPush,
  hideAction = false,
}: {
  user: PushBalanceUser;
  onPush?: () => void;
  hideAction?: boolean;
}) {
  const { t } = useI18n();
  return (
    <article className="overflow-hidden rounded-lg bg-white shadow-[0_2px_8px_rgba(0,0,0,0.28)]">
      <div
        className="flex items-start justify-between gap-3 px-3 py-2.5"
        style={{
          background: "linear-gradient(90deg, #3B82F6 0%, #60A5FA 48%, #818CF8 100%)",
        }}
      >
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold leading-tight text-white">
            {user.display_name}{" "}
            <span className="font-bold">({user.role_label})</span>
          </p>
          <p className="mt-0.5 text-[11px] font-medium tracking-wide text-white/90">
            MYSEWA
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5 text-white">
          <Wallet className="size-4" strokeWidth={2.25} />
          <span className="tabular text-[15px] font-bold leading-none">
            {formatCardBalance(user.wallet_balance)}
          </span>
        </div>
      </div>
      <div className={cn("bg-white px-3", hideAction ? "py-2.5" : "pt-2.5")}>
        <div className="flex items-center justify-between gap-3 pb-2">
          <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-black">
            <Phone className="size-3.5 shrink-0 text-[#1D4ED8]" strokeWidth={2.25} />
            <span className="truncate">{user.phone}</span>
          </p>
          <p className="min-w-0 truncate text-right text-[13px] text-black">
            {user.email || "—"}
          </p>
        </div>
        {hideAction ? null : (
          <button
            type="button"
            onClick={onPush}
            disabled={user.wallet_frozen}
            className="block h-10 w-full text-[13px] font-bold tracking-[0.08em] text-white disabled:opacity-50"
            style={{
              background: "#43A047",
              clipPath: "polygon(28% 0, 100% 0, 100% 100%, 0 100%)",
            }}
          >
            {t("pushBalance.action")}
          </button>
        )}
      </div>
    </article>
  );
}

function AmountStep({
  user,
  amount,
  onAmountChange,
  dealerBalance,
  minTransfer,
  maxTransfer,
  disabled,
  onContinue,
}: {
  user: PushBalanceUser;
  amount: string;
  onAmountChange: (value: string) => void;
  dealerBalance: number;
  minTransfer: number;
  maxTransfer: number;
  disabled: boolean;
  onContinue: () => void;
}) {
  const { t } = useI18n();
  const amt = Number(amount);
  const ready = Number.isFinite(amt) && amt > 0 && !disabled;

  return (
    <div className="mx-auto w-full max-w-[430px] px-3 pb-8 pt-2">
      <UserCard user={user} hideAction />
      <section className="mt-4 rounded-xl bg-white p-4 text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
        <p className="text-[13px] text-muted-foreground">{t("transfer.availableBalance")}</p>
        <p className="tabular mt-0.5 text-[22px] font-semibold text-foreground">
          {formatNPR(dealerBalance)}
        </p>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="push_amount">{t("pushBalance.amountLabel")}</Label>
          <Input
            id="push_amount"
            inputMode="decimal"
            placeholder={t("common.amountPlaceholder")}
            value={amount}
            onChange={(e) => onAmountChange(e.target.value.replace(/[^\d.]/g, ""))}
            className="tabular h-12 rounded-xl text-[22px] font-semibold"
            disabled={disabled}
          />
          <p className="text-[12px] text-muted-foreground">
            {t("common.minMax", { min: minTransfer, max: maxTransfer })}
          </p>
        </div>
        <div className="mt-4 rounded-xl bg-muted p-3 text-[14px]">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("pushBalance.walletTo")}</span>
            <span className="min-w-0 truncate font-medium">{user.display_name}</span>
          </div>
          <div className="mt-1.5 flex justify-between gap-3">
            <span className="text-muted-foreground">{t("common.amount")}</span>
            <span className="tabular font-medium">
              {formatNPR(Number.isFinite(amt) && amt > 0 ? amt : 0)}
            </span>
          </div>
        </div>
        <Button
          type="button"
          disabled={!ready}
          onClick={onContinue}
          className="mt-4 h-12 w-full rounded-xl bg-[#43A047] text-[16px] font-semibold text-white hover:bg-[#3D8B40]"
        >
          {t("common.continue")}
        </Button>
      </section>
    </div>
  );
}
