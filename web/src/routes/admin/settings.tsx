import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Bell,
  Building2,
  CreditCard,
  ArrowLeftRight,
  QrCode,
  Save,
  Shield,
} from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { AppConfig } from "@/lib/types";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "App Settings — MySewa Admin" },
      {
        name: "description",
        content:
          "Manage MySewa global configuration: site info, payments, transaction rules, notifications, security, and deposit account details.",
      },
      { property: "og:title", content: "App Settings — MySewa Admin" },
      {
        property: "og:description",
        content: "System-wide settings for the MySewa platform.",
      },
    ],
  }),
  component: SettingsPage,
});

const DEFAULT_CONFIG: AppConfig = {
  site: {
    site_name: "MySewa",
    tagline: "Digital wallet & bill payments",
    support_email: "",
    support_phone: "",
    address: "",
    currency: "NPR",
    timezone: "Asia/Kathmandu",
  },
  payment: {
    deposits_enabled: true,
    topups_enabled: true,
    transfers_enabled: true,
    min_deposit: 100,
    max_deposit: 100000,
    deposit_instructions: "",
  },
  transactions: {
    min_topup: 10,
    max_topup: 5000,
    min_transfer: 10,
    max_transfer: 100000,
    topup_charge_percent: 0,
    transfer_charge_flat: 0,
    daily_transfer_limit: 200000,
  },
  notifications: {
    email_on_deposit: true,
    email_on_topup: false,
    sms_on_deposit_approved: true,
    admin_alert_email: "",
    notify_low_balance: false,
    low_balance_threshold: 100,
  },
  security: {
    require_deposit_screenshot: true,
    max_failed_logins: 5,
    session_timeout_minutes: 60,
    maintenance_mode: false,
    maintenance_message: "",
    allow_new_registrations: true,
  },
};

type BankForm = {
  bank_name: string;
  account_name: string;
  account_number: string;
  branch: string;
};

const SECTIONS = [
  { id: "site", label: "Site", icon: Building2 },
  { id: "payment", label: "Payments", icon: CreditCard },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "deposit", label: "Deposit account", icon: QrCode },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => apiClient.adminGetSettings(),
  });

  const [tab, setTab] = useState<SectionId>("site");
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [bank, setBank] = useState<BankForm>({
    bank_name: "",
    account_name: "",
    account_number: "",
    branch: "",
  });
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsQuery.data) return;
    const remote = settingsQuery.data.config;
    setConfig({
      site: { ...DEFAULT_CONFIG.site, ...(remote?.site ?? {}) },
      payment: { ...DEFAULT_CONFIG.payment, ...(remote?.payment ?? {}) },
      transactions: { ...DEFAULT_CONFIG.transactions, ...(remote?.transactions ?? {}) },
      notifications: { ...DEFAULT_CONFIG.notifications, ...(remote?.notifications ?? {}) },
      security: { ...DEFAULT_CONFIG.security, ...(remote?.security ?? {}) },
    });
    const b = settingsQuery.data.bank_details ?? {};
    setBank({
      bank_name: b.bank_name || "",
      account_name: b.account_name || "",
      account_number: b.account_number || "",
      branch: b.branch || "",
    });
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!qrFile) {
      setQrPreview(null);
      return;
    }
    const url = URL.createObjectURL(qrFile);
    setQrPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [qrFile]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: FormData | Record<string, unknown>) =>
      apiClient.adminUpdateSettings(payload),
    onSuccess: () => {
      toast.success("Settings saved — changes apply across the system");
      setQrFile(null);
      invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Save failed");
    },
  });

  const saveConfigSection = <K extends keyof AppConfig>(section: K, values: AppConfig[K]) => {
    saveMutation.mutate({ config: { [section]: values } });
  };

  const saveDepositAccount = () => {
    const fd = new FormData();
    fd.append("bank_name", bank.bank_name);
    fd.append("account_name", bank.account_name);
    fd.append("account_number", bank.account_number);
    fd.append("branch", bank.branch);
    if (qrFile) fd.append("qr_code", qrFile);
    saveMutation.mutate(fd);
  };

  const saving = saveMutation.isPending;
  const updatedAt = settingsQuery.data
    ? `Last updated ${formatDateTime(settingsQuery.data.updated_at)}`
    : settingsQuery.isLoading
      ? "Loading…"
      : "Not loaded";

  return (
    <AdminShell
      title="Settings"
      description="Global system configuration applied across MySewa"
      actions={
        <p className="hidden text-xs text-muted-foreground sm:block">{updatedAt}</p>
      }
    >
      {settingsQuery.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          Could not load settings. Refresh the page or try again.
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as SectionId)} className="space-y-4">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/80 p-1.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <TabsTrigger key={id} value={id} className="gap-1.5 px-3 py-2">
                <Icon className="size-3.5 shrink-0" />
                <span>{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="site">
            <SettingsPanel
              title="Site information"
              description="Brand and contact details shown across the application."
              onSave={() => saveConfigSection("site", config.site)}
              saving={saving}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="site_name"
                  label="Site name"
                  value={config.site.site_name}
                  onChange={(v) => setConfig((c) => ({ ...c, site: { ...c.site, site_name: v } }))}
                />
                <Field
                  id="tagline"
                  label="Tagline"
                  value={config.site.tagline}
                  onChange={(v) => setConfig((c) => ({ ...c, site: { ...c.site, tagline: v } }))}
                />
                <Field
                  id="support_email"
                  label="Support email"
                  type="email"
                  value={config.site.support_email}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, site: { ...c.site, support_email: v } }))
                  }
                />
                <Field
                  id="support_phone"
                  label="Support phone"
                  value={config.site.support_phone}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, site: { ...c.site, support_phone: v } }))
                  }
                />
                <Field
                  id="currency"
                  label="Currency"
                  value={config.site.currency}
                  onChange={(v) => setConfig((c) => ({ ...c, site: { ...c.site, currency: v } }))}
                />
                <Field
                  id="timezone"
                  label="Timezone"
                  value={config.site.timezone}
                  onChange={(v) => setConfig((c) => ({ ...c, site: { ...c.site, timezone: v } }))}
                />
              </div>
              <div className="mt-4 space-y-1.5">
                <Label htmlFor="address">Address</Label>
                <Textarea
                  id="address"
                  rows={3}
                  value={config.site.address}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, site: { ...c.site, address: e.target.value } }))
                  }
                />
              </div>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="payment">
            <SettingsPanel
              title="Payment settings"
              description="Enable or disable payment channels and set deposit limits."
              onSave={() => saveConfigSection("payment", config.payment)}
              saving={saving}
            >
              <div className="space-y-3">
                <ToggleRow
                  label="Wallet deposits"
                  description="Allow customers to submit deposit requests"
                  checked={config.payment.deposits_enabled}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      payment: { ...c.payment, deposits_enabled: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Mobile top-ups"
                  description="Allow prepaid top-up transactions"
                  checked={config.payment.topups_enabled}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      payment: { ...c.payment, topups_enabled: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Bank transfers"
                  description="Allow outbound bank transfer transactions"
                  checked={config.payment.transfers_enabled}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      payment: { ...c.payment, transfers_enabled: v },
                    }))
                  }
                />
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <NumberField
                  id="min_deposit"
                  label="Minimum deposit (Rs.)"
                  value={config.payment.min_deposit}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, payment: { ...c.payment, min_deposit: v } }))
                  }
                />
                <NumberField
                  id="max_deposit"
                  label="Maximum deposit (Rs.)"
                  value={config.payment.max_deposit}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, payment: { ...c.payment, max_deposit: v } }))
                  }
                />
              </div>
              <div className="mt-4 space-y-1.5">
                <Label htmlFor="deposit_instructions">Deposit instructions</Label>
                <Textarea
                  id="deposit_instructions"
                  rows={3}
                  placeholder="Extra guidance shown when customers load their wallet"
                  value={config.payment.deposit_instructions}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      payment: { ...c.payment, deposit_instructions: e.target.value },
                    }))
                  }
                />
              </div>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="transactions">
            <SettingsPanel
              title="Transaction rules"
              description="Limits and charges for top-ups and bank transfers."
              onSave={() => saveConfigSection("transactions", config.transactions)}
              saving={saving}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  id="min_topup"
                  label="Min top-up (Rs.)"
                  value={config.transactions.min_topup}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      transactions: { ...c.transactions, min_topup: v },
                    }))
                  }
                />
                <NumberField
                  id="max_topup"
                  label="Max top-up (Rs.)"
                  value={config.transactions.max_topup}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      transactions: { ...c.transactions, max_topup: v },
                    }))
                  }
                />
                <NumberField
                  id="min_transfer"
                  label="Min transfer (Rs.)"
                  value={config.transactions.min_transfer}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      transactions: { ...c.transactions, min_transfer: v },
                    }))
                  }
                />
                <NumberField
                  id="max_transfer"
                  label="Max transfer (Rs.)"
                  value={config.transactions.max_transfer}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      transactions: { ...c.transactions, max_transfer: v },
                    }))
                  }
                />
                <NumberField
                  id="topup_charge_percent"
                  label="Top-up charge (%)"
                  value={config.transactions.topup_charge_percent}
                  step="0.01"
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      transactions: { ...c.transactions, topup_charge_percent: v },
                    }))
                  }
                />
                <NumberField
                  id="transfer_charge_flat"
                  label="Transfer charge (Rs.)"
                  value={config.transactions.transfer_charge_flat}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      transactions: { ...c.transactions, transfer_charge_flat: v },
                    }))
                  }
                />
                <NumberField
                  id="daily_transfer_limit"
                  label="Daily transfer limit (Rs.)"
                  value={config.transactions.daily_transfer_limit}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      transactions: { ...c.transactions, daily_transfer_limit: v },
                    }))
                  }
                />
              </div>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="deposit">
            <div className="grid gap-4 lg:grid-cols-3">
              <form
                className="rounded-xl border border-border bg-surface p-5 lg:col-span-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveDepositAccount();
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Bank details</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Deposit account shown to customers when they load their wallet. {updatedAt}
                    </p>
                  </div>
                  <Button type="submit" disabled={saving} className="gap-1.5">
                    <Save className="size-3.5" />
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["bank_name", "Bank name"],
                      ["account_name", "Account name"],
                      ["account_number", "Account number"],
                      ["branch", "Branch"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={key}>{label}</Label>
                      <Input
                        id={key}
                        value={bank[key]}
                        onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </form>

              <div className="rounded-xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold">Deposit QR code</h2>
                <div className="mt-4 flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted">
                  {qrPreview || settingsQuery.data?.qr_code_url ? (
                    <img
                      src={qrPreview || settingsQuery.data?.qr_code_url || ""}
                      alt="Deposit QR"
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
                      const input = (
                        e.currentTarget.parentElement as HTMLLabelElement
                      ).querySelector("input");
                      input?.click();
                    }}
                  >
                    {qrFile ? "QR selected — save to upload" : "Upload new QR"}
                  </Button>
                </label>
                {qrFile ? (
                  <Button
                    type="button"
                    className="mt-2 w-full gap-1.5"
                    disabled={saving}
                    onClick={saveDepositAccount}
                  >
                    <Save className="size-3.5" />
                    {saving ? "Saving…" : "Save QR & bank details"}
                  </Button>
                ) : null}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="notifications">
            <SettingsPanel
              title="Notifications"
              description="Alerts for customers and admins when key events occur."
              onSave={() => saveConfigSection("notifications", config.notifications)}
              saving={saving}
            >
              <div className="space-y-3">
                <ToggleRow
                  label="Email on deposit request"
                  description="Notify admins when a new deposit is submitted"
                  checked={config.notifications.email_on_deposit}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      notifications: { ...c.notifications, email_on_deposit: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Email on top-up"
                  description="Send confirmation email after a successful top-up"
                  checked={config.notifications.email_on_topup}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      notifications: { ...c.notifications, email_on_topup: v },
                    }))
                  }
                />
                <ToggleRow
                  label="SMS on deposit approved"
                  description="Text the customer when their deposit is approved"
                  checked={config.notifications.sms_on_deposit_approved}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      notifications: { ...c.notifications, sms_on_deposit_approved: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Low balance alerts"
                  description="Warn admins when wallet float drops below the threshold"
                  checked={config.notifications.notify_low_balance}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      notifications: { ...c.notifications, notify_low_balance: v },
                    }))
                  }
                />
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field
                  id="admin_alert_email"
                  label="Admin alert email"
                  type="email"
                  value={config.notifications.admin_alert_email}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      notifications: { ...c.notifications, admin_alert_email: v },
                    }))
                  }
                />
                <NumberField
                  id="low_balance_threshold"
                  label="Low balance threshold (Rs.)"
                  value={config.notifications.low_balance_threshold}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      notifications: { ...c.notifications, low_balance_threshold: v },
                    }))
                  }
                />
              </div>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="security">
            <SettingsPanel
              title="Security options"
              description="Access controls, session policy, and maintenance mode."
              onSave={() => saveConfigSection("security", config.security)}
              saving={saving}
            >
              <div className="space-y-3">
                <ToggleRow
                  label="Require deposit screenshot"
                  description="Customers must upload proof with deposit requests"
                  checked={config.security.require_deposit_screenshot}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      security: { ...c.security, require_deposit_screenshot: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Allow new registrations"
                  description="Permit new users to create accounts"
                  checked={config.security.allow_new_registrations}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      security: { ...c.security, allow_new_registrations: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Maintenance mode"
                  description="Temporarily block customer app access"
                  checked={config.security.maintenance_mode}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      security: { ...c.security, maintenance_mode: v },
                    }))
                  }
                />
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <NumberField
                  id="max_failed_logins"
                  label="Max failed logins"
                  value={config.security.max_failed_logins}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      security: { ...c.security, max_failed_logins: v },
                    }))
                  }
                />
                <NumberField
                  id="session_timeout_minutes"
                  label="Session timeout (minutes)"
                  value={config.security.session_timeout_minutes}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      security: { ...c.security, session_timeout_minutes: v },
                    }))
                  }
                />
              </div>
              <div className="mt-4 space-y-1.5">
                <Label htmlFor="maintenance_message">Maintenance message</Label>
                <Textarea
                  id="maintenance_message"
                  rows={3}
                  placeholder="Shown to customers while maintenance mode is on"
                  value={config.security.maintenance_message}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      security: { ...c.security, maintenance_message: e.target.value },
                    }))
                  }
                />
              </div>
            </SettingsPanel>
          </TabsContent>
        </Tabs>
      )}
    </AdminShell>
  );
}

function SettingsPanel({
  title,
  description,
  children,
  onSave,
  saving,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <form
      className="rounded-xl border border-border bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button type="submit" disabled={saving} className="gap-1.5">
          <Save className="size-3.5" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
      <div className="mt-5">{children}</div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  step = "1",
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        step={step}
        min={0}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/30 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
