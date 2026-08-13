import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Bell, Send } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
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
import { apiClient, ApiError } from "@/lib/api";

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

function PushPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "user">("all");
  const [phone, setPhone] = useState("");

  const statusQuery = useQuery({
    queryKey: ["admin", "push-status"],
    queryFn: () => apiClient.adminPushStatus(),
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
      toast.success(res.message, {
        description: `Sent ${res.sent} · failed ${res.failed} · skipped ${res.skipped}`,
      });
      setTitle("");
      setBody("");
      void statusQuery.refetch();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not send push.");
    },
  });

  const status = statusQuery.data;
  const canSend =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (audience === "all" || phone.trim().length >= 5) &&
    !sendMutation.isPending;

  return (
    <AdminShell
      title="Push notifications"
      description="Send a Firebase app notification to registered MySewa devices."
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Firebase"
          value={
            statusQuery.isLoading
              ? "…"
              : status?.configured
                ? status.mode === "http_v1"
                  ? "Connected"
                  : "Legacy key"
                : "Not configured"
          }
        />
        <StatCard label="App devices" value={String(status?.device_count ?? 0)} />
        <StatCard label="Users with a token" value={String(status?.user_count ?? 0)} />
      </div>

      {!statusQuery.isLoading && status && !status.configured && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Firebase credentials are not on the server yet. Put the service-account
          JSON at <code>server/firebase-service-account.json</code> (or set{" "}
          <code>FIREBASE_CREDENTIALS_PATH</code>) then restart Django.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="size-4" />
            Send app push
          </CardTitle>
          <CardDescription>
            Uses Firebase Cloud Messaging. Each device token is stored once and
            reused.
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
