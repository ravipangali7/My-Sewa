import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Bell, Send } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import type { AdminPushSendResult } from "@/lib/types";

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

function PushPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "user">("all");
  const [phone, setPhone] = useState("");
  const [lastResult, setLastResult] = useState<AdminPushSendResult | null>(null);

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
      setLastResult(res);
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
    },
    onError: (err) => {
      const fromBody = err instanceof ApiError ? asPushResult(err.body) : null;
      if (fromBody) setLastResult(fromBody);
      toast.error(err instanceof ApiError ? err.message : "Could not send push.", {
        description:
          fromBody?.issue ||
          (err instanceof ApiError && typeof err.body === "object"
            ? JSON.stringify(err.body)
            : undefined),
      });
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
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <StatCard
          label="Placeholder tokens"
          value={String(status?.stub_count ?? 0)}
        />
      </div>

      {status?.project_id && (
        <p className="mb-4 text-xs text-muted-foreground">
          Firebase project: <code>{status.project_id}</code>
          {status.mode ? ` · ${status.mode}` : ""}
        </p>
      )}

      {!statusQuery.isLoading && status && !status.configured && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Firebase credentials are not on the server yet. Put the service-account
          JSON at <code>server/firebase-service-account.json</code> (or set{" "}
          <code>FIREBASE_CREDENTIALS_PATH</code>) then restart Django.
        </p>
      )}

      {!statusQuery.isLoading && (status?.stub_count ?? 0) > 0 && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {status?.stub_count} stored token(s) are placeholders (flutter-stub / web: /
          stub: / too short), not real FCM tokens. Those devices are skipped and
          Firebase is not called for them.
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
            reused. After send, Firebase errors and skip reasons appear below.
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

      {lastResult && <PushResultPanel result={lastResult} />}
    </AdminShell>
  );
}

function PushResultPanel({ result }: { result: AdminPushSendResult }) {
  const failed = result.failed > 0 || result.sent === 0;
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">Firebase response</CardTitle>
        <CardDescription>
          {result.firebase_called
            ? `Firebase ${result.mode || "FCM"} was called.`
            : "Firebase was not contacted for these devices."}
          {result.project_id ? ` Project: ${result.project_id}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <StatCard label="Sent" value={String(result.sent)} />
          <StatCard label="Failed" value={String(result.failed)} />
          <StatCard label="Skipped" value={String(result.skipped)} />
          <StatCard label="Targets" value={String(result.target_count)} />
        </div>

        {(result.issues?.length || result.issue) && (
          <Alert variant={failed ? "destructive" : "default"}>
            <AlertCircle className="size-4" />
            <AlertTitle>Why it failed / was skipped</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {(result.issues?.length ? result.issues : [result.issue])
                  .filter(Boolean)
                  .map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {!!result.skip_reasons?.length && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Skipped tokens</h3>
            <ul className="space-y-2 text-sm">
              {result.skip_reasons.map((row) => (
                <li
                  key={row.reason}
                  className="rounded-lg border bg-muted/40 px-3 py-2"
                >
                  <p className="font-medium">
                    {row.count} × {row.reason}
                  </p>
                  {row.help && (
                    <p className="mt-1 text-muted-foreground">{row.help}</p>
                  )}
                  {!!row.samples?.length && (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      samples: {row.samples.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!!result.errors?.length && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Firebase errors</h3>
            <ul className="space-y-2 text-sm">
              {result.errors.map((row) => (
                <li
                  key={row.error_code}
                  className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2"
                >
                  <p className="font-medium">
                    {row.count} × {row.error_code}
                    {row.http_status ? ` (HTTP ${row.http_status})` : ""}
                  </p>
                  {row.help && <p className="mt-1">{row.help}</p>}
                  {row.error_message && (
                    <p className="mt-1 text-muted-foreground">{row.error_message}</p>
                  )}
                  {!!row.samples?.length && (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      tokens: {row.samples.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!!result.deliveries?.length && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Per-device Firebase payload</h3>
            <div className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-3">
              <pre className="whitespace-pre-wrap break-all font-mono text-xs">
                {JSON.stringify(
                  result.deliveries.map((row) => ({
                    token: row.token_preview,
                    ok: row.ok,
                    http_status: row.http_status,
                    error_code: row.error_code,
                    error_message: row.error_message,
                    issue: row.issue,
                    token_removed: row.token_removed,
                    firebase: row.firebase,
                  })),
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Full API response</h3>
          <div className="max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        </div>
      </CardContent>
    </Card>
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
