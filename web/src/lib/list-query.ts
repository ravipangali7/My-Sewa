import { api } from "@/lib/api";
import type { ListFilters } from "@/hooks/use-list-filters";

function buildQuery(filters: Partial<ListFilters>) {
  const params = new URLSearchParams();
  const q = filters.q?.trim();
  const status = filters.status;
  const startDate = filters.startDate?.trim();
  const endDate = filters.endDate?.trim();

  if (q) params.set("q", q);
  if (status && status !== "all") params.set("status", status);
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);

  const query = params.toString();
  return query ? `?${query}` : "";
}

function saveTextAsFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadCsvExport(
  path: string,
  filters: Partial<ListFilters>,
  filename: string,
) {
  const query = buildQuery(filters);
  const withExport = query ? `${query}&export=csv` : "?export=csv";
  const payload = await api<unknown>(`${path}${withExport}`);
  const csv = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  saveTextAsFile(csv, filename);
}
