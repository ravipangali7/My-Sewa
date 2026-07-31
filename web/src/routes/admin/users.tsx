import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/layout/AdminShell";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api";
import { formatNPR, formatDate } from "@/lib/format";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Users — MySewa Admin" },
      {
        name: "description",
        content:
          "Browse every MySewa account: phone, name, email, active state, join date and wallet balance.",
      },
      { property: "og:title", content: "Users — MySewa Admin" },
      { property: "og:description", content: "User directory with wallet balances and status." },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiClient.adminUsers(),
  });

  const users = usersQuery.data ?? [];

  return (
    <AdminShell
      title="Users"
      description={usersQuery.isLoading ? "Loading…" : `${users.length} registered accounts`}
    >
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Date joined</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead className="text-right">Wallet balance</TableHead>
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
                  <Badge variant={u.is_active ? "default" : "secondary"}>
                    {u.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{formatDate(u.date_joined)}</TableCell>
                <TableCell className="text-sm">
                  {u.last_login ? formatDate(u.last_login) : "—"}
                </TableCell>
                <TableCell className="tabular text-right text-sm">
                  {formatNPR(u.wallet_balance ?? "0.00")}
                </TableCell>
              </TableRow>
            ))}
            {!usersQuery.isLoading && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </AdminShell>
  );
}
