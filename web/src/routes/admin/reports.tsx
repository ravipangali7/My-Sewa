import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, Loader2 } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { ListPageToolbar, ListStatsCards } from "@/components/list/ListPageToolbar";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { useListFilters } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { downloadReportPdf } from "@/lib/report-pdf";
import { formatNPR } from "@/lib/format";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({
    meta: [
      { title: "Reports — MySewa Admin" },
      {
        name: "description",
        content: "Transaction reports with date filters, service breakdown, and PDF export.",
      },
    ],
  }),
  component: ReportsPage,
});

const SERVICE_LABELS: Record<string, string> = {
  deposits: "Deposits",
  topups: "Top-ups",
  transfers: "Bank transfers",
  remittances: "Remittances",
  internet: "Internet bills",
  data_packs: "Data packs",
};

function ReportsPage() {
  const { logoUrl } = useSiteBranding();
  const { filters, setFilters, debounced } = useListFilters();
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const reportQuery = useQuery({
    queryKey: ["admin", "reports", debounced],
    queryFn: () => apiClient.adminReports(debounced),
    refetchOnMount: "always",
  });

  const report = reportQuery.data;
  const periodLabel = useMemo(() => {
    if (debounced.date_from && debounced.date_to) {
      return `${debounced.date_from} — ${debounced.date_to}`;
    }
    if (debounced.date_from) return `From ${debounced.date_from}`;
    if (debounced.date_to) return `Until ${debounced.date_to}`;
    return "Last 30 days";
  }, [debounced.date_from, debounced.date_to]);

  const maxDaily = useMemo(
    () => Math.max(...(report?.daily.map((d) => d.total) ?? [1]), 1),
    [report?.daily],
  );

  async function exportCsv() {
    setExportingCsv(true);
    try {
      await downloadCsvExport("/api/admin/deposits/", debounced, "report-deposits.csv");
      toast.success("Deposits CSV downloaded");
    } catch {
      toast.error("CSV export failed");
    } finally {
      setExportingCsv(false);
    }
  }

  async function exportPdf() {
    if (!report) return;
    setExportingPdf(true);
    try {
      await downloadReportPdf({
        report,
        title: "Transaction Report",
        periodLabel,
        logoUrl,
        brandName: "MySewa",
        serviceLabels: SERVICE_LABELS,
      });
      toast.success("PDF report downloaded");
    } catch {
      toast.error("PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <AdminShell
      title="Reports"
      description="Aggregated transaction analytics with export"
      actions={
        <Button
          type="button"
          className="rounded-xl"
          disabled={!report || exportingPdf}
          onClick={() => void exportPdf()}
        >
          {exportingPdf ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileDown className="size-4" />
          )}
          Download PDF
        </Button>
      }
    >
      <div className="space-y-6">
        <ListPageToolbar
          stats={report?.summary}
          filters={filters}
          onFiltersChange={setFilters}
          onExport={() => void exportCsv()}
          exporting={exportingCsv}
          searchPlaceholder="Search (applies to ledger exports)"
          exportLabel="Export CSV"
          statsLabels={{
            total: "Total",
            success: "Success",
            pending: "Pending",
            failed: "Failed",
          }}
        />

        {reportQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading report…</p>
        ) : report ? (
          <>
            <section className="inset-group p-4">
              <h2 className="mb-3 text-[15px] font-semibold">By service</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(report.by_service).map(([key, stats]) => (
                  <div key={key} className="rounded-xl border border-border bg-background p-3">
                    <p className="text-[13px] font-medium">{SERVICE_LABELS[key] ?? key}</p>
                    <p className="tabular mt-1 text-[20px] font-semibold">{stats.total_count}</p>
                    <p className="tabular text-[12px] text-muted-foreground">
                      {formatNPR(stats.success_amount)} success
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="inset-group p-4">
              <h2 className="mb-4 text-[15px] font-semibold">Daily volume</h2>
              <div className="space-y-2">
                {report.daily.map((day) => (
                  <div key={day.date} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-[12px] text-muted-foreground">{day.date}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full bg-brand")}
                        style={{ width: `${Math.max(4, (day.total / maxDaily) * 100)}%` }}
                      />
                    </div>
                    <span className="tabular w-24 shrink-0 text-right text-[12px] font-medium">
                      {formatNPR(String(day.total))}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <ListStatsCards
              stats={report.summary}
              labels={{
                total: "Combined total",
                success: "Combined success",
                pending: "Combined pending",
                failed: "Combined failed",
              }}
            />
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
