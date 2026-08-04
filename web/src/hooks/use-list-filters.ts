import { useEffect, useState } from "react";
import type { ListQueryParams } from "@/lib/types";

export function useListFilters(initial: ListQueryParams = {}) {
  const [filters, setFilters] = useState<ListQueryParams>(initial);
  const [debounced, setDebounced] = useState(filters);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(filters), 350);
    return () => clearTimeout(timer);
  }, [filters]);

  return { filters, setFilters, debounced };
}

export const TXN_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
] as const;

export const DEPOSIT_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
] as const;
