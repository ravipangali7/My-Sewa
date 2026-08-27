import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient, ApiError } from "@/lib/api";

const SERVICES = [
  { id: "topup", label: "Top-up" },
  { id: "data_pack", label: "Data pack" },
  { id: "internet", label: "Internet" },
  { id: "water", label: "Water" },
  { id: "electricity", label: "Electricity" },
  { id: "community_electricity", label: "Community electricity" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "remittance", label: "Remittance" },
] as const;

type RateRow = {
  txn_type: string;
  dealer_rate: string;
  sub_agent_rate: string;
  super_admin_rate: string;
};

function emptyRows(): RateRow[] {
  return SERVICES.map((s) => ({
    txn_type: s.id,
    dealer_rate: "",
    sub_agent_rate: "",
    super_admin_rate: "",
  }));
}

export function ServiceCommissionRulesForm({
  userId,
  enabled,
}: {
  userId: number;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<RateRow[]>(emptyRows);

  const query = useQuery({
    queryKey: ["admin", "users", userId, "commission-rules"],
    queryFn: () => apiClient.adminServiceCommissionRules(userId),
    enabled: enabled && Number.isFinite(userId),
  });

  useEffect(() => {
    if (!query.data) return;
    const byType = new Map(query.data.items.map((item) => [item.txn_type, item]));
    setRows(
      SERVICES.map((s) => {
        const existing = byType.get(s.id);
        return {
          txn_type: s.id,
          dealer_rate: existing?.dealer_rate ?? "",
          sub_agent_rate: existing?.sub_agent_rate ?? "",
          super_admin_rate: existing?.super_admin_rate ?? "",
        };
      }),
    );
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.adminSaveServiceCommissionRules(
        userId,
        rows
          .filter((row) => row.dealer_rate || row.sub_agent_rate || row.super_admin_rate)
          .map((row) => ({
            txn_type: row.txn_type,
            dealer_rate: row.dealer_rate || "0",
            sub_agent_rate: row.sub_agent_rate || "0",
            super_admin_rate: row.super_admin_rate || "0",
          })),
      ),
    onSuccess: () => {
      toast.success("Service commission rules saved");
      queryClient.invalidateQueries({ queryKey: ["admin", "users", userId, "commission-rules"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not save commission rules"),
  });

  const setRow = (txnType: string, key: keyof Omit<RateRow, "txn_type">, value: string) => {
    setRows((prev) =>
      prev.map((row) => (row.txn_type === txnType ? { ...row, [key]: value } : row)),
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  if (!enabled) return null;

  return (
    <form
      className="min-w-0 space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-sm font-semibold">Service-wise commission</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Percent of transaction amount. Blank uses this Dealer&apos;s default rates. Saved rates
          are snapshotted onto future transactions and do not change historical ledger rows.
        </p>
      </div>
      {query.isError ? <p className="text-sm text-danger">Could not load service rules.</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Service</th>
              <th className="py-2 pr-3 font-medium">Dealer %</th>
              <th className="py-2 pr-3 font-medium">Sub-Agent %</th>
              <th className="py-2 font-medium">Super Admin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const label = SERVICES.find((s) => s.id === row.txn_type)?.label ?? row.txn_type;
              return (
                <tr key={row.txn_type} className="border-b border-border/70 last:border-0">
                  <td className="py-2 pr-3">{label}</td>
                  <td className="py-2 pr-3">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8"
                      value={row.dealer_rate}
                      onChange={(e) => setRow(row.txn_type, "dealer_rate", e.target.value)}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8"
                      value={row.sub_agent_rate}
                      onChange={(e) => setRow(row.txn_type, "sub_agent_rate", e.target.value)}
                    />
                  </td>
                  <td className="py-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8"
                      value={row.super_admin_rate}
                      onChange={(e) => setRow(row.txn_type, "super_admin_rate", e.target.value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button type="submit" size="sm" disabled={saveMutation.isPending || query.isLoading}>
        {saveMutation.isPending ? "Saving…" : "Save service rates"}
      </Button>
    </form>
  );
}
