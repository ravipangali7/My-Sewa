import type { ListQueryParams } from "./types";
import { getToken } from "./api";

function apiBase(): string {
  const configured = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.trim();
  if (configured !== undefined && configured !== "") {
    return configured.replace(/\/$/, "");
  }
  return import.meta.env.DEV ? "http://127.0.0.1:8000" : "";
}

export function buildListQuery(params: ListQueryParams & { format?: string }): string {
  const q = new URLSearchParams();
  if (params.date_from) q.set("date_from", params.date_from);
  if (params.date_to) q.set("date_to", params.date_to);
  if (params.search?.trim()) q.set("search", params.search.trim());
  if (params.status) q.set("status", params.status);
  if (params.kind) q.set("kind", params.kind);
  if (params.product_id) q.set("product_id", params.product_id);
  if (params.format) q.set("format", params.format);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function downloadCsvExport(
  path: string,
  params: ListQueryParams,
  filename: string,
): Promise<void> {
  const token = getToken();
  const query = buildListQuery({ ...params, format: "csv" });
  const base = apiBase();
  const res = await fetch(`${base}${path}${query}`, {
    headers: token ? { Authorization: `Token ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error("Export failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function withListQuery(path: string, params?: ListQueryParams): string {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const q = buildListQuery(params ?? {});
  return q ? `${normalized}${q}` : `${normalized}/`;
}

export const EMPTY_LIST_STATS = {
  total_count: 0,
  pending_count: 0,
  success_count: 0,
  failed_count: 0,
  total_amount: "0.00",
  success_amount: "0.00",
  pending_amount: "0.00",
  failed_amount: "0.00",
};
