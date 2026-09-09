import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { Copy, Download, Eye, EyeOff, RefreshCw } from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
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
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { canUseFundTransferApi } from "@/lib/account-status";

export const Route = createFileRoute("/app/developer")({
  head: () => ({
    meta: [
      { title: "Developer API — MySewa" },
      {
        name: "description",
        content: "MySewa Fund Transfer API credentials, documentation, and examples.",
      },
    ],
  }),
  component: DeveloperApiPage,
});

function DeveloperApiPage() {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const allowed = canUseFundTransferApi(user);

  const profileQuery = useQuery({
    queryKey: ["developer", "profile"],
    queryFn: () => apiClient.developerProfile(),
    enabled: allowed,
  });
  const data = profileQuery.data;
  const docs = data?.documentation;

  const regenMutation = useMutation({
    mutationFn: () => apiClient.developerRegenerateKey(),
    onSuccess: (res) => {
      toast.success(res.message || t("developer.keyRegenerated"));
      setShowKey(true);
      queryClient.setQueryData(["developer", "profile"], res);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("developer.regenFailed")),
  });

  const download = async (format: "markdown" | "html" | "pdf") => {
    try {
      await apiClient.developerDownloadDocs(format);
      toast.success(t("developer.downloadStarted"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("developer.downloadFailed"));
    }
  };

  const copy = async (value: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(ok);
    } catch {
      toast.error(t("common.copyFailed"));
    }
  };

  if (!allowed) {
    return (
      <UserShell title={t("developer.title")}>
        <div className="px-4 py-8">
          <BackButton to="/app/profile" label={t("common.goBack")} />
          <p className="mt-6 text-sm text-muted-foreground">{t("developer.notEnabled")}</p>
        </div>
      </UserShell>
    );
  }

  return (
    <UserShell title={t("developer.title")}>
      <div className="space-y-5 px-4 pb-8">
        <BackButton to="/app/profile" label={t("common.goBack")} />

        {profileQuery.isError && (
          <p className="text-sm text-muted-foreground">
            {profileQuery.error instanceof ApiError ? profileQuery.error.message : t("common.requestFailed")}
          </p>
        )}

        {data && docs && (
          <>
            <section className="rounded-2xl border border-border bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t("developer.status")}</h2>
                <Badge>{t("developer.enabled")}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("developer.lastUsed")}: {data.api_last_used_at ? formatDateTime(data.api_last_used_at) : t("developer.never")}
              </p>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t("developer.apiKey")}</p>
                <p className="break-all rounded-xl bg-muted px-3 py-2 font-mono text-xs">
                  {showKey ? data.api_key : data.api_key_masked}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {showKey ? t("developer.hideKey") : t("developer.showKey")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void copy(data.api_key, t("developer.keyCopied"))}>
                  <Copy className="size-3.5" />
                  {t("common.copy")}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="destructive">
                      <RefreshCw className="size-3.5" />
                      {t("developer.regenerate")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("developer.regenTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>{t("developer.regenBody")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => regenMutation.mutate()}>
                        {t("developer.regenerate")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-white p-4 space-y-2">
              <h2 className="text-sm font-semibold">{t("developer.docsTitle")}</h2>
              <p className="text-xs text-muted-foreground break-all">
                {docs.method} {docs.endpoint}
              </p>
              <p className="text-sm">{docs.authentication.header}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void download("markdown")}>
                  <Download className="size-3.5" />
                  Markdown
                </Button>
                <Button size="sm" variant="outline" onClick={() => void download("html")}>
                  <Download className="size-3.5" />
                  HTML
                </Button>
                <Button size="sm" variant="outline" onClick={() => void download("pdf")}>
                  <Download className="size-3.5" />
                  PDF
                </Button>
              </div>
            </section>

            <DocBlock title={t("developer.request")}>
              {JSON.stringify(
                {
                  receiver: "98XXXXXXXX",
                  amount: 1000,
                  reference: "ORDER-10001",
                },
                null,
                2,
              )}
            </DocBlock>
            <DocBlock title={t("developer.success")}>
              {JSON.stringify(docs.success_response, null, 2)}
            </DocBlock>
            <ul className="space-y-1 text-sm">
              {docs.validation.map((rule) => (
                <li key={rule}>• {rule}</li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">{docs.idempotency}</p>
            <DocBlock title="cURL">{docs.examples.curl}</DocBlock>
            <DocBlock title="Python">{docs.examples.python}</DocBlock>
            <DocBlock title="JavaScript">{docs.examples.javascript}</DocBlock>
            <section className="rounded-2xl border border-border bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">{t("developer.errors")}</h2>
              <ul className="space-y-1 text-sm">
                {docs.error_responses.map((item) => (
                  <li key={item.code}>
                    <span className="font-mono text-xs">{item.http}</span> {item.error}{" "}
                    <span className="text-muted-foreground">({item.code})</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-2xl border border-border bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">{t("developer.security")}</h2>
              <ul className="space-y-1 text-sm">
                {docs.security.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </section>
            <p className="text-xs text-muted-foreground">
              <Link to="/app/history" className="text-brand underline">
                {t("developer.viewHistory")}
              </Link>
            </p>
          </>
        )}
      </div>
    </UserShell>
  );
}

function DocBlock({ title, children }: { title: string; children: string }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
        {children}
      </pre>
    </section>
  );
}
