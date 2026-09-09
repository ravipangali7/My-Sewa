import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, KeyRound } from "lucide-react";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { adminLiveQueryOptions } from "@/lib/refresh";
import type { AdminApiUser } from "@/lib/types";

export const Route = createFileRoute("/admin/api-users")({
  head: () => ({
    meta: [
      { title: "API Users — MySewa Admin" },
      {
        name: "description",
        content: "Enable Fund Transfer API access, manage API keys, and review API transaction logs.",
      },
    ],
  }),
  component: AdminApiUsersPage,
});

function AdminApiUsersPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const query = useQuery({
    queryKey: ["admin", "api-users", q, showAll],
    queryFn: () => apiClient.adminApiUsers({ q, api_only: !showAll }),
    ...adminLiveQueryOptions(),
  });
  const items = query.data?.items ?? [];

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiClient.adminSetApiUserAccess(id, enabled),
    onSuccess: (_, vars) => {
      toast.success(vars.enabled ? "API access enabled. A key is generated if needed." : "API access disabled");
      queryClient.invalidateQueries({ queryKey: ["admin", "api-users"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not update API access"),
  });

  return (
    <AdminShell
      title="API Users"
      description="Manage Fund Transfer API access. Keys are hidden in this list."
      dense
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search phone, name, email" />
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          <Switch checked={showAll} onCheckedChange={setShowAll} />
          Show all users
        </label>
      </div>
      <AdminDataList
        isEmpty={!query.isLoading && items.length === 0}
        empty={
          <AdminEmptyState>
            No API users yet. Enable Fund Transfer API on a user to generate a key.
          </AdminEmptyState>
        }
        mobile={
          <AdminMobileCardGrid>
            {items.map((u) => (
              <ApiUserCard
                key={u.id}
                user={u}
                toggling={toggleMutation.isPending}
                onToggle={(enabled) => toggleMutation.mutate({ id: u.id, enabled })}
              />
            ))}
          </AdminMobileCardGrid>
        }
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>API</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.phone}</div>
                    <div className="text-xs text-muted-foreground">
                      {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || "—"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={Boolean(u.is_api_user)}
                        onCheckedChange={(checked) => toggleMutation.mutate({ id: u.id, enabled: checked })}
                        disabled={toggleMutation.isPending}
                      />
                      <Badge variant={u.is_api_user ? "default" : "secondary"}>
                        {u.is_api_user ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{u.api_key_masked || "—"}</TableCell>
                  <TableCell className="text-xs">
                    {u.api_last_used_at ? formatDateTime(u.api_last_used_at) : "Never"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {u.api_key_updated_at ? formatDateTime(u.api_key_updated_at) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/admin/api-users/$userId" params={{ userId: String(u.id) }}>
                        <Eye className="size-3.5" />
                        Manage
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
      />
    </AdminShell>
  );
}

function ApiUserCard({
  user,
  toggling,
  onToggle,
}: {
  user: AdminApiUser;
  toggling: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <AdminMobileCard>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{user.phone}</p>
          <p className="text-xs text-muted-foreground">
            {[user.first_name, user.last_name].filter(Boolean).join(" ") || "—"}
          </p>
        </div>
        <Switch checked={Boolean(user.is_api_user)} onCheckedChange={onToggle} disabled={toggling} />
      </div>
      <AdminMobileMeta
        items={[
          { label: "API", value: user.is_api_user ? "Enabled" : "Disabled" },
          { label: "Key", value: user.api_key_masked || "—" },
        ]}
      />
      <Button asChild size="sm" variant="outline" className="mt-2 w-full">
        <Link to="/admin/api-users/$userId" params={{ userId: String(user.id) }}>
          <KeyRound className="size-3.5" />
          Manage API user
        </Link>
      </Button>
    </AdminMobileCard>
  );
}
