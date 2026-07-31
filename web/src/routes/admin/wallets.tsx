import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/layout/AdminShell";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { apiClient } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/admin/wallets")({
  head: () => ({
    meta: [
      { title: "Wallets — MySewa Admin" },
      {
        name: "description",
        content:
          "Search MySewa wallets by phone and review balances, creation dates and last update time.",
      },
      { property: "og:title", content: "Wallets — MySewa Admin" },
      { property: "og:description", content: "Wallet balances and total float across all users." },
    ],
  }),
  component: WalletsPage,
});

function WalletsPage() {
  const [q, setQ] = useState("");
  const walletsQuery = useQuery({
    queryKey: ["admin", "wallets"],
    queryFn: () => apiClient.adminWallets(),
  });

  const wallets = (walletsQuery.data?.wallets ?? []).filter((w) =>
    w.phone.toLowerCase().includes(q.toLowerCase()),
  );
  const float = walletsQuery.data?.wallet_float ?? "0.00";

  return (
    <AdminShell
      title="Wallets"
      description={`Total float ${formatNPR(float)}`}
      actions={
        <Input
          placeholder="Search by phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9 w-48"
        />
      }
    >
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Created at</TableHead>
              <TableHead>Updated at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {wallets.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="text-sm">{w.id}</TableCell>
                <TableCell className="text-sm">
                  {[w.first_name, w.last_name].filter(Boolean).join(" ") || "—"}
                </TableCell>
                <TableCell className="text-sm font-medium">{w.phone}</TableCell>
                <TableCell className="tabular text-right text-sm">{formatNPR(w.balance)}</TableCell>
                <TableCell className="text-sm">{formatDateTime(w.created_at)}</TableCell>
                <TableCell className="text-sm">{formatDateTime(w.updated_at)}</TableCell>
              </TableRow>
            ))}
            {!walletsQuery.isLoading && wallets.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No wallets found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </AdminShell>
  );
}
