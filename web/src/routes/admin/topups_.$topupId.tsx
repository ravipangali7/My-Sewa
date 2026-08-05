import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { StatusChip } from "@/components/StatusChip";
import { apiClient, ApiError } from "@/lib/api";
import { OPERATORS } from "@/lib/constants";
import { formatDateTime, formatNPR } from "@/lib/format";

export const Route = createFileRoute("/admin/topups_/$topupId")({
  head: () => ({
    meta: [
      { title: "Top-up Statement — MySewa Admin" },
      {
        name: "description",
        content:
          "View full mobile top-up statement including charges, cashback, wallet debit, and provider response.",
      },
      { property: "og:title", content: "Top-up Statement — MySewa Admin" },
    ],
  }),
  component: TopupDetailPage,
});

function StatementRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-dashed border-border/80 py-2.5 last:border-0 md:grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)] md:gap-3">
      <dt className="min-w-0 break-words text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="min-w-0 break-all text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

function topupDisplayName(t: {
  first_name?: string;
  last_name?: string;
  phone: string;
}) {
  const name = [t.first_name, t.last_name].filter(Boolean).join(" ").trim();
  return name || t.phone;
}

function formatProviderResponse(value: Record<string, unknown> | null | undefined) {
  if (!value || Object.keys(value).length === 0) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function TopupDetailPage() {
  const { topupId } = Route.useParams();
  const id = Number(topupId);

  const topupQuery = useQuery({
    queryKey: ["admin", "topups", id],
    queryFn: () => apiClient.adminGetTopup(id),
    enabled: Number.isFinite(id),
    refetchOnMount: "always",
  });

  const t = topupQuery.data;
  const accountName = t ? topupDisplayName(t) : "";
  const operator = t ? t.product_name || OPERATORS[t.product_id] : "";
  const providerJson = t ? formatProviderResponse(t.provider_response) : null;

  return (
    <AdminShell
      title={t ? `Top-up #${t.id}` : "Top-up"}
      description={
        t
          ? "Mobile top-up statement"
          : topupQuery.isLoading
            ? "Loading…"
            : "Not found"
      }
    >
      <div className="mb-5">
        <BackButton to="/admin/topups" label="Back to top-ups" />
      </div>

      {topupQuery.isError && (
        <p className="text-sm text-muted-foreground">
          {topupQuery.error instanceof ApiError
            ? topupQuery.error.message
            : "Top-up not found."}
        </p>
      )}

      {t && (
        <div className="space-y-6">
          <article className="min-w-0 overflow-x-clip rounded-2xl border border-border bg-surface shadow-card">
            <div className="border-b border-border bg-gradient-to-br from-muted/80 via-surface to-surface px-4 py-5 sm:px-6 sm:py-6 md:px-8">
              <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    MySewa Mobile Top-up
                  </p>
                  <h2 className="mt-1 break-words text-xl font-semibold tracking-tight sm:text-2xl">
                    Top-up statement
                  </h2>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    Reference #{t.id} · Issued {formatDateTime(t.created_at)}
                  </p>
                </div>
                <StatusChip status={t.status} />
              </div>

              <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="min-w-0 rounded-xl border border-brand/20 bg-gradient-to-br from-brand-soft/70 via-surface to-surface px-4 py-5 sm:px-5">
                  <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    Transaction amount
                  </p>
                  <p className="mt-2 break-all tabular-nums text-3xl font-black tracking-tight text-brand-dark sm:text-4xl md:text-5xl">
                    {formatNPR(t.amount)}
                  </p>
                  <p className="mt-1.5 break-words text-sm text-muted-foreground">
                    {operator} · {t.mobile_number}
                  </p>
                </div>
                <div className="min-w-0 rounded-xl border border-border/70 bg-surface/90 px-4 py-5 sm:px-5">
                  <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    Total debited
                  </p>
                  <p className="mt-2 break-all tabular-nums text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
                    {formatNPR(t.total_debited)}
                  </p>
                  <p className="mt-1.5 break-words text-sm text-muted-foreground">
                    Charge {formatNPR(t.charge)} · Cashback {formatNPR(t.cashback)}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
              <section className="border-b border-border px-4 py-5 sm:px-6 md:border-r md:px-8">
                <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Account holder
                </h3>
                <dl>
                  <StatementRow label="Name">{accountName}</StatementRow>
                  <StatementRow label="Phone">{t.phone}</StatementRow>
                  <StatementRow label="User ID">
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: String(t.user_id) }}
                      className="text-brand underline-offset-2 hover:underline"
                    >
                      #{t.user_id}
                    </Link>
                  </StatementRow>
                </dl>
              </section>

              <section className="border-b border-border px-4 py-5 sm:px-6 md:px-8">
                <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Beneficiary
                </h3>
                <dl>
                  <StatementRow label="Operator">{operator}</StatementRow>
                  <StatementRow label="Mobile">{t.mobile_number}</StatementRow>
                  <StatementRow label="Product ID">{t.product_id}</StatementRow>
                </dl>
              </section>
            </div>

            <section className="border-b border-border px-4 py-5 sm:px-6 md:px-8">
              <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Transaction
              </h3>
              <dl>
                <StatementRow label="Type">Mobile top-up · {operator}</StatementRow>
                <StatementRow label="Status">{t.status_display}</StatementRow>
                <StatementRow label="Merchant txn">
                  <span className="break-all font-mono text-xs sm:text-sm">{t.merchant_txn_id}</span>
                </StatementRow>
                <StatementRow label="Provider txn">
                  <span className="break-all font-mono text-xs sm:text-sm">
                    {t.service_hub_txn_id ?? "—"}
                  </span>
                </StatementRow>
                <StatementRow label="Reference">{t.reference_id ?? "—"}</StatementRow>
                <StatementRow label="Submitted">{formatDateTime(t.created_at)}</StatementRow>
                <StatementRow label="Updated">{formatDateTime(t.updated_at)}</StatementRow>
              </dl>
            </section>

            <section className="border-b border-border px-4 py-5 sm:px-6 md:px-8">
              <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Settlement breakdown
              </h3>
              <dl>
                <StatementRow label="Top-up">{formatNPR(t.amount)}</StatementRow>
                <StatementRow label="Service charge">{formatNPR(t.charge)}</StatementRow>
                <StatementRow label="Cashback">{formatNPR(t.cashback)}</StatementRow>
                <StatementRow label="Wallet debit">
                  <span className="break-all tabular-nums font-semibold">
                    {formatNPR(t.total_debited)}
                  </span>
                </StatementRow>
                <StatementRow label="Balance before">
                  {t.balance_before != null ? formatNPR(t.balance_before) : "—"}
                </StatementRow>
                <StatementRow label="Balance after">
                  {t.balance_after != null ? formatNPR(t.balance_after) : "—"}
                </StatementRow>
              </dl>
            </section>

            <section className="px-4 py-5 sm:px-6 md:px-8">
              <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Provider response
              </h3>
              {providerJson ? (
                <pre className="max-h-80 overflow-x-auto overflow-y-auto rounded-xl border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-foreground sm:p-4">
                  {providerJson}
                </pre>
              ) : (
                <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
                  No provider response recorded
                </div>
              )}
            </section>

            <footer className="border-t border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground sm:px-6 md:px-8">
              This statement summarizes the mobile top-up recorded in MySewa. Wallet debit equals
              top-up amount plus charge minus cashback.
            </footer>
          </article>
        </div>
      )}
    </AdminShell>
  );
}
