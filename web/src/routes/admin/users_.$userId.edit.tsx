import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminShell } from "@/components/layout/AdminShell";
import { UserForm } from "@/components/admin/UserForm";
import { apiClient, ApiError } from "@/lib/api";
import type { AdminUserWritePayload } from "@/lib/types";

export const Route = createFileRoute("/admin/users_/$userId/edit")({
  head: () => ({
    meta: [
      { title: "Edit User — MySewa Admin" },
      {
        name: "description",
        content: "Update MySewa user profile, permissions, or reset their password.",
      },
      { property: "og:title", content: "Edit User — MySewa Admin" },
    ],
  }),
  component: EditUserPage,
});

function EditUserPage() {
  const { userId } = Route.useParams();
  const id = Number(userId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const userQuery = useQuery({
    queryKey: ["admin", "users", id],
    queryFn: () => apiClient.adminGetUser(id),
    enabled: Number.isFinite(id),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: AdminUserWritePayload) => apiClient.adminUpdateUser(id, payload),
    onSuccess: () => {
      toast.success("User updated");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      navigate({ to: "/admin/users/$userId", params: { userId } });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not update user");
    },
  });

  const u = userQuery.data;

  return (
    <AdminShell
      title="Edit user"
      description={u ? `${u.phone} · #${u.id}` : userQuery.isLoading ? "Loading…" : "Not found"}
    >
      {userQuery.isError && (
        <p className="text-sm text-muted-foreground">
          {userQuery.error instanceof ApiError ? userQuery.error.message : "User not found."}
        </p>
      )}

      {u && (
        <UserForm
          key={u.id}
          mode="edit"
          initialUser={u}
          submitting={updateMutation.isPending}
          onSubmit={(payload) => updateMutation.mutate(payload)}
          onCancel={() => navigate({ to: "/admin/users/$userId", params: { userId } })}
        />
      )}
    </AdminShell>
  );
}
