export function formatNPR(value: string | number, withSymbol = true) {
  const n = typeof value === "string" ? Number(value) : value;
  const formatted = n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `Rs. ${formatted}` : formatted;
}

export function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

/** Epoch ms for sorting; invalid/missing timestamps sort as oldest. */
export function createdAtMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/** Newest date/time first. Stable for equal timestamps via original index. */
export function sortByLatestFirst<T extends { created_at?: string | null }>(
  items: readonly T[],
): T[] {
  return items
    .map((item, index) => ({ item, index, ms: createdAtMs(item.created_at) }))
    .sort((a, b) => b.ms - a.ms || a.index - b.index)
    .map(({ item }) => item);
}

export function formatBytes(bytes: number | null | undefined) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
