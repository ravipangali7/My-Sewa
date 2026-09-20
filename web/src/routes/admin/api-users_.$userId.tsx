import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { adminLiveQueryOptions } from "@/lib/refresh";
import { formatDateTime, formatNPR } from "@/lib/format";

export const Route = createFileRoute("/admin/api-users_/$userId")({
  head: () => ({
    meta: [{ title: "API User — MySewa Admin" }],
  }),
  component: AdminApiUserDetailPage,
});

function AdminApiUserDetailPage() {
  const { userId } = Route.useParams();
  const id = Number(userId);
  const queryClient = useQueryClient();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [returnUrl, setReturnUrl] = useState("");

  const userQuery = useQuery({
    queryKey: ["admin", "api-users", id],
    queryFn: () => apiClient.adminGetApiUser(id),
    enabled: Number.isFinite(id),
    ...adminLiveQueryOptions(),
  });
  const logsQuery = useQuery({
    queryKey: ["admin", "api-users", id, "logs"],
    queryFn: () => apiClient.adminApiUserLogs(id),
    enabled: Number.isFinite(id),
    ...adminLiveQueryOptions(),
  });

  useEffect(() => {
    if (userQuery.data) {
      setWebhookUrl(userQuery.data.api_webhook_url || "");
      setReturnUrl(userQuery.data.api_return_url || "");
    }
  }, [userQuery.data?.id, userQuery.data?.api_webhook_url, userQuery.data?.api_return_url]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "api-users"] });
  };

  const accessMutation = useMutation({
    mutationFn: (payload: {
      is_api_user?: boolean;
      can_api_payin?: boolean;
      api_webhook_url?: string;
      api_return_url?: string;
    }) => apiClient.adminSetApiUserAccess(id, payload),
    onSuccess: (res) => {
      toast.success(res.message || "API access updated");
      setRevealedKey(null);
      if (res.data?.api_webhook_url !== undefined) {
        setWebhookUrl(res.data.api_webhook_url || "");
      }
      if (res.data?.api_return_url !== undefined) {
        setReturnUrl(res.data.api_return_url || "");
      }
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Update failed"),
  });
  const revealMutation = useMutation({
    mutationFn: () => apiClient.adminRevealApiKey(id),
    onSuccess: (data) => {
      setRevealedKey(data.api_key || "");
      setShowKey(true);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not reveal key"),
  });
  const regenMutation = useMutation({
    mutationFn: () => apiClient.adminRegenerateApiKey(id),
    onSuccess: (res) => {
      toast.success(res.message);
      setRevealedKey(res.data.api_key || "");
      setShowKey(true);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not regenerate key"),
  });

  const u = userQuery.data;
  const displayKey = showKey && revealedKey ? revealedKey : u?.api_key_masked || "—";

  const copyKey = async () => {
    if (!revealedKey) {
      toast.error("Reveal the key first");
      return;
    }
    try {
      await navigator.clipboard.writeText(revealedKey);
      toast.success("API key copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <AdminShell
      title={u ? `API — ${u.phone}` : "API User"}
      description="View API status, keys, Payin permission, and API audit logs"
    >
      <div className="mb-5">
        <BackButton to="/admin/api-users" label="Back to API users" />
      </div>

      {userQuery.isError && (
        <p className="text-sm text-muted-foreground">
          {userQuery.error instanceof ApiError ? userQuery.error.message : "User not found."}
        </p>
      )}

      {u && (
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Account</p>
                <p className="font-medium">{u.phone}</p>
                <p className="text-sm text-muted-foreground">
                  {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || "—"}
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/users/$userId" params={{ userId }}>
                  Open user profile
                </Link>
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">API access</p>
                  <p className="text-xs text-muted-foreground">Enabling for the first time generates a key.</p>
                </div>
                <Switch
                  checked={Boolean(u.is_api_user)}
                  onCheckedChange={(checked) =>
                    accessMutation.mutate({ is_api_user: checked })
                  }
                  disabled={accessMutation.isPending}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Payin / Wallet Load API</p>
                  <p className="text-xs text-muted-foreground">
                    Allow PayBridgeNP payin for this API key. Requires API access.
                  </p>
                </div>
                <Switch
                  checked={Boolean(u.can_api_payin)}
                  onCheckedChange={(checked) =>
                    accessMutation.mutate({ can_api_payin: checked })
                  }
                  disabled={accessMutation.isPending || !u.is_api_user}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Account status</p>
                  <Badge variant={u.is_active && u.account_status === "approved" ? "default" : "secondary"}>
                    {u.is_active ? (u.account_status === "approved" ? "Active" : "Pending") : "Inactive"}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4 sm:p-5 space-y-3">
            <h2 className="text-sm font-semibold">Payin webhook URL</h2>
            <p className="text-xs text-muted-foreground">
              After PayBridgeNP confirms payment and MySewa credits the receiver wallet, MySewa
              POSTs the result to this URL for this API user (server-to-server). The player browser
              is never opened on this URL — use Return URL below for that.
            </p>
            <div className="space-y-2">
              <Label htmlFor="api_webhook_url">Webhook URL</Label>
              <Input
                id="api_webhook_url"
                type="url"
                placeholder="https://your-game.example/webhooks/mysewa-payin"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={accessMutation.isPending}
                onClick={() =>
                  accessMutation.mutate({ api_webhook_url: webhookUrl.trim() })
                }
              >
                Save webhook URL
              </Button>
              {webhookUrl ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={accessMutation.isPending}
                  onClick={() => {
                    setWebhookUrl("");
                    accessMutation.mutate({ api_webhook_url: "" });
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4 sm:p-5 space-y-3">
            <h2 className="text-sm font-semibold">Payin return URL (player browser)</h2>
            <p className="text-xs text-muted-foreground">
              Optional. After a successful Payin, MySewa redirects the player browser here (game
              page / deep link). Do not put the webhook API URL here — that only returns JSON.
            </p>
            <div className="space-y-2">
              <Label htmlFor="api_return_url">Return URL</Label>
              <Input
                id="api_return_url"
                type="url"
                placeholder="https://your-game.example/deposit/success"
                value={returnUrl}
                onChange={(e) => setReturnUrl(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={accessMutation.isPending}
                onClick={() =>
                  accessMutation.mutate({ api_return_url: returnUrl.trim() })
                }
              >
                Save return URL
              </Button>
              {returnUrl ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={accessMutation.isPending}
                  onClick={() => {
                    setReturnUrl("");
                    accessMutation.mutate({ api_return_url: "" });
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4 sm:p-5 space-y-3">
            <h2 className="text-sm font-semibold">API key</h2>
            <p className="font-mono text-sm break-all rounded-lg bg-muted px-3 py-2">{displayKey}</p>
            <p className="text-xs text-muted-foreground">
              Created {u.api_key_created_at ? formatDateTime(u.api_key_created_at) : "—"} · Updated{" "}
              {u.api_key_updated_at ? formatDateTime(u.api_key_updated_at) : "—"} · Last used{" "}
              {u.api_last_used_at ? formatDateTime(u.api_last_used_at) : "never"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (showKey && revealedKey) {
                    setShowKey(false);
                    return;
                  }
                  revealMutation.mutate();
                }}
                disabled={revealMutation.isPending}
              >
                {showKey && revealedKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showKey && revealedKey ? "Hide key" : "Reveal key"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void copyKey()} disabled={!revealedKey}>
                <Copy className="size-3.5" />
                Copy
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive">
                    <RefreshCw className="size-3.5" />
                    Regenerate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate API key?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The previous API key will stop working immediately. Any client using the old key
                      will receive authentication errors until they switch to the new key.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => regenMutation.mutate()}>
                      Regenerate key
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Fund Transfer API history</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Receiver</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Txn ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logsQuery.data?.items ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      No API fund-transfer calls yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  (logsQuery.data?.items ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs">{formatDateTime(row.created_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.reference || "—"}</TableCell>
                      <TableCell className="text-xs">{row.receiver || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {row.amount != null ? formatNPR(row.amount) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === "success" ? "default" : "secondary"}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.transaction_id || row.error_code || "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Payin / Wallet Load API history</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Receiver</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Order / Txn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logsQuery.data?.payin_items ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      No API payin calls yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  (logsQuery.data?.payin_items ?? []).map((row) => (
                    <TableRow key={`payin-${row.id}`}>
                      <TableCell className="text-xs">{formatDateTime(row.created_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.reference || "—"}</TableCell>
                      <TableCell className="text-xs">{row.receiver || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {row.amount != null ? formatNPR(row.amount) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === "success" || row.status === "pending"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.transaction_id || row.order_id || row.error_code || "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
