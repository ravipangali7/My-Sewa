import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, MoreHorizontal, Pencil, Search, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { WalletCard, walletDisplayName } from "@/components/admin/WalletCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime, formatNPR } from "@/lib/format";
import type { AdminWallet } from "@/lib/types";

export const Route = createFileRoute("/admin/wallets")({
  head: () => ({
    meta: [
      { title: "Wallets — MySewa Admin" },
      {
        name: "description",
        content:
          "Search MySewa wallets by phone or name and review balances, creation dates and last update time.",
      },
      { property: "og:title", content: "Wallets — MySewa Admin" },
      { property: "og:description", content: "Wallet balances and total float across all users." },
    ],
  }),
  component: WalletsPage,
});

function WalletsPage() {
  const [q, setQ] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AdminWallet | null>(null);
  const queryClient = useQueryClient();

  const walletsQuery = useQuery({
    queryKey: ["admin", "wallets"],
    queryFn: () => apiClient.adminWallets(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.adminDeleteWallet(id),
    onSuccess: () => {
      toast.success("Wallet deleted");
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not delete wallet");
    },
  });

  const wallets = useMemo(() => {
    const all = walletsQuery.data?.wallets ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return all;
    return all.filter((w) => {
      const name = [w.first_name, w.last_name].filter(Boolean).join(" ").toLowerCase();
      return (
        w.phone.toLowerCase().includes(term) ||
        name.includes(term) ||
        String(w.id).includes(term) ||
        String(w.user_id).includes(term)
      );
    });
  }, [walletsQuery.data?.wallets, q]);

  const float = walletsQuery.data?.wallet_float ?? "0.00";
  const totalCount = walletsQuery.data?.wallets?.length ?? 0;

  const walletActions = (w: AdminWallet) => {
    const walletId = String(w.id);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2">
            <MoreHorizontal className="size-3.5" />
            <span className="sr-only sm:not-sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem asChild>
            <Link to="/admin/wallets/$walletId" params={{ walletId }}>
              <Eye className="size-3.5" />
              View
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/admin/wallets/$walletId/edit" params={{ walletId }}>
              <Pencil className="size-3.5" />
              Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-danger focus:text-danger"
            onSelect={() => setPendingDelete(w)}
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <AdminShell
      title="Wallets"
      description={
        walletsQuery.isLoading
          ? "Loading…"
          : `${totalCount} wallet${totalCount === 1 ? "" : "s"} across the platform`
      }
      actions={
        <div className="relative w-full min-w-[12rem] sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search phone, name, ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 pl-8"
          />
        </div>
      }
    >
      <div className="space-y-5">
        <WalletCard
          size="lg"
          balance={float}
          title="Total wallet float"
          subtitle={`${totalCount} active wallet${totalCount === 1 ? "" : "s"}`}
          className="w-full max-w-xl"
          footer={
            <div className="flex items-center gap-2 text-[13px] text-primary-foreground/75">
              <Users className="size-3.5" />
              Sum of all user balances
            </div>
          }
        />

        <AdminDataList
          isEmpty={!walletsQuery.isLoading && wallets.length === 0}
          empty={
            <AdminEmptyState>
              {q.trim() ? "No wallets match your search." : "No wallets found."}
            </AdminEmptyState>
          }
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Created at</TableHead>
                  <TableHead>Updated at</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallets.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="text-sm">{w.id}</TableCell>
                    <TableCell className="text-sm">{walletDisplayName(w)}</TableCell>
                    <TableCell className="text-sm font-medium">{w.phone}</TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {formatNPR(w.balance)}
                    </TableCell>
                    <TableCell className="text-sm">{formatDateTime(w.created_at)}</TableCell>
                    <TableCell className="text-sm">{formatDateTime(w.updated_at)}</TableCell>
                    <TableCell className="text-right">{walletActions(w)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
          mobile={
            <AdminMobileCardGrid className="sm:grid-cols-2">
              {wallets.map((w) => {
                const walletId = String(w.id);
                return (
                  <AdminMobileCard key={w.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{walletDisplayName(w)}</p>
                        <p className="truncate text-xs text-muted-foreground">{w.phone}</p>
                      </div>
                      {walletActions(w)}
                    </div>
                    <p className="tabular mt-3 text-xl font-semibold">{formatNPR(w.balance)}</p>
                    <AdminMobileMeta
                      items={[
                        { label: "Wallet ID", value: `#${w.id}` },
                        { label: "Updated", value: formatDateTime(w.updated_at) },
                      ]}
                    />
                    <div className="mt-3 flex gap-2 border-t border-border pt-3">
                      <Button asChild size="sm" variant="outline" className="flex-1">
                        <Link to="/admin/wallets/$walletId" params={{ walletId }}>
                          View
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="secondary" className="flex-1">
                        <Link to="/admin/wallets/$walletId/edit" params={{ walletId }}>
                          Edit
                        </Link>
                      </Button>
                    </div>
                  </AdminMobileCard>
                );
              })}
            </AdminMobileCardGrid>
          }
        />
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the wallet for{" "}
              {pendingDelete
                ? `${walletDisplayName(pendingDelete)} (${pendingDelete.phone})`
                : "this user"}
              . The balance will be lost. A new empty wallet may be recreated when the user next
              accesses their account. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}
