import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Bell,
  Building2,
  CreditCard,
  ArrowLeftRight,
  Database,
  FileArchive,
  FileCode2,
  FileSpreadsheet,
  ImageIcon,
  Mail,
  Plus,
  QrCode,
  Save,
  Shield,
  ArrowDownToLine,
  Send,
  Smartphone,
  Percent,
  Trash2,
} from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { useErrorPopup } from "@/components/ErrorPopup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  accountQrClearKey,
  accountQrUploadKey,
  emptyPaymentAccount,
  methodLabel,
  normalizePaymentAccounts,
  paymentAccountsToBankDetails,
} from "@/lib/payment-accounts";
import type { AppConfig, PaymentAccount, PaymentMethod } from "@/lib/types";
import { cn } from "@/lib/utils";

const DEPOSIT_METHODS: {
  method: PaymentMethod;
  title: string;
  description: string;
  addLabel: string;
}[] = [
  {
    method: "bank",
    title: "Bank accounts",
    description:
      "Bank transfer destinations shown to customers for manual wallet load. Managed independently from Khalti and eSewa.",
    addLabel: "Add bank account",
  },
  {
    method: "khalti",
    title: "Khalti accounts",
    description:
      "Khalti wallet IDs customers can pay into. Saving here does not change bank or eSewa accounts.",
    addLabel: "Add Khalti account",
  },
  {
    method: "esewa",
    title: "eSewa accounts",
    description:
      "eSewa wallet IDs customers can pay into. Saving here does not change bank or Khalti accounts.",
    addLabel: "Add eSewa account",
  },
];

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "App Settings — MySewa Admin" },
      {
        name: "description",
        content:
          "Manage MySewa global configuration: general info, branding, payments, transaction rules, SMTP email, notifications, security, Android auto-update, deposit accounts, and full data export.",
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
    remittances_enabled: true,
    internet_bills_enabled: true,
    data_packs_enabled: true,
    water_bills_enabled: true,
    electricity_bills_enabled: true,
    community_electricity_enabled: true,
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
    transfer_charge_enabled: true,
    transfer_charge_flat: 0,
    cashback_enabled: true,
    transfer_cashback_flat: 0,
    transfer_cashback_percent: 0,
    daily_transfer_limit: 200000,
    auto_status_verified: false,
  },
  commission: {
    default_commission_rate: 0,
    default_sub_agent_rate: 0,
    default_super_admin_rate: 0,
    default_tds_rate: 15,
  },
  notifications: {
    email_on_deposit: true,
    email_on_topup: true,
    sms_on_deposit_approved: true,
    email_on_wallet_credit: true,
    email_on_wallet_debit: true,
    email_on_transfer: true,
    email_on_wallet_adjustment: true,
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
    otp_login_enabled: true,
  },
  integrations: {
    himalpay_api_key: "",
    himalpay_base_url: "https://api.himalpay.com.np/api/v1",
    himalpay_portal_phone: "",
    himalpay_portal_email: "",
    himalpay_portal_password: "",
  },
  smtp: {
    enabled: true,
    host: "smtp.gmail.com",
    port: 587,
    encryption: "tls",
    smtp_email: "jhalakravi7@gmail.com",
    smtp_password: "",
    smtp_email_from: "jhalakravi7@gmail.com",
    smtp_name: "ATOZ Store",
    username: "jhalakravi7@gmail.com",
    password: "",
    from_email: "jhalakravi7@gmail.com",
    from_name: "ATOZ Store",
  },
  remittance: {
    payout_location_name: "MySewa",
    payout_agent_state: "Bagmati",
    payout_agent_district: "Kathmandu",
    payout_agent_municipality: "Kathmandu Metropolitan City",
    payout_agent_ward_number: "10",
    payout_agent_pan_number: "",
    teller_contact: "",
    payout_payment_type: "Cash",
    payout_payment_number: "",
    payout_payment_bank_name: "",
    payout_payment_bank_branch: "",
  },
};

const SECTIONS = [
  { id: "site", label: "General", icon: Building2 },
  { id: "payment", label: "Payments", icon: CreditCard },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "commission", label: "Dealer commission", icon: Percent },
  { id: "remittance", label: "Remittance agent", icon: ArrowDownToLine },
  { id: "deposit", label: "Deposit accounts", icon: QrCode },
  { id: "smtp", label: "Email / SMTP", icon: Mail },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "mobile", label: "App update", icon: Smartphone },
  { id: "export", label: "Data export", icon: Database },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function SettingsPage() {
  const queryClient = useQueryClient();
  const errorPopup = useErrorPopup("Settings error");
  const [tab, setTab] = useState<SectionId>("site");
  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => apiClient.adminGetSettings(),
  });
  const himalpayStatusQuery = useQuery({
    queryKey: ["admin", "himalpay-status"],
    queryFn: () => apiClient.adminHimalpayStatus(),
    retry: false,
    enabled: tab === "deposit",
  });

  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [accountQrFiles, setAccountQrFiles] = useState<Record<string, File | null>>({});
  const [accountQrPreviews, setAccountQrPreviews] = useState<Record<string, string | null>>({});
  const [qrTab, setQrTab] = useState<"bank" | "khalti" | "esewa">("bank");
  const [qrFiles, setQrFiles] = useState<
    Partial<Record<"bank" | "khalti" | "esewa", File | null>>
  >({});
  const [qrPreviews, setQrPreviews] = useState<
    Partial<Record<"bank" | "khalti" | "esewa", string | null>>
  >({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const [smtpPasswordTouched, setSmtpPasswordTouched] = useState(false);

  useEffect(() => {
    if (!settingsQuery.data) return;
    const remote = settingsQuery.data.config;
    setAutoUpdateEnabled(Boolean(settingsQuery.data.auto_update_enabled));
    setAppVersion(settingsQuery.data.app_version ?? "");
    setConfig({
      site: { ...DEFAULT_CONFIG.site, ...(remote?.site ?? {}) },
      payment: { ...DEFAULT_CONFIG.payment, ...(remote?.payment ?? {}) },
      transactions: { ...DEFAULT_CONFIG.transactions, ...(remote?.transactions ?? {}) },
      commission: { ...DEFAULT_CONFIG.commission!, ...(remote?.commission ?? {}) },
      notifications: { ...DEFAULT_CONFIG.notifications, ...(remote?.notifications ?? {}) },
      security: { ...DEFAULT_CONFIG.security, ...(remote?.security ?? {}) },
      integrations: {
        ...DEFAULT_CONFIG.integrations!,
        ...(remote?.integrations ?? {}),
      },
      smtp: {
        ...DEFAULT_CONFIG.smtp!,
        ...(remote?.smtp ?? {}),
        encryption: (remote?.smtp?.encryption as "tls" | "ssl" | "none") || "tls",
        port: Number(remote?.smtp?.port ?? DEFAULT_CONFIG.smtp!.port) || 587,
        smtp_email:
          remote?.smtp?.smtp_email ||
          remote?.smtp?.username ||
          DEFAULT_CONFIG.smtp!.smtp_email,
        smtp_password: remote?.smtp?.smtp_password || remote?.smtp?.password || "",
        smtp_email_from:
          remote?.smtp?.smtp_email_from ||
          remote?.smtp?.from_email ||
          DEFAULT_CONFIG.smtp!.smtp_email_from,
        smtp_name:
          remote?.smtp?.smtp_name ||
          remote?.smtp?.from_name ||
          DEFAULT_CONFIG.smtp!.smtp_name,
      },
      remittance: {
        ...DEFAULT_CONFIG.remittance!,
        ...(remote?.remittance ?? {}),
      },
    });
    setSmtpPasswordTouched(false);
    setAccounts(normalizePaymentAccounts(settingsQuery.data.bank_details));
    setSmtpTestEmail((prev) =>
      prev ||
      remote?.notifications?.admin_alert_email ||
      remote?.smtp?.smtp_email_from ||
      remote?.smtp?.from_email ||
      "",
    );
  }, [settingsQuery.data]);

  useEffect(() => {
    const kinds = ["bank", "khalti", "esewa"] as const;
    const urls: Partial<Record<"bank" | "khalti" | "esewa", string | null>> = {};
    const revoke: string[] = [];
    for (const kind of kinds) {
      const file = qrFiles[kind];
      if (file) {
        const url = URL.createObjectURL(file);
        urls[kind] = url;
        revoke.push(url);
      } else {
        urls[kind] = null;
      }
    }
    setQrPreviews(urls);
    return () => {
      for (const url of revoke) URL.revokeObjectURL(url);
    };
  }, [qrFiles]);

  useEffect(() => {
    const urls: Record<string, string | null> = {};
    const revoke: string[] = [];
    for (const [id, file] of Object.entries(accountQrFiles)) {
      if (file) {
        const url = URL.createObjectURL(file);
        urls[id] = url;
        revoke.push(url);
      } else {
        urls[id] = null;
      }
    }
    setAccountQrPreviews(urls);
    return () => {
      for (const url of revoke) URL.revokeObjectURL(url);
    };
  }, [accountQrFiles]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: FormData | Record<string, unknown>) =>
      apiClient.adminUpdateSettings(payload),
    onSuccess: () => {
      toast.success("Settings saved — changes apply across the system");
      setQrFiles({});
      setAccountQrFiles({});
      setLogoFile(null);
      setApkFile(null);
      invalidate();
    },
    onError: (err) => {
      errorPopup.showError(err, { title: "Save failed", fallback: "Save failed" });
    },
  });

  const testHimalpayMutation = useMutation({
    mutationFn: () => apiClient.adminHimalpayStatus(),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "himalpay-status"], data);
      if (data.ok) {
        toast.success(data.message || "HimalPay connected");
      } else {
        errorPopup.showMessage(data.message || "HimalPay connection failed", {
          title: "HimalPay connection",
        });
      }
    },
    onError: (err) => {
      errorPopup.showError(err, {
        title: "HimalPay connection failed",
        fallback: "Could not reach HimalPay",
      });
    },
  });

  const testSmtpMutation = useMutation({
    mutationFn: () => {
      const smtp = config.smtp ?? DEFAULT_CONFIG.smtp!;
      const password =
        smtpPasswordTouched &&
        smtp.smtp_password &&
        smtp.smtp_password !== "••••••••"
          ? smtp.smtp_password
          : undefined;
      const payload: Parameters<typeof apiClient.adminTestSmtpEmail>[0] = {
        to_email: smtpTestEmail.trim(),
        host: smtp.host,
        port: Number(smtp.port) || 587,
        encryption: smtp.encryption,
        smtp_email: smtp.smtp_email,
        smtp_email_from: smtp.smtp_email_from,
        smtp_name: smtp.smtp_name,
        username: smtp.smtp_email,
        from_name: smtp.smtp_name,
        from_email: smtp.smtp_email_from,
      };
      if (password) {
        payload.smtp_password = password;
        payload.password = password;
      }
      return apiClient.adminTestSmtpEmail(payload);
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(data.message || "Test email sent");
      } else {
        errorPopup.showMessage(data.message || "Test email failed", {
          title: "SMTP test",
        });
      }
    },
    onError: (err) => {
      const message =
        err instanceof ApiError
          ? err.message
          : "Could not send test email";
      errorPopup.showError(err, {
        title: "SMTP test failed",
        fallback: message,
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: (format: "xlsx" | "csv" | "sql") => apiClient.adminExportAllData(format),
    onSuccess: (data) => {
      toast.success(`Download started: ${data.filename}`);
    },
    onError: (err) => {
      errorPopup.showError(err, {
        title: "Export failed",
        fallback: "Could not export data",
      });
    },
  });

  const saveConfigSection = <K extends keyof AppConfig>(section: K, values: AppConfig[K]) => {
    saveMutation.mutate({ config: { [section]: values } });
  };

  const saveSmtp = () => {
    const smtp = config.smtp ?? DEFAULT_CONFIG.smtp!;
    const payload: AppConfig["smtp"] = {
      enabled: smtp.enabled,
      host: smtp.host,
      port: Number(smtp.port) || 587,
      encryption: smtp.encryption,
      smtp_email: smtp.smtp_email,
      smtp_password: "",
      smtp_email_from: smtp.smtp_email_from,
      smtp_name: smtp.smtp_name,
      username: smtp.smtp_email,
      password: "",
      from_email: smtp.smtp_email_from,
      from_name: smtp.smtp_name,
    };
    if (
      smtpPasswordTouched &&
      smtp.smtp_password &&
      smtp.smtp_password !== "••••••••"
    ) {
      payload.smtp_password = smtp.smtp_password;
      payload.password = smtp.smtp_password;
    }
    saveConfigSection("smtp", payload);
  };

  const saveGeneral = () => {
    if (logoFile) {
      const fd = new FormData();
      fd.append("config", JSON.stringify({ site: config.site }));
      fd.append("logo", logoFile);
      saveMutation.mutate(fd);
      return;
    }
    saveConfigSection("site", config.site);
  };

  const saveMobileApp = () => {
    const fd = new FormData();
    fd.append("auto_update_enabled", autoUpdateEnabled ? "true" : "false");
    fd.append("app_version", appVersion.trim());
    if (apkFile) fd.append("apk", apkFile);
    saveMutation.mutate(fd);
  };

  const clearApk = () => {
    const fd = new FormData();
    fd.append("clear_apk", "1");
    saveMutation.mutate(fd);
  };

  const updateAccount = (id: string, patch: Partial<PaymentAccount>) => {
    setAccounts((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const addAccount = (method: PaymentMethod) => {
    setAccounts((list) => [...list, emptyPaymentAccount(method)]);
  };

  const removeAccount = (id: string) => {
    setAccounts((list) => list.filter((a) => a.id !== id));
    setAccountQrFiles((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  /**
   * Save one deposit method independently: replace that method's accounts on the server
   * while keeping every other method as last saved (not the in-progress form values).
   * Also uploads any selected per-account QR images for this method.
   */
  const saveMethodAccounts = (method: PaymentMethod) => {
    const serverAccounts = normalizePaymentAccounts(settingsQuery.data?.bank_details);
    const methodAccounts = accounts.filter((a) => a.method === method);
    const merged = [
      ...serverAccounts.filter((a) => a.method !== method),
      ...methodAccounts,
    ];
    const fd = new FormData();
    fd.append("bank_details", JSON.stringify(paymentAccountsToBankDetails(merged)));
    for (const acc of methodAccounts) {
      const file = accountQrFiles[acc.id];
      if (file) {
        fd.append(accountQrUploadKey(acc.id), file);
      }
    }
    saveMutation.mutate(fd);
  };

  const clearAccountQr = (accountId: string) => {
    const fd = new FormData();
    fd.append(accountQrClearKey(accountId), "true");
    saveMutation.mutate(fd, {
      onSuccess: () => {
        setAccounts((list) =>
          list.map((a) =>
            a.id === accountId ? { ...a, qr_code: "", qr_code_url: null } : a,
          ),
        );
      },
    });
  };

  const saveHimalpay = () => {
    const portalPassword = config.integrations?.himalpay_portal_password ?? "";
    saveConfigSection("integrations", {
      himalpay_api_key: config.integrations?.himalpay_api_key ?? "",
      himalpay_base_url:
        config.integrations?.himalpay_base_url ||
        DEFAULT_CONFIG.integrations!.himalpay_base_url,
      himalpay_portal_phone: config.integrations?.himalpay_portal_phone ?? "",
      himalpay_portal_email: config.integrations?.himalpay_portal_email ?? "",
      ...(portalPassword && portalPassword !== "••••••••"
        ? { himalpay_portal_password: portalPassword }
        : {}),
    });
  };

  const QR_UPLOAD_FIELDS = {
    bank: {
      fileKey: "qr_code",
      clearKey: "clear_qr",
      label: "Bank QR",
      pathKey: "qr_code" as const,
      urlKey: "qr_code_url" as const,
    },
    khalti: {
      fileKey: "khalti_qr_code",
      clearKey: "clear_khalti_qr",
      label: "Khalti QR",
      pathKey: "khalti_qr_code" as const,
      urlKey: "khalti_qr_code_url" as const,
    },
    esewa: {
      fileKey: "esewa_qr_code",
      clearKey: "clear_esewa_qr",
      label: "eSewa QR",
      pathKey: "esewa_qr_code" as const,
      urlKey: "esewa_qr_code_url" as const,
    },
  } as const;

  const saveQrCode = (kind: "bank" | "khalti" | "esewa") => {
    const file = qrFiles[kind];
    if (!file) {
      toast.error("Choose a QR image first");
      return;
    }
    const fd = new FormData();
    fd.append(QR_UPLOAD_FIELDS[kind].fileKey, file);
    saveMutation.mutate(fd);
  };

  const clearQrCode = (kind: "bank" | "khalti" | "esewa") => {
    const fd = new FormData();
    fd.append(QR_UPLOAD_FIELDS[kind].clearKey, "true");
    saveMutation.mutate(fd);
  };

  const brandingSrc = logoPreview || settingsQuery.data?.logo_url || null;

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
      {errorPopup.popup}
      {settingsQuery.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          Could not load settings. Refresh the page or try again.
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as SectionId)} className="space-y-4">
          <div className="-mx-1 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:overflow-visible">
            <TabsList className="inline-flex h-auto min-w-full w-max justify-start gap-1 bg-muted/80 p-1.5 md:flex md:w-full md:flex-wrap">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger key={id} value={id} className="shrink-0 gap-1.5 px-3 py-2">
                  <Icon className="size-3.5 shrink-0" />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="site">
            <div className="space-y-4">
              <SettingsPanel
                title="General information"
                description="Brand and contact details shown across the application."
                onSave={saveGeneral}
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

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-surface p-5">
                  <h2 className="text-base font-semibold">Logo</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Upload the brand logo used across the site. The same image is also used as the
                    favicon.
                  </p>
                  <div className="mt-4 flex aspect-square max-h-48 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted">
                    {brandingSrc ? (
                      <img
                        src={brandingSrc}
                        alt="Site logo preview"
                        className="size-full object-contain p-3"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <ImageIcon className="size-12" />
                        <span className="text-xs">No logo uploaded</span>
                      </div>
                    )}
                  </div>
                  {logoFile ? (
                    <p className="mt-3 truncate text-xs font-medium text-brand">
                      New file selected: {logoFile.name}
                    </p>
                  ) : (
                    <p className="mt-3 truncate text-xs text-muted-foreground">
                      {settingsQuery.data?.logo || "No logo on file"}
                    </p>
                  )}
                  <label className="mt-3 block">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="sr-only"
                      onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
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
                      {logoFile ? "Choose a different image" : "Upload logo"}
                    </Button>
                  </label>
                  <div className="mt-2 flex flex-col gap-2">
                    <Button
                      type="button"
                      className="w-full gap-1.5"
                      disabled={saving || (!logoFile && !Object.values(config.site).some(Boolean))}
                      onClick={saveGeneral}
                    >
                      <Save className="size-3.5" />
                      {saving ? "Saving…" : logoFile ? "Save logo & info" : "Save changes"}
                    </Button>
                    {settingsQuery.data?.logo_url && !logoFile ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        disabled={saving}
                        onClick={() => {
                          const fd = new FormData();
                          fd.append("clear_logo", "true");
                          saveMutation.mutate(fd);
                        }}
                      >
                        Remove logo
                      </Button>
                    ) : null}
                    {logoFile ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full"
                        disabled={saving}
                        onClick={() => setLogoFile(null)}
                      >
                        Cancel selection
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface p-5">
                  <h2 className="text-base font-semibold">Favicon</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Automatically uses the uploaded logo. No separate favicon upload is required.
                  </p>
                  <div className="mt-4 flex aspect-square max-h-48 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted">
                    {brandingSrc ? (
                      <div className="flex flex-col items-center gap-3 p-4">
                        <img
                          src={brandingSrc}
                          alt="Favicon preview"
                          className="size-16 rounded-md object-contain shadow-sm"
                        />
                        <img
                          src={brandingSrc}
                          alt=""
                          className="size-8 rounded object-contain"
                          aria-hidden
                        />
                        <span className="text-xs text-muted-foreground">Browser tab sizes</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <ImageIcon className="size-12" />
                        <span className="text-xs">Upload a logo to preview</span>
                      </div>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {brandingSrc
                      ? "Same image as the logo — shown in browser tabs and bookmarks."
                      : "Favicon updates automatically when you upload a logo."}
                  </p>
                </div>
              </div>
            </div>
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
                  label="Manual Wallet Load"
                  description="ON allows users to fund their wallet via deposit (user deposit load). OFF disables wallet funding requests."
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
                <ToggleRow
                  label="Remittance payouts"
                  description="Allow Samsara remittance lookup and wallet credit"
                  checked={config.payment.remittances_enabled !== false}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      payment: { ...c.payment, remittances_enabled: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Internet bill payments"
                  description="Allow ISP bill inquiry and payment (Worldlink, Vianet, etc.)"
                  checked={config.payment.internet_bills_enabled !== false}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      payment: { ...c.payment, internet_bills_enabled: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Data pack top-ups"
                  description="Allow NTC / NCELL mobile data pack purchases"
                  checked={config.payment.data_packs_enabled !== false}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      payment: { ...c.payment, data_packs_enabled: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Water bill payments (KUKL)"
                  description="Allow Khane Pani / KUKL water bill inquiry and payment"
                  checked={config.payment.water_bills_enabled !== false}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      payment: { ...c.payment, water_bills_enabled: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Electricity bill payments (NEA)"
                  description="Allow NEA electricity bill inquiry and payment"
                  checked={config.payment.electricity_bills_enabled !== false}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      payment: { ...c.payment, electricity_bills_enabled: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Community electricity"
                  description="Allow Himchuli, Watermark, Dreamer, Softlab and BPC payments"
                  checked={config.payment.community_electricity_enabled !== false}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      payment: { ...c.payment, community_electricity_enabled: v },
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
              description="Limits, charges and cashback for top-ups and fund transfers."
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

              <div className="mt-5 space-y-3">
                <ToggleRow
                  label="Transfer charge"
                  description="Apply transfer charges when enabled and a charge amount is configured"
                  checked={config.transactions.transfer_charge_enabled !== false}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      transactions: { ...c.transactions, transfer_charge_enabled: v },
                    }))
                  }
                />
                <div className="grid gap-4 sm:grid-cols-2">
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
                </div>
                <ToggleRow
                  label="Cashback"
                  description="Apply cashback when enabled; uses configured amounts or provider cashback"
                  checked={config.transactions.cashback_enabled !== false}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      transactions: { ...c.transactions, cashback_enabled: v },
                    }))
                  }
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    id="transfer_cashback_flat"
                    label="Transfer cashback (Rs.)"
                    value={config.transactions.transfer_cashback_flat ?? 0}
                    onChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        transactions: { ...c.transactions, transfer_cashback_flat: v },
                      }))
                    }
                  />
                  <NumberField
                    id="transfer_cashback_percent"
                    label="Transfer cashback (%)"
                    value={config.transactions.transfer_cashback_percent ?? 0}
                    step="0.01"
                    onChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        transactions: { ...c.transactions, transfer_cashback_percent: v },
                      }))
                    }
                  />
                </div>
                <ToggleRow
                  label="Auto Status Verified"
                  description="When enabled, top-ups/transfers/bills finalize as success automatically. Manual deposits always stay pending for Super Admin approval. When disabled, top-ups and transfers also stay pending until an admin updates status."
                  checked={config.transactions.auto_status_verified === true}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      transactions: { ...c.transactions, auto_status_verified: v },
                    }))
                  }
                />
              </div>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="commission">
            <SettingsPanel
              title="Dealer commission & TDS"
              description="Global defaults used when a Dealer has no per-user rate. Per-dealer rates are set on the user form."
              onSave={() =>
                saveConfigSection("commission", config.commission ?? DEFAULT_CONFIG.commission!)
              }
              saving={saving}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  id="default_commission_rate"
                  label="Default commission rate (%)"
                  value={config.commission?.default_commission_rate ?? 0}
                  step="0.01"
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      commission: {
                        ...(c.commission ?? DEFAULT_CONFIG.commission!),
                        default_commission_rate: v,
                      },
                    }))
                  }
                />
                <NumberField
                  id="default_tds_rate"
                  label="Default TDS rate (%)"
                  value={config.commission?.default_tds_rate ?? 15}
                  step="0.01"
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      commission: {
                        ...(c.commission ?? DEFAULT_CONFIG.commission!),
                        default_tds_rate: v,
                      },
                    }))
                  }
                />
                <NumberField
                  id="default_sub_agent_rate"
                  label="Default Sub-Agent commission (%)"
                  value={config.commission?.default_sub_agent_rate ?? 0}
                  step="0.01"
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      commission: {
                        ...(c.commission ?? DEFAULT_CONFIG.commission!),
                        default_sub_agent_rate: v,
                      },
                    }))
                  }
                />
                <NumberField
                  id="default_super_admin_rate"
                  label="Default Super Admin share (%)"
                  value={config.commission?.default_super_admin_rate ?? 0}
                  step="0.01"
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      commission: {
                        ...(c.commission ?? DEFAULT_CONFIG.commission!),
                        default_super_admin_rate: v,
                      },
                    }))
                  }
                />
              </div>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="remittance">
            <SettingsPanel
              title="Remittance agent (Samsara)"
              description="Branch / agent fields sent with HimalPay SAMSARA_PAY. Customers only enter beneficiary KYC."
              onSave={() =>
                saveConfigSection("remittance", config.remittance ?? DEFAULT_CONFIG.remittance!)
              }
              saving={saving}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["payout_location_name", "Payout location name"],
                    ["payout_agent_state", "Agent state / province"],
                    ["payout_agent_district", "Agent district"],
                    ["payout_agent_municipality", "Agent municipality"],
                    ["payout_agent_ward_number", "Agent ward number"],
                    ["payout_agent_pan_number", "Agent PAN number"],
                    ["teller_contact", "Teller contact"],
                    ["payout_payment_type", "Payment type"],
                    ["payout_payment_number", "Payment number"],
                    ["payout_payment_bank_name", "Payment bank name"],
                    ["payout_payment_bank_branch", "Payment bank branch"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={key}>{label}</Label>
                    <Input
                      id={key}
                      value={config.remittance?.[key] ?? ""}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          remittance: {
                            ...(c.remittance ?? DEFAULT_CONFIG.remittance!),
                            [key]: e.target.value,
                          },
                        }))
                      }
                      className="rounded-xl"
                    />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[13px] text-muted-foreground">
                Agent PAN and teller contact are required before customers can receive remittances
                (unless HimalPay bypass mode is on).
              </p>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="deposit">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Each deposit type has its own fields and Save action. Saving bank, Khalti, or
                eSewa only updates that type — the others stay as last saved. Each account can
                have its own QR code (saved with that type). HimalPay and method-level deposit
                QR defaults also save separately. {updatedAt}
              </p>

              {DEPOSIT_METHODS.map(({ method, title, description, addLabel }) => {
                const methodAccounts = accounts.filter((a) => a.method === method);
                return (
                  <SettingsPanel
                    key={method}
                    title={title}
                    description={description}
                    onSave={() => saveMethodAccounts(method)}
                    saving={saving}
                  >
                    <div className="space-y-4">
                      {methodAccounts.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                          No {methodLabel(method)} accounts yet. Add one below.
                        </p>
                      ) : (
                        methodAccounts.map((acc, index) => (
                          <div
                            key={acc.id}
                            className="rounded-xl border border-border bg-muted/20 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <span className="text-sm font-semibold">
                                {acc.label || methodLabel(method)} #{index + 1}
                              </span>
                              <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Switch
                                    checked={acc.enabled !== false}
                                    onCheckedChange={(checked) =>
                                      updateAccount(acc.id, { enabled: checked })
                                    }
                                  />
                                  Visible
                                </label>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => removeAccount(acc.id)}
                                  aria-label={`Remove ${methodLabel(method)} account`}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label htmlFor={`label-${acc.id}`}>Display label</Label>
                                <Input
                                  id={`label-${acc.id}`}
                                  value={acc.label}
                                  onChange={(e) =>
                                    updateAccount(acc.id, { label: e.target.value })
                                  }
                                  className="rounded-xl"
                                  placeholder={methodLabel(method)}
                                />
                              </div>
                              {method === "bank" ? (
                                <div className="space-y-1.5">
                                  <Label htmlFor={`bank_name-${acc.id}`}>Bank name</Label>
                                  <Input
                                    id={`bank_name-${acc.id}`}
                                    value={acc.bank_name || ""}
                                    onChange={(e) =>
                                      updateAccount(acc.id, {
                                        bank_name: e.target.value,
                                        label:
                                          acc.label === "Bank account" || !acc.label
                                            ? e.target.value || "Bank account"
                                            : acc.label,
                                      })
                                    }
                                    className="rounded-xl"
                                  />
                                </div>
                              ) : null}
                              <div className="space-y-1.5">
                                <Label htmlFor={`account_name-${acc.id}`}>
                                  {method === "bank" ? "Account name" : "Account holder"}
                                </Label>
                                <Input
                                  id={`account_name-${acc.id}`}
                                  value={acc.account_name || ""}
                                  onChange={(e) =>
                                    updateAccount(acc.id, { account_name: e.target.value })
                                  }
                                  className="rounded-xl"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor={`account_number-${acc.id}`}>
                                  {method === "khalti"
                                    ? "Khalti ID / phone"
                                    : method === "esewa"
                                      ? "eSewa ID / phone"
                                      : "Account number"}
                                </Label>
                                <Input
                                  id={`account_number-${acc.id}`}
                                  value={acc.account_number || ""}
                                  onChange={(e) =>
                                    updateAccount(acc.id, { account_number: e.target.value })
                                  }
                                  className="rounded-xl font-mono"
                                />
                              </div>
                              {method === "bank" ? (
                                <div className="space-y-1.5">
                                  <Label htmlFor={`branch-${acc.id}`}>Branch</Label>
                                  <Input
                                    id={`branch-${acc.id}`}
                                    value={acc.branch || ""}
                                    onChange={(e) =>
                                      updateAccount(acc.id, { branch: e.target.value })
                                    }
                                    className="rounded-xl"
                                  />
                                </div>
                              ) : null}
                            </div>

                            {(() => {
                              const file = accountQrFiles[acc.id] ?? null;
                              const preview = accountQrPreviews[acc.id] ?? null;
                              const savedUrl = acc.qr_code_url || null;
                              const displaySrc = preview || savedUrl;
                              return (
                                <div className="mt-4 rounded-xl border border-dashed border-border bg-surface/60 p-4">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-medium">Account QR code</p>
                                      <p className="mt-0.5 text-xs text-muted-foreground">
                                        Shown with this account on Load Wallet. Saved when you
                                        save {methodLabel(method)} accounts.
                                      </p>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
                                    <div className="flex aspect-square w-full max-w-40 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted">
                                      {displaySrc ? (
                                        <img
                                          src={displaySrc}
                                          alt={`${acc.label || methodLabel(method)} QR`}
                                          className="size-full object-contain p-2"
                                        />
                                      ) : (
                                        <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                                          <QrCode className="size-10" />
                                          <span className="text-[11px]">No QR</span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-2">
                                      {file ? (
                                        <p className="truncate text-xs font-medium text-brand">
                                          New file: {file.name}
                                        </p>
                                      ) : (
                                        <p className="truncate text-xs text-muted-foreground">
                                          {acc.qr_code || "No QR on file"}
                                        </p>
                                      )}
                                      <label className="block">
                                        <input
                                          type="file"
                                          accept="image/png,image/jpeg,image/webp,image/gif"
                                          className="sr-only"
                                          onChange={(e) => {
                                            const next = e.target.files?.[0] ?? null;
                                            setAccountQrFiles((prev) => ({
                                              ...prev,
                                              [acc.id]: next,
                                            }));
                                          }}
                                        />
                                        <Button
                                          variant="secondary"
                                          className="w-full sm:w-auto"
                                          type="button"
                                          onClick={(e) => {
                                            const input = (
                                              e.currentTarget.parentElement as HTMLLabelElement
                                            ).querySelector("input");
                                            input?.click();
                                          }}
                                        >
                                          {file ? "Choose a different image" : "Upload QR image"}
                                        </Button>
                                      </label>
                                      <div className="flex flex-wrap gap-2">
                                        {savedUrl && !file ? (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="rounded-xl"
                                            disabled={saving}
                                            onClick={() => clearAccountQr(acc.id)}
                                          >
                                            Remove QR
                                          </Button>
                                        ) : null}
                                        {file ? (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="rounded-xl"
                                            disabled={saving}
                                            onClick={() =>
                                              setAccountQrFiles((prev) => {
                                                const next = { ...prev };
                                                delete next[acc.id];
                                                return next;
                                              })
                                            }
                                          >
                                            Cancel selection
                                          </Button>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        ))
                      )}

                      <Button
                        type="button"
                        variant="outline"
                        className="gap-1.5 rounded-xl"
                        onClick={() => addAccount(method)}
                      >
                        <Plus className="size-3.5" />
                        {addLabel}
                      </Button>
                    </div>
                  </SettingsPanel>
                );
              })}

              <SettingsPanel
                title="HimalPay reseller"
                description="API key used for top-ups, account verification, and outbound bank transfers. Stored server-side only — never exposed to customers. This reseller API cannot accept bank-app QR payments into individual Mysewa wallets."
                onSave={saveHimalpay}
                saving={saving}
              >
                <div className="grid gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="himalpay_api_key">HimalPay API key</Label>
                    <PasswordInput
                      id="himalpay_api_key"
                      revealLabel="API key"
                      autoComplete="off"
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      value={config.integrations?.himalpay_api_key ?? ""}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          integrations: {
                            ...c.integrations,
                            himalpay_base_url:
                              c.integrations?.himalpay_base_url ||
                              DEFAULT_CONFIG.integrations!.himalpay_base_url,
                            himalpay_api_key: e.target.value,
                          },
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      This UUID is your API key for the X-API-Key header — it is not an IP
                      address and must not be pasted into the HimalPay IP Allowlist.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="himalpay_base_url">HimalPay base URL</Label>
                    <Input
                      id="himalpay_base_url"
                      type="url"
                      placeholder="https://api.himalpay.com.np/api/v1"
                      value={
                        config.integrations?.himalpay_base_url ||
                        DEFAULT_CONFIG.integrations!.himalpay_base_url
                      }
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          integrations: {
                            ...c.integrations,
                            himalpay_api_key: c.integrations?.himalpay_api_key ?? "",
                            himalpay_base_url: e.target.value,
                          },
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      LIVE: https://api.himalpay.com.np/api/v1 — UAT:
                      https://uatapi.himalpay.com.np/api/v1. Authenticate with header X-API-Key.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
                    <div>
                      <p className="text-sm font-medium">Portal login (LIVE statement / balance)</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        LIVE HimalPay often does not expose reseller statement/balance routes yet
                        (API key calls to /wallet/reseller-balance return 404). Optional: add the
                        HimalPay app login for this reseller account so MySewa can read float +
                        ledger via /users/me/wallet and /users/statement until HimalPay enables
                        those reseller routes on LIVE.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="himalpay_portal_phone">Portal phone</Label>
                        <Input
                          id="himalpay_portal_phone"
                          inputMode="tel"
                          autoComplete="off"
                          placeholder="98XXXXXXXX"
                          value={config.integrations?.himalpay_portal_phone ?? ""}
                          onChange={(e) =>
                            setConfig((c) => ({
                              ...c,
                              integrations: {
                                ...c.integrations!,
                                himalpay_portal_phone: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="himalpay_portal_email">Portal email</Label>
                        <Input
                          id="himalpay_portal_email"
                          type="email"
                          autoComplete="off"
                          placeholder="reseller@example.com"
                          value={config.integrations?.himalpay_portal_email ?? ""}
                          onChange={(e) =>
                            setConfig((c) => ({
                              ...c,
                              integrations: {
                                ...c.integrations!,
                                himalpay_portal_email: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="himalpay_portal_password">Portal password</Label>
                      <PasswordInput
                        id="himalpay_portal_password"
                        revealLabel="Portal password"
                        autoComplete="new-password"
                        placeholder="HimalPay login password"
                        value={config.integrations?.himalpay_portal_password ?? ""}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            integrations: {
                              ...c.integrations!,
                              himalpay_portal_password: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div
                    className={cn(
                      "rounded-xl border p-4",
                      himalpayStatusQuery.data?.ok
                        ? "border-success/30 bg-success/5"
                        : himalpayStatusQuery.data
                          ? "border-destructive/30 bg-destructive/5"
                          : "border-border bg-muted/40",
                    )}
                  >
                    <p className="text-sm font-medium">Server IP for HimalPay allowlist</p>
                    <p className="mt-1 font-mono text-[15px] font-semibold tracking-tight">
                      {himalpayStatusQuery.isLoading
                        ? "Detecting…"
                        : himalpayStatusQuery.data?.outbound_ip || "Unavailable"}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Add this public IP in the HimalPay dashboard → IP Allowlist. Production VPS
                      is typically <span className="font-mono">147.93.153.157</span>. Local
                      development uses your current public IP (changes with network).
                    </p>
                    {himalpayStatusQuery.data?.message ? (
                      <p
                        className={cn(
                          "mt-2 text-sm",
                          himalpayStatusQuery.data.ok ? "text-success" : "text-destructive",
                        )}
                      >
                        {himalpayStatusQuery.data.message}
                      </p>
                    ) : null}
                    {himalpayStatusQuery.data?.balance_message ? (
                      <p
                        className={cn(
                          "mt-2 text-sm",
                          himalpayStatusQuery.data.balance_ok
                            ? "text-success"
                            : "text-warning-foreground",
                        )}
                      >
                        Balance: {himalpayStatusQuery.data.balance_message}
                      </p>
                    ) : null}
                    {himalpayStatusQuery.data?.inbound_qr_reason ? (
                      <div className="mt-3 rounded-lg border border-border/70 bg-background/60 p-3">
                        <p className="text-sm font-medium">
                          Bank-to-wallet QR:{" "}
                          {himalpayStatusQuery.data.inbound_qr_supported
                            ? "Available"
                            : "Not available on this account"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {himalpayStatusQuery.data.inbound_qr_reason}
                        </p>
                        {himalpayStatusQuery.data.inbound_qr_hinted_services?.length ? (
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            Hinted services:{" "}
                            {himalpayStatusQuery.data.inbound_qr_hinted_services.join(", ")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3 h-10 rounded-xl"
                      disabled={testHimalpayMutation.isPending}
                      onClick={() => testHimalpayMutation.mutate()}
                    >
                      {testHimalpayMutation.isPending
                        ? "Testing…"
                        : "Test HimalPay connection"}
                    </Button>
                  </div>
                </div>
              </SettingsPanel>

              <div className="rounded-xl border border-border bg-surface p-5">
                <div className="mb-4">
                  <h2 className="text-base font-semibold">Method default QR codes</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Optional fallbacks for bank, Khalti, and eSewa when an individual account has
                    no QR of its own. Prefer uploading a QR on each account above.
                  </p>
                </div>

                <Tabs
                  value={qrTab}
                  onValueChange={(v) => setQrTab(v as "bank" | "khalti" | "esewa")}
                  className="space-y-4"
                >
                  <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-muted/80 p-1.5">
                    {(
                      [
                        ["bank", "Bank QR"],
                        ["khalti", "Khalti QR"],
                        ["esewa", "eSewa QR"],
                      ] as const
                    ).map(([value, label]) => (
                      <TabsTrigger key={value} value={value} className="px-2 py-2 text-xs sm:text-sm">
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {(
                    [
                      ["bank", "Bank QR"],
                      ["khalti", "Khalti QR"],
                      ["esewa", "eSewa QR"],
                    ] as const
                  ).map(([kind, label]) => {
                    const meta = QR_UPLOAD_FIELDS[kind];
                    const file = qrFiles[kind] ?? null;
                    const preview = qrPreviews[kind] ?? null;
                    const savedUrl = settingsQuery.data?.[meta.urlKey] ?? null;
                    const savedPath = settingsQuery.data?.[meta.pathKey] ?? null;
                    return (
                      <TabsContent key={kind} value={kind} className="mt-0 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <p className="text-sm text-muted-foreground">
                            Shown to customers as the {label} option on Load Wallet.
                          </p>
                          <Button
                            type="button"
                            disabled={saving || !file}
                            className="gap-1.5"
                            onClick={() => saveQrCode(kind)}
                          >
                            <Save className="size-3.5" />
                            {saving ? "Saving…" : `Save ${label}`}
                          </Button>
                        </div>
                        <div className="flex aspect-square max-w-xs items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted">
                          {preview || savedUrl ? (
                            <img
                              src={preview || savedUrl || ""}
                              alt={`${label} preview`}
                              className="size-full object-contain p-2"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <QrCode className="size-16" />
                              <span className="text-xs">No QR uploaded</span>
                            </div>
                          )}
                        </div>
                        {file ? (
                          <p className="truncate text-xs font-medium text-brand">
                            New file selected: {file.name}
                          </p>
                        ) : (
                          <p className="truncate text-xs text-muted-foreground">
                            {savedPath || "No QR on file"}
                          </p>
                        )}
                        <label className="block max-w-xs">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="sr-only"
                            onChange={(e) =>
                              setQrFiles((prev) => ({
                                ...prev,
                                [kind]: e.target.files?.[0] ?? null,
                              }))
                            }
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
                            {file ? "Choose a different image" : `Upload ${label} image`}
                          </Button>
                        </label>
                        <div className="flex max-w-xs flex-col gap-2">
                          {savedUrl && !file ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full"
                              disabled={saving}
                              onClick={() => clearQrCode(kind)}
                            >
                              Remove {label}
                            </Button>
                          ) : null}
                          {file ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="w-full"
                              disabled={saving}
                              onClick={() =>
                                setQrFiles((prev) => ({ ...prev, [kind]: null }))
                              }
                            >
                              Cancel selection
                            </Button>
                          ) : null}
                        </div>
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="smtp">
            <div className="space-y-4">
              <SettingsPanel
                title="SMTP email settings"
                description="Configure outbound email for OTPs, receipts, and admin alerts. Test before saving to verify delivery."
                onSave={saveSmtp}
                saving={saving}
              >
                <div className="space-y-3">
                  <ToggleRow
                    label="Enable SMTP"
                    description="Use these credentials instead of server environment defaults when sending mail"
                    checked={Boolean(config.smtp?.enabled)}
                    onCheckedChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        smtp: { ...(c.smtp ?? DEFAULT_CONFIG.smtp!), enabled: v },
                      }))
                    }
                  />
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field
                    id="smtp_host"
                    label="SMTP host"
                    value={config.smtp?.host ?? ""}
                    onChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        smtp: { ...(c.smtp ?? DEFAULT_CONFIG.smtp!), host: v },
                      }))
                    }
                  />
                  <NumberField
                    id="smtp_port"
                    label="Port"
                    value={Number(config.smtp?.port ?? 587)}
                    onChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        smtp: { ...(c.smtp ?? DEFAULT_CONFIG.smtp!), port: v },
                      }))
                    }
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp_encryption">Encryption</Label>
                    <select
                      id="smtp_encryption"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={config.smtp?.encryption ?? "tls"}
                      onChange={(e) => {
                        const encryption = e.target.value as "tls" | "ssl" | "none";
                        const port =
                          encryption === "ssl"
                            ? 465
                            : encryption === "tls"
                              ? 587
                              : config.smtp?.port ?? 25;
                        setConfig((c) => ({
                          ...c,
                          smtp: {
                            ...(c.smtp ?? DEFAULT_CONFIG.smtp!),
                            encryption,
                            port,
                          },
                        }));
                      }}
                    >
                      <option value="tls">TLS (STARTTLS, port 587)</option>
                      <option value="ssl">SSL (port 465)</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                  <Field
                    id="smtp_name"
                    label="smtp_name (sender name)"
                    value={config.smtp?.smtp_name ?? config.smtp?.from_name ?? ""}
                    onChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        smtp: {
                          ...(c.smtp ?? DEFAULT_CONFIG.smtp!),
                          smtp_name: v,
                          from_name: v,
                        },
                      }))
                    }
                  />
                  <Field
                    id="smtp_email_from"
                    label="smtp_email_from (from address)"
                    type="email"
                    value={config.smtp?.smtp_email_from ?? config.smtp?.from_email ?? ""}
                    onChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        smtp: {
                          ...(c.smtp ?? DEFAULT_CONFIG.smtp!),
                          smtp_email_from: v,
                          from_email: v,
                        },
                      }))
                    }
                  />
                  <Field
                    id="smtp_email"
                    label="smtp_email (username)"
                    type="email"
                    value={config.smtp?.smtp_email ?? config.smtp?.username ?? ""}
                    onChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        smtp: {
                          ...(c.smtp ?? DEFAULT_CONFIG.smtp!),
                          smtp_email: v,
                          username: v,
                        },
                      }))
                    }
                  />
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="smtp_password">smtp_password</Label>
                    <PasswordInput
                      id="smtp_password"
                      value={
                        smtpPasswordTouched
                          ? config.smtp?.smtp_password ?? ""
                          : config.smtp?.password_set
                            ? "••••••••"
                            : config.smtp?.smtp_password ?? ""
                      }
                      onChange={(e) => {
                        setSmtpPasswordTouched(true);
                        setConfig((c) => ({
                          ...c,
                          smtp: {
                            ...(c.smtp ?? DEFAULT_CONFIG.smtp!),
                            smtp_password: e.target.value,
                            password: e.target.value,
                          },
                        }));
                      }}
                      placeholder={
                        config.smtp?.password_set
                          ? "Leave unchanged to keep current password"
                          : "Gmail app password"
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Stored in Settings.config.smtp. Leave blank when saving to keep the
                      existing password. Fallback Gmail credentials are used until you override.
                    </p>
                  </div>
                </div>
              </SettingsPanel>

              <div className="rounded-xl border border-border bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Test Mail</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Send a small test message with the form values above (works before save).
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="gap-1.5"
                    disabled={testSmtpMutation.isPending || !smtpTestEmail.trim()}
                    onClick={() => testSmtpMutation.mutate()}
                  >
                    <Send className="size-3.5" />
                    {testSmtpMutation.isPending ? "Sending…" : "Test Mail"}
                  </Button>
                </div>
                <div className="mt-4 max-w-md">
                  <Field
                    id="smtp_test_email"
                    label="Test recipient"
                    type="email"
                    value={smtpTestEmail}
                    onChange={setSmtpTestEmail}
                  />
                </div>
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
                  label="Email on wallet credit"
                  description="Email customers when their wallet is credited (deposits, remittance)"
                  checked={config.notifications.email_on_wallet_credit}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      notifications: { ...c.notifications, email_on_wallet_credit: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Email on wallet debit"
                  description="Email customers for wallet debits (data packs, internet bills, withdrawals)"
                  checked={config.notifications.email_on_wallet_debit}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      notifications: { ...c.notifications, email_on_wallet_debit: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Email on bank transfer"
                  description="Email customers after a successful bank transfer"
                  checked={config.notifications.email_on_transfer}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      notifications: { ...c.notifications, email_on_transfer: v },
                    }))
                  }
                />
                <ToggleRow
                  label="Email on wallet adjustment"
                  description="Email customers when an admin changes their wallet balance"
                  checked={config.notifications.email_on_wallet_adjustment}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      notifications: { ...c.notifications, email_on_wallet_adjustment: v },
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
                <div className="space-y-1.5">
                  <Field
                    id="admin_alert_email"
                    label="Super Admin email"
                    type="email"
                    value={config.notifications.admin_alert_email}
                    onChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        notifications: { ...c.notifications, admin_alert_email: v },
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Receives a copy of every email the system sends to users
                    (transactions, verification codes, and other notifications).
                    If empty, active Super Admin account emails are used.
                  </p>
                </div>
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
                  label="OTP login verification"
                  description="Require email/SMS OTP after password login. When off, users sign in with password only."
                  checked={config.security.otp_login_enabled !== false}
                  onCheckedChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      security: { ...c.security, otp_login_enabled: v },
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

          <TabsContent value="mobile">
            <SettingsPanel
              title="Android auto update"
              description="When enabled, the Flutter app compares its local version with this APK version. If they differ, it downloads the APK and installs it automatically."
              onSave={saveMobileApp}
              saving={saving}
            >
              <div className="space-y-5">
                <ToggleRow
                  label="Enable auto update"
                  description="Turn this on after uploading a new APK and setting the matching version. Turn it off to leave installed apps as they are."
                  checked={autoUpdateEnabled}
                  onCheckedChange={setAutoUpdateEnabled}
                />
                <div className="space-y-2">
                  <Label htmlFor="app_version">APK version</Label>
                  <Input
                    id="app_version"
                    value={appVersion}
                    onChange={(e) => setAppVersion(e.target.value)}
                    placeholder="e.g. 2.0.1"
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Must match <code className="rounded bg-muted px-1 py-0.5">AppConstant.appVersion</code>{" "}
                    in the Flutter build you upload. Installed apps whose version does not match
                    this value will download and install the APK.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apk_file">APK file</Label>
                  <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4">
                    <input
                      id="apk_file"
                      type="file"
                      accept=".apk,application/vnd.android.package-archive"
                      className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                      onChange={(e) => setApkFile(e.target.files?.[0] ?? null)}
                    />
                    {apkFile ? (
                      <p className="mt-3 truncate text-xs font-medium text-brand">
                        New file selected: {apkFile.name} ({Math.round(apkFile.size / (1024 * 1024))} MB)
                      </p>
                    ) : settingsQuery.data?.apk_url ? (
                      <p className="mt-3 truncate text-xs text-muted-foreground">
                        Current APK: {settingsQuery.data.apk || "uploaded"}
                      </p>
                    ) : (
                      <p className="mt-3 text-xs text-muted-foreground">No APK uploaded yet.</p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Upload a release APK (typically 30–80 MB). Max upload size is 100 MB.
                  </p>
                  {autoUpdateEnabled && (!appVersion.trim() || (!apkFile && !settingsQuery.data?.apk_url)) ? (
                    <p className="text-xs text-amber-600">
                      Auto update is on, but a version and APK are both required before the app
                      can update.
                    </p>
                  ) : null}
                  {settingsQuery.data?.apk_url && !apkFile ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" asChild>
                        <a href={settingsQuery.data.apk_url} download>
                          Download current APK
                        </a>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-1.5 text-destructive"
                        disabled={saving}
                        onClick={clearApk}
                      >
                        <Trash2 className="size-3.5" />
                        Remove APK
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </SettingsPanel>
          </TabsContent>

          <TabsContent value="export">
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold">Export all data</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Download every database table (users, wallets, deposits, bills, settings, and
                  Django system tables). Files include password hashes, API tokens, and SMTP
                  secrets — store them privately. {updatedAt}
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {(
                  [
                    {
                      format: "xlsx" as const,
                      title: "Excel (.xlsx)",
                      description:
                        "One workbook with a sheet per table. Opens in Microsoft Excel, Google Sheets, and LibreOffice.",
                      icon: FileSpreadsheet,
                      button: "Download Excel",
                    },
                    {
                      format: "csv" as const,
                      title: "CSV (.zip)",
                      description:
                        "A zip of UTF-8 CSV files, one per table. Import each file into Excel or another tool.",
                      icon: FileArchive,
                      button: "Download CSV zip",
                    },
                    {
                      format: "sql" as const,
                      title: "MySQL / phpMyAdmin (.sql)",
                      description:
                        "Full SQL dump for phpMyAdmin Import (format: SQL). Includes CREATE TABLE and INSERT statements.",
                      icon: FileCode2,
                      button: "Download SQL dump",
                    },
                  ] as const
                ).map(({ format, title, description, icon: Icon, button }) => {
                  const busy = exportMutation.isPending && exportMutation.variables === format;
                  return (
                    <div
                      key={format}
                      className="flex flex-col rounded-xl border border-border bg-surface p-5"
                    >
                      <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                        <Icon className="size-5 text-foreground" />
                      </div>
                      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
                      <p className="mt-1 flex-1 text-sm text-muted-foreground">{description}</p>
                      <Button
                        type="button"
                        className="mt-4 w-full gap-1.5"
                        disabled={exportMutation.isPending}
                        onClick={() => exportMutation.mutate(format)}
                      >
                        <Icon className="size-3.5" />
                        {busy ? "Preparing…" : button}
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">phpMyAdmin import</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>Download the MySQL / phpMyAdmin (.sql) file.</li>
                  <li>Open phpMyAdmin and select the destination database.</li>
                  <li>Go to the Import tab, choose the .sql file, and keep format as SQL.</li>
                  <li>Click Go. The dump uses utf8mb4 and turns foreign key checks off during import.</li>
                </ol>
              </div>
            </div>
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
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "text-xs font-medium tabular-nums",
            checked ? "text-foreground" : "text-muted-foreground",
          )}
          aria-hidden
        >
          {checked ? "ON" : "OFF"}
        </span>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-label={`${label}: ${checked ? "ON" : "OFF"}`}
        />
      </div>
    </div>
  );
}
