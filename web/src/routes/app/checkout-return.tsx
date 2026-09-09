import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

type CheckoutReturnSearch = {
  order?: string;
  deposit?: string;
  error?: string;
};

export const Route = createFileRoute("/app/checkout-return")({
  validateSearch: (search: Record<string, unknown>): CheckoutReturnSearch => ({
    order: typeof search.order === "string" ? search.order : undefined,
    deposit: typeof search.deposit === "string" ? search.deposit : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Himal Pay Checkout — MySewa" },
      {
        name: "description",
        content: "Confirm your Himal Pay wallet deposit after returning from N-Cash Checkout.",
      },
    ],
  }),
  component: CheckoutReturnPage,
});

function CheckoutReturnPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token } = useAuth();
  const search = Route.useSearch();
  const order = search.order?.trim() || "";
  const depositId = Number(search.deposit || 0);

  const verifyQuery = useQuery({
    queryKey: ["checkout-verify", order, depositId],
    enabled: Boolean(token) && (Boolean(order) || depositId > 0),
    queryFn: () =>
      apiClient.checkoutVerify({
        ...(depositId > 0 ? { id: depositId } : {}),
        ...(order ? { purchase_order_identifier: order, order } : {}),
      }),
    retry: false,
  });

  useEffect(() => {
    if (!verifyQuery.isSuccess) return;
    void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["deposits"] });
  }, [verifyQuery.isSuccess, queryClient]);

  const deposit = verifyQuery.data?.data;
  const outcome = verifyQuery.data?.outcome;
  const approved = deposit?.status === "approved";
  const pending =
    deposit?.status === "pending" ||
    deposit?.status === "processing" ||
    outcome === "pending_payment";

  const title = useMemo(() => {
    if (search.error === "not_found") return t("load.checkoutNotFound");
    if (verifyQuery.isLoading) return t("load.checkoutVerifying");
    if (approved) return t("load.checkoutSuccess");
    if (pending) return t("load.checkoutPending");
    if (deposit) return t("load.checkoutNotPaid");
    return t("load.checkoutVerifying");
  }, [approved, pending, deposit, search.error, t, verifyQuery.isLoading]);

  return (
    <UserShell title={t("load.checkoutTitle")} back="/app/load">
      <section className="inset-group space-y-4 p-4">
        <h1 className="text-[17px] font-semibold">{title}</h1>
        {verifyQuery.isError ? (
          <p className="text-sm text-destructive">
            {verifyQuery.error instanceof ApiError
              ? verifyQuery.error.message
              : t("load.checkoutFailed")}
          </p>
        ) : null}
        {deposit ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("load.depositedAmount")}</span>
              <span className="tabular font-semibold">{formatNPR(deposit.amount)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("common.status")}</span>
              <StatusChip status={deposit.status} />
            </div>
            {deposit.purchase_order_identifier ? (
              <p className="break-all text-[13px] text-muted-foreground">
                {t("load.checkoutOrder")}: {deposit.purchase_order_identifier}
              </p>
            ) : null}
            {deposit.process_id ? (
              <p className="break-all text-[13px] text-muted-foreground">
                {t("load.checkoutTxn")}: {deposit.process_id}
              </p>
            ) : null}
            {(deposit.failure_reason || deposit.rejection_reason) && !approved ? (
              <p className="text-[13px] text-destructive">
                {deposit.failure_reason || deposit.rejection_reason}
              </p>
            ) : null}
            <p className="text-[12px] text-muted-foreground">{t("load.checkoutVerifyNote")}</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button className="h-11 rounded-xl" onClick={() => void navigate({ to: "/app" })}>
            {t("load.checkoutBackWallet")}
          </Button>
          <Button variant="outline" className="h-11 rounded-xl" asChild>
            <Link to="/app/load">{t("load.checkoutBackLoad")}</Link>
          </Button>
        </div>
      </section>
    </UserShell>
  );
}
