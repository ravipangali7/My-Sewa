import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Bell, Send } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import type { AdminPushNotification, AdminPushSendResult } from "@/lib/types";

export const Route = createFileRoute("/admin/push")({
  head: () => ({
    meta: [
      { title: "Push notifications — MySewa Admin" },
      {
        name: "description",
        content: "Send Firebase app push notifications to MySewa devices.",
      },
      { property: "og:title", content: "Push notifications — MySewa Admin" },
    ],
  }),
  component: PushPage,
});

function asPushResult(value: unknown): AdminPushSendResult | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.sent !== "number") return null;
  return value as AdminPushSendResult;
}

function audienceLabel(row: AdminPushNotification) {
  if (row.audience === "user") {
    return row.target_user_phone || row.target_phone || "One user";
  }
  return row.audience_display || "All devices";
}

function PushPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "user">("all");
  const [phone, setPhone] = useState("");

  const statusQuery = useQuery({
    queryKey: ["admin", "push-status"],
    queryFn: () => apiClient.adminPushStatus(),
  });

  const historyQuery = useQuery({
    queryKey: ["admin", "push-history"],
    queryFn: () => apiClient.adminPushHistory(),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      apiClient.adminSendPush({
        title: title.trim(),
        body: body.trim(),
        audience,
        ...(audience === "user" ? { phone: phone.trim() } : {}),
      }),
    onSuccess: (res) => {
      const summary = `Sent ${res.sent} · failed ${res.failed} · skipped ${res.skipped}`;
      if (res.sent > 0 && res.failed === 0) {
        toast.success(res.message, { description: summary });
        setTitle("");
        setBody("");
      } else if (res.sent > 0) {
        toast.success(res.message, { description: summary });
      } else {
        toast.error(res.message || "No devices received the push.", {
          description: res.issue || summary,
        });
      }
      void statusQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["admin", "push-history"] });
    },
    onError: (err) => {
      const fromBody = err instanceof ApiError ? asPushResult(err.body) : null;
      toast.error(err instanceof ApiError ? err.message : "Could not send push.", {
        description: fromBody?.issue,
      });
    },
  });

  const status = statusQuery.data;
  const items = historyQuery.data?.items ?? [];
  const canSend =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (audience === "all" || phone.trim().length >= 5) &&
    !sendMutation.isPending;

  return (
    <AdminShell
      title="Push notifications"
      description="Send a notification to registered MySewa devices."
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Firebase"
          value={
            statusQuery.isLoading
              ? "…"
              : status?.configured
                ? "Connected"
                : "Not configured"
          }
        />
        <StatCard label="App devices" value={String(status?.device_count ?? 0)} />
        <StatCard label="Users with a token" value={String(status?.user_count ?? 0)} />
      </div>

      {!statusQuery.isLoading && status && !status.configured && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Firebase credentials are not on the server yet. Add the service-account
          file and restart Django before sending.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="size-4" />
            Send app push
          </CardTitle>
          <CardDescription>
            Each send is stored in push notification history below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="push-title">Title</Label>
            <Input
              id="push-title"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="MySewa"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="push-body">Message</Label>
            <Textarea
              id="push-body"
              maxLength={1000}
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the notification users will see on their phone."
            />
          </div>
          <div className="space-y-2">
            <Label>Audience</Label>
            <RadioGroup
              value={audience}
              onValueChange={(value) => setAudience(value === "user" ? "user" : "all")}
              className="gap-3"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="all" id="push-all" />
                All app users with a registered device
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="user" id="push-user" />
                One user (phone number)
              </label>
            </RadioGroup>
          </div>
          {audience === "user" && (
            <div className="space-y-2">
              <Label htmlFor="push-phone">Phone</Label>
              <Input
                id="push-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98XXXXXXXX"
              />
            </div>
          )}
          <Button
            type="button"
            className="gap-1.5"
            disabled={!canSend}
            onClick={() => sendMutation.mutate()}
          >
            <Send className="size-4" />
            {sendMutation.isPending ? "Sending…" : "Send push"}
          </Button>
        </CardContent>
      </Card>

      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold">Sent notifications</h2>
        {historyQuery.isLoading && (
          <p className="mb-4 text-sm text-muted-foreground">Loading history…</p>
        )}
        {historyQuery.isError && (
          <p className="mb-4 text-sm text-destructive">
            {historyQuery.error instanceof ApiError
              ? historyQuery.error.message
              : "Could not load push history."}
          </p>
        )}
        <AdminDataList
          isEmpty={!historyQuery.isLoading && items.length === 0}
          empty={<AdminEmptyState>No push notifications sent yet.</AdminEmptyState>}
          mobile={
            <AdminMobileCardGrid>
              {items.map((row) => (
                <AdminMobileCard key={row.id}>
                  <p className="font-medium">{row.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{row.body}</p>
                  <AdminMobileMeta
                    items={[
                      { label: "Audience", value: audienceLabel(row) },
                      { label: "Sent", value: String(row.sent) },
                      { label: "Failed", value: String(row.failed) },
                      { label: "When", value: formatDateTime(row.created_at) },
                    ]}
                  />
                </AdminMobileCard>
              ))}
            </AdminMobileCardGrid>
          }
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.title}</TableCell>
                    <TableCell className="max-w-sm truncate text-muted-foreground">
                      {row.body}
                    </TableCell>
                    <TableCell>{audienceLabel(row)}</TableCell>
                    <TableCell className="text-right">{row.sent}</TableCell>
                    <TableCell className="text-right">{row.failed}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(row.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        />
      </div>
    </AdminShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
