import { api } from "@/lib/api";
import type { ListFilters } from "@/hooks/use-list-filters";

function buildQuery(filters: Partial<ListFilters>) {
  const params = new URLSearchParams();
  const q = filters.q?.trim();
  const status = filters.status;

  if (q) params.set("q", q);
  if (status && status !== "all") params.set("status", status);

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
  const payload = await api<unknown>(`${path}${buildQuery(filters)}`);
  const csv = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  saveTextAsFile(csv, filename);
}
