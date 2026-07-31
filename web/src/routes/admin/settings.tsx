import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QrCode } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "App Settings — MySewa Admin" },
      {
        name: "description",
        content:
          "Manage the MySewa deposit QR code and bank details shown to customers when they load their wallet.",
      },
      { property: "og:title", content: "App Settings — MySewa Admin" },
      { property: "og:description", content: "Singleton deposit QR and bank account configuration." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => apiClient.adminGetSettings(),
  });

  const [bank, setBank] = useState({
    bank_name: "",
    account_name: "",
    account_number: "",
    branch: "",
  });
  const [qrFile, setQrFile] = useState<File | null>(null);

  useEffect(() => {
    if (settingsQuery.data?.bank_details) {
      const b = settingsQuery.data.bank_details;
      setBank({
        bank_name: b.bank_name || "",
        account_name: b.account_name || "",
        account_number: b.account_number || "",
        branch: b.branch || "",
      });
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("bank_name", bank.bank_name);
      fd.append("account_name", bank.account_name);
      fd.append("account_number", bank.account_number);
      fd.append("branch", bank.branch);
      if (qrFile) fd.append("qr_code", qrFile);
      return apiClient.adminUpdateSettings(fd);
    },
    onSuccess: () => {
      toast.success("Settings updated");
      setQrFile(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Save failed");
    },
  });

  const field = (key: keyof typeof bank, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={bank[key]}
        onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <AdminShell title="Settings" description="Deposit instructions shown in the customer app">
      <div className="grid gap-4 lg:grid-cols-3">
        <form
          className="rounded-xl border border-border bg-surface p-5 lg:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <h2 className="text-base font-semibold">Bank details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {settingsQuery.data
              ? `Last updated ${formatDateTime(settingsQuery.data.updated_at)}`
              : "Loading…"}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {field("bank_name", "Bank name")}
            {field("account_name", "Account name")}
            {field("account_number", "Account number")}
            {field("branch", "Branch")}
          </div>
          <Button type="submit" className="mt-5" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </form>

        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-base font-semibold">Deposit QR code</h2>
          <div className="mt-4 flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted">
            {settingsQuery.data?.qr_code_url ? (
              <img
                src={settingsQuery.data.qr_code_url}
                alt="QR"
                className="size-full object-contain"
              />
            ) : (
              <QrCode className="size-16 text-muted-foreground" />
            )}
          </div>
          <p className="mt-3 truncate text-xs text-muted-foreground">
            {qrFile?.name || settingsQuery.data?.qr_code || "No QR uploaded"}
          </p>
          <label className="mt-3 block">
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => setQrFile(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="secondary"
              className="w-full"
              type="button"
              onClick={(e) => {
                const input = (e.currentTarget.parentElement as HTMLLabelElement).querySelector(
                  "input",
                );
                input?.click();
              }}
            >
              {qrFile ? "QR selected — save to upload" : "Upload new QR"}
            </Button>
          </label>
        </div>
      </div>
    </AdminShell>
  );
}
