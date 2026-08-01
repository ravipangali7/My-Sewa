import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { AdminUser } from "@/lib/types";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Users — MySewa Admin" },
      {
        name: "description",
        content:
          "Browse every MySewa account: phone, name, email, account status, join date and wallet balance.",
      },
      { property: "og:title", content: "Users — MySewa Admin" },
      { property: "og:description", content: "User directory with wallet balances and status." },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiClient.adminUsers(),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, account_status }: { id: number; account_status: "pending" | "approved" }) => {
      const existing = usersQuery.data?.find((u) => u.id === id);
      if (!existing) throw new Error("User not found");
      return apiClient.adminUpdateUser(id, {
        phone: existing.phone,
        account_status,
      });
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.account_status === "approved" ? "User set to Active" : "User set to Pending");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not update status");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.adminDeleteUser(id),
    onSuccess: () => {
      toast.success("User deleted");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not delete user");
    },
  });

  const users = usersQuery.data ?? [];

  const deleteDialog = (u: AdminUser) => {
    const isSelf = currentUser?.id === u.id;
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-danger hover:text-danger"
            disabled={isSelf || deleteMutation.isPending}
            title={isSelf ? "You cannot delete your own account" : "Delete"}
          >
            <Trash2 className="size-3.5" />
            <span className="sr-only sm:not-sr-only sm:ml-1">Delete</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {u.phone}
              {u.first_name || u.last_name
                ? ` (${[u.first_name, u.last_name].filter(Boolean).join(" ")})`
                : ""}{" "}
              and related wallet data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate(u.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  const actionsFor = (u: AdminUser, compact = false) => {
    const userId = String(u.id);
    const isPending = u.account_status === "pending";
    return (
      <div className={compact ? "flex flex-wrap gap-1.5" : "flex justify-end gap-1"}>
        {isPending ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2"
            disabled={statusMutation.isPending}
            title="Set Active"
            onClick={() => statusMutation.mutate({ id: u.id, account_status: "approved" })}
          >
            Activate
          </Button>
        ) : null}
        <Button asChild size="sm" variant="ghost" className="h-8 px-2">
          <Link to="/admin/users/$userId" params={{ userId }} title="View">
            <Eye className="size-3.5" />
            <span className="sr-only sm:not-sr-only sm:ml-1">View</span>
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="h-8 px-2">
          <Link to="/admin/users/$userId/edit" params={{ userId }} title="Edit">
            <Pencil className="size-3.5" />
            <span className="sr-only sm:not-sr-only sm:ml-1">Edit</span>
          </Link>
        </Button>
        {deleteDialog(u)}
      </div>
    );
  };

  return (
    <AdminShell
      title="Users"
      description={usersQuery.isLoading ? "Loading…" : `${users.length} registered accounts`}
      actions={
        <Button asChild size="sm" className="shrink-0">
          <Link to="/admin/users/new">
            <Plus className="size-4" />
            Add user
          </Link>
        </Button>
      }
    >
      <AdminDataList
        isEmpty={!usersQuery.isLoading && users.length === 0}
        empty={<AdminEmptyState>No users found.</AdminEmptyState>}
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Date joined</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Wallet balance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="text-sm">{u.id}</TableCell>
                  <TableCell className="text-sm font-medium">{u.phone}</TableCell>
                  <TableCell className="text-sm">
                    {u.first_name} {u.last_name}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.email || "—"}</TableCell>
                  <TableCell className="text-sm">
                    {u.is_superuser ? "Superuser" : u.is_staff ? "Staff" : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.account_status === "approved" ? "default" : "secondary"}>
                      {u.account_status === "approved" ? "Active" : "Pending"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? "default" : "secondary"}>
                      {u.is_active ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{formatDate(u.date_joined)}</TableCell>
                  <TableCell className="text-sm">
                    {u.last_login ? formatDate(u.last_login) : "—"}
                  </TableCell>
                  <TableCell className="tabular text-right text-sm">
                    {formatNPR(u.wallet_balance ?? "0.00")}
                  </TableCell>
                  <TableCell className="text-right">{actionsFor(u)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {users.map((u) => {
              const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";
              return (
                <AdminMobileCard key={u.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{u.phone}</p>
                      <p className="truncate text-xs text-muted-foreground">{name}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant={u.account_status === "approved" ? "default" : "secondary"}>
                        {u.account_status === "approved" ? "Active" : "Pending"}
                      </Badge>
                      <span className="tabular text-sm font-semibold">
                        {formatNPR(u.wallet_balance ?? "0.00")}
                      </span>
                    </div>
                  </div>
                  <AdminMobileMeta
                    items={[
                      { label: "Email", value: u.email || "—" },
                      {
                        label: "Role",
                        value: u.is_superuser ? "Superuser" : u.is_staff ? "Staff" : "User",
                      },
                      { label: "Joined", value: formatDate(u.date_joined) },
                      {
                        label: "Login",
                        value: (
                          <Badge variant={u.is_active ? "default" : "secondary"} className="mt-0.5">
                            {u.is_active ? "Enabled" : "Disabled"}
                          </Badge>
                        ),
                      },
                    ]}
                  />
                  <div className="mt-3 border-t border-border pt-3">{actionsFor(u, true)}</div>
                </AdminMobileCard>
              );
            })}
          </AdminMobileCardGrid>
        }
      />
    </AdminShell>
  );
}
