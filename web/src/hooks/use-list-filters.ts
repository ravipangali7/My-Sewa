import { useEffect, useMemo, useState } from "react";

export type ListStatus = "all" | "pending" | "success" | "failed" | "approved" | "rejected";

export type ListFilters = {
  q: string;
  status: ListStatus;
};

export type StatusOption = {
  value: ListStatus;
  label: string;
};

export const TXN_STATUS_OPTIONS: StatusOption[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
];

export const DEPOSIT_STATUS_OPTIONS: StatusOption[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function normalizeFilters(next: Partial<ListFilters>): ListFilters {
  return {
    q: typeof next.q === "string" ? next.q : "",
    status: (next.status as ListStatus) || "all",
  };
}

export function useListFilters() {
  const [filters, setFiltersState] = useState<ListFilters>({ q: "", status: "all" });
  const [debounced, setDebounced] = useState<ListFilters>(filters);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(filters);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [filters]);

  const setFilters = (next: Partial<ListFilters>) => {
    setFiltersState((prev) => normalizeFilters({ ...prev, ...next }));
  };

  return useMemo(
    () => ({
      filters,
      setFilters,
      debounced,
    }),
    [filters, debounced],
  );
}
