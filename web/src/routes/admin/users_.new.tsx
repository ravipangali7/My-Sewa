import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { UserForm } from "@/components/admin/UserForm";
import { apiClient, ApiError } from "@/lib/api";
import type { AdminUserWritePayload } from "@/lib/types";

export const Route = createFileRoute("/admin/users_/new")({
  head: () => ({
    meta: [
      { title: "Add User — MySewa Admin" },
      {
        name: "description",
        content: "Create a new MySewa user account with phone, profile details, and password.",
      },
      { property: "og:title", content: "Add User — MySewa Admin" },
    ],
  }),
  component: NewUserPage,
});

function NewUserPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload: AdminUserWritePayload) => apiClient.adminCreateUser(payload),
    onSuccess: (res) => {
      toast.success("User created");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      navigate({ to: "/admin/users/$userId", params: { userId: String(res.data.id) } });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not create user");
    },
  });

  return (
    <AdminShell title="Add user" description="Create a new account">
      <div className="mb-5">
        <BackButton to="/admin/users" label="Back to users" />
      </div>
      <UserForm
        mode="create"
        submitting={createMutation.isPending}
        onSubmit={(payload) => createMutation.mutate(payload)}
        onCancel={() => navigate({ to: "/admin/users" })}
      />
    </AdminShell>
  );
}
