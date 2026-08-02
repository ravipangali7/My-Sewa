import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { Download, ExternalLink, ImageIcon, Send, Smartphone } from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { apiClient } from "@/lib/api";
import { buildActivityStatement } from "@/lib/activity";
import { formatDateTime } from "@/lib/format";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useSiteBranding } from "@/hooks/use-site-branding";

export const Route = createFileRoute("/app/history_/$activityId")({
  head: () => ({
    meta: [
      { title: "Transaction Statement — MySewa" },
      {
        name: "description",
        content: "Detailed banking-style statement for a MySewa wallet transaction.",
      },
    ],
  }),
  component: HistoryStatementPage,
});

function StatementRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-dashed border-border/80 py-2.5 last:border-0 sm:grid-cols-[150px_1fr] sm:gap-3">
      <dt className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-[14px] font-medium break-words text-foreground">{children}</dd>
    </div>
  );
}

function HistoryStatementPage() {
  const { activityId } = Route.useParams();
  const { t, locale } = useI18n();
  const { logoUrl } = useSiteBranding();
  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const statement = useMemo(
    () =>
      txQuery.data
        ? buildActivityStatement(txQuery.data, activityId, t)
        : undefined,
    [txQuery.data, activityId, t, locale],
  );

  return (
    <UserShell title={t("history.detailTitle")} back="/app/history">
      {txQuery.isLoading ? (
        <div className="inset-group px-4 py-10 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : !statement ? (
        <div className="inset-group px-4 py-10 text-center">
          <p className="text-[16px] font-medium">{t("history.notFound")}</p>
          <Link to="/app/history" className="mt-2 inline-block text-[14px] text-brand">
            {t("history.back")}
          </Link>
        </div>
      ) : (
        <article className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="border-b border-border bg-[linear-gradient(135deg,#F8FAFC_0%,#EEF4FF_45%,#F0FDFA_100%)] px-5 py-6 sm:px-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <img
                  src={logoUrl}
                  alt="MySewa"
                  className="mt-0.5 size-10 rounded-full object-cover ring-2 ring-white shadow-sm"
                />
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {t("history.statementBrand")}
                  </p>
                  <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">
                    {t("history.statementTitle")}
                  </h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {t("history.referenceIssued", {
                      ref: statement.reference,
                      date: formatDateTime(statement.item.created_at),
                    })}
                  </p>
                </div>
              </div>
              <StatusChip status={statement.item.status} />
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-border/70 bg-white/90 px-4 py-4 shadow-sm">
              <span
                className={cn(
                  "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full",
                  statement.item.credit
                    ? "bg-success/12 text-success"
                    : "bg-ocean/10 text-ocean",
                )}
              >
                {statement.item.kind === "deposit" ? (
                  <Download className="size-[18px]" />
                ) : statement.item.kind === "topup" ? (
                  <Smartphone className="size-[18px]" />
                ) : (
                  <Send className="size-[18px]" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {statement.item.credit
                    ? t("history.creditAmount")
                    : t("history.debitAmount")}
                </p>
                <p
                  className={cn(
                    "mt-1 tabular text-[30px] font-bold tracking-tight",
                    statement.item.credit ? "text-success" : "text-foreground",
                  )}
                >
                  {statement.item.credit ? "+" : "−"} {statement.headlineAmount}
                </p>
                <p className="mt-1 truncate text-[14px] font-medium text-foreground">
                  {statement.item.title}
                </p>
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {statement.amountCaption}
                  {statement.item.subtitle ? ` · ${statement.item.subtitle}` : ""}
                </p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-border">
            {statement.sections.map((section) => (
              <section key={section.title} className="px-5 py-5 sm:px-7">
                <h3 className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {section.title}
                </h3>
                <dl>
                  {section.rows.map((row) => (
                    <StatementRow key={`${section.title}-${row.label}`} label={row.label}>
                      <span
                        className={cn(
                          row.mono && "font-mono text-[13px]",
                          row.danger && "text-destructive",
                        )}
                      >
                        {row.value}
                      </span>
                    </StatementRow>
                  ))}
                </dl>
              </section>
            ))}

            {statement.item.kind === "deposit" && (
              <section className="px-5 py-5 sm:px-7">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    {t("history.sectionProof")}
                  </h3>
                  {statement.proofUrl ? (
                    <a
                      href={statement.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brand hover:underline"
                    >
                      {t("history.openFullSize")}
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </div>
                {statement.proofUrl ? (
                  <a
                    href={statement.proofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-xl border border-border bg-muted/40"
                  >
                    <img
                      src={statement.proofUrl}
                      alt=""
                      className="mx-auto max-h-[360px] w-full object-contain"
                    />
                  </a>
                ) : (
                  <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 text-muted-foreground">
                    <ImageIcon className="size-7 opacity-50" />
                    <p className="text-sm">{t("history.noProof")}</p>
                  </div>
                )}
              </section>
            )}
          </div>

          <footer className="border-t border-border bg-muted/40 px-5 py-3 text-[12px] leading-relaxed text-muted-foreground sm:px-7">
            {statement.footer}
          </footer>
        </article>
      )}
    </UserShell>
  );
}
