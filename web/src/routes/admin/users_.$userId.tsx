import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
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
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin/users_/$userId")({
  head: () => ({
    meta: [
      { title: "User Details — MySewa Admin" },
      {
        name: "description",
        content: "View complete MySewa user account details including wallet and permissions.",
      },
      { property: "og:title", content: "User Details — MySewa Admin" },
    ],
  }),
  component: UserDetailPage,
});

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-0 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium wrap-break-word">{children}</dd>
    </div>
  );
}

function UserDetailPage() {
  const { userId } = Route.useParams();
  const id = Number(userId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const userQuery = useQuery({
    queryKey: ["admin", "users", id],
    queryFn: () => apiClient.adminGetUser(id),
    enabled: Number.isFinite(id),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.adminDeleteUser(id),
    onSuccess: () => {
      toast.success("User deleted");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      navigate({ to: "/admin/users" });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not delete user");
    },
  });

  const u = userQuery.data;
  const isSelf = currentUser?.id === id;

  return (
    <AdminShell
      title={u ? ([u.first_name, u.last_name].filter(Boolean).join(" ") || u.phone) : "User"}
      description={u ? `User #${u.id}` : userQuery.isLoading ? "Loading…" : "Not found"}
      actions={
        u ? (
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/users/$userId/edit" params={{ userId }}>
                <Pencil className="size-3.5" />
                Edit
              </Link>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={isSelf || deleteMutation.isPending}>
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this user?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes {u.phone} and related wallet data. This cannot be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteMutation.mutate()}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : undefined
      }
    >
      <div className="mb-5">
        <BackButton to="/admin/users" label="Back to users" />
      </div>

      {userQuery.isError && (
        <p className="text-sm text-muted-foreground">
          {userQuery.error instanceof ApiError ? userQuery.error.message : "User not found."}
        </p>
      )}

      {u && (
        <div className="max-w-2xl rounded-xl border border-border bg-surface p-5">
          <dl>
            <DetailRow label="ID">{u.id}</DetailRow>
            <DetailRow label="Phone">{u.phone}</DetailRow>
            <DetailRow label="First name">{u.first_name || "—"}</DetailRow>
            <DetailRow label="Last name">{u.last_name || "—"}</DetailRow>
            <DetailRow label="Email">{u.email || "—"}</DetailRow>
            <DetailRow label="Status">
              <Badge variant={u.is_active ? "default" : "secondary"}>
                {u.is_active ? "Active" : "Inactive"}
              </Badge>
            </DetailRow>
            <DetailRow label="Role">
              {u.is_superuser ? "Superuser" : u.is_staff ? "Staff" : "Customer"}
            </DetailRow>
            <DetailRow label="Staff">{u.is_staff ? "Yes" : "No"}</DetailRow>
            <DetailRow label="Superuser">{u.is_superuser ? "Yes" : "No"}</DetailRow>
            <DetailRow label="Wallet ID">{u.wallet_id ?? "—"}</DetailRow>
            <DetailRow label="Wallet balance">
              <span className="tabular">{formatNPR(u.wallet_balance ?? "0.00")}</span>
            </DetailRow>
            <DetailRow label="Date joined">{formatDateTime(u.date_joined)}</DetailRow>
            <DetailRow label="Last login">
              {u.last_login ? formatDateTime(u.last_login) : "Never"}
            </DetailRow>
            {u.avatar_url && (
              <DetailRow label="Avatar">
                <img
                  src={u.avatar_url}
                  alt=""
                  className="size-16 rounded-full object-cover"
                />
              </DetailRow>
            )}
          </dl>
        </div>
      )}
    </AdminShell>
  );
}
