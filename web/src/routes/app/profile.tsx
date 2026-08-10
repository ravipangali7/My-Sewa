import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import {
  Cake,
  Camera,
  ChevronRight,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { DateOfBirthDisplay } from "@/components/DateOfBirthField";
import { KycVerifiedBadge } from "@/components/IdentityLockedBanner";
import { UserShell } from "@/components/layout/UserShell";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { isAccountActive } from "@/lib/account-status";
import { isIdentityLocked } from "@/lib/kyc-lock";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
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

export const Route = createFileRoute("/app/profile")({
  head: () => ({
    meta: [
      { title: "Profile & Security — MySewa" },
      {
        name: "description",
        content:
          "Manage your MySewa account: profile details, phone number, password and wallet information.",
      },
      { property: "og:title", content: "Profile & Security — MySewa" },
      { property: "og:description", content: "Account, security and wallet settings." },
    ],
  }),
  component: Profile,
});

function Profile() {
  const t = useT();
  const navigate = useNavigate();
  const { user, logout, refreshProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (!user) {
    return (
      <UserShell title={t("profile.title")} hideHeader>
        <div className="flex min-h-[50vh] items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">{t("profile.loading")}</p>
        </div>
      </UserShell>
    );
  }

  const legalName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || t("profile.fallbackName");
  const displayName = (user.nickname || "").trim() || legalName;
  const initialsSource = (user.nickname || "").trim() || legalName;
  const initials =
    initialsSource
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || user.phone.slice(0, 2);
  const accountActive = isAccountActive(user);
  const identityLocked = isIdentityLocked(user);
  const citizenship = (user.citizenship_number || "").trim();

  const handleAvatarChange = async (file: File | null) => {
    if (!file) return;
    setSavingAvatar(true);
    try {
      const fd = new FormData();
      fd.append("avatar", file);
      await apiClient.updateProfile(fd);
      await refreshProfile();
      toast.success(t("profile.photoUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("profile.photoFailed"));
    } finally {
      setSavingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate({ to: "/" });
    } finally {
      setLoggingOut(false);
    }
  };

  const confirmDeleteAccount = async () => {
    if (!user) return;
    if (!deletePassword.trim()) {
      toast.error(t("profile.deletePasswordRequired"));
      return;
    }
    setDeletingAccount(true);
    try {
      await apiClient.deleteAccount(user.phone, deletePassword);
      toast.success(t("profile.deleteSuccess"));
      setDeleteDialogOpen(false);
      setDeletePassword("");
      await logout();
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("profile.deleteFailed"));
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <UserShell title={t("profile.title")} hideHeader>
      <div className="min-w-0 max-w-full overflow-x-clip bg-[#F2F4F7] lg:min-h-0 lg:rounded-2xl lg:overflow-hidden">
        <section className="relative bg-[linear-gradient(105deg,#04275C_0%,#0A3D7A_32%,#0C6B7A_68%,#0A9B6E_100%)] px-4 pb-8 pt-[max(14px,env(safe-area-inset-top))]">
          <h1 className="text-[20px] font-medium tracking-tight text-white">{t("profile.title")}</h1>

          <div className="mt-5 flex flex-col items-center">
            <div className="relative">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="size-[108px] rounded-full object-cover shadow-[0_8px_24px_rgba(0,0,0,0.22)] ring-[3px] ring-white"
                />
              ) : (
                <div className="flex size-[108px] items-center justify-center rounded-full bg-white/20 text-[34px] font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.22)] ring-[3px] ring-white">
                  {initials}
                </div>
              )}
              <span
                aria-label={accountActive ? t("account.active") : t("account.pendingShort")}
                title={accountActive ? t("account.activeLabel") : t("account.pendingLabel")}
                className={cn(
                  "absolute left-1.5 top-1.5 size-3.5 rounded-full ring-2 ring-white",
                  accountActive ? "bg-[#22C55E]" : "bg-[#EAB308]",
                )}
              />
              <button
                type="button"
                aria-label={t("profile.changePhoto")}
                disabled={savingAvatar}
                className="absolute bottom-0.5 right-0.5 flex size-8 items-center justify-center rounded-full bg-[#22C55E] text-white shadow-md ring-2 ring-white disabled:opacity-60"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="size-3.5" strokeWidth={2.25} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleAvatarChange(e.target.files?.[0] ?? null)}
              />
            </div>
            <p className="mt-3.5 text-center text-[22px] font-bold tracking-tight text-white">
              {displayName}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-medium text-white/95 ring-1 ring-white/20">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    accountActive ? "bg-[#22C55E]" : "bg-[#EAB308]",
                  )}
                  aria-hidden
                />
                {accountActive ? t("account.activeLabel") : t("account.pendingLabel")}
              </p>
              {identityLocked ? <KycVerifiedBadge className="bg-white/95 ring-white/40" /> : null}
            </div>
          </div>
        </section>

        <div className="space-y-5 px-4 pb-4 pt-4">
          <div className="space-y-2.5">
            <div className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#1D4ED8]">
                <Phone className="size-[18px]" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-[#8A94A6]">{t("profile.phoneNumber")}</p>
                <p className="truncate text-[16px] font-semibold text-[#0F172A]">{user.phone}</p>
              </div>
              <Link
                to="/app/profile/phone"
                className="shrink-0 px-1 text-[15px] font-semibold text-[#2563EB]"
              >
                {t("profile.change")}
              </Link>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#1D4ED8]">
                <Mail className="size-[18px]" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-[#8A94A6]">{t("profile.email")}</p>
                <p className="truncate text-[16px] font-semibold text-[#0F172A]">
                  {(user.email || "").trim() || t("profile.emailEmpty")}
                </p>
              </div>
              <Link
                to="/app/profile/email"
                className="shrink-0 px-1 text-[15px] font-semibold text-[#2563EB]"
              >
                {t("profile.change")}
              </Link>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#1D4ED8]">
                <Cake className="size-[18px]" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-[#8A94A6]">{t("profile.dateOfBirth")}</p>
                <p className="truncate text-[16px] font-semibold text-[#0F172A]">
                  <DateOfBirthDisplay value={user.date_of_birth} />
                </p>
              </div>
              {identityLocked ? (
                <span
                  className="shrink-0 px-1 text-[13px] font-semibold text-[#64748B]"
                  title={t("profile.identityLockedTitle")}
                >
                  {t("profile.kycVerified")}
                </span>
              ) : (
                <Link
                  to="/app/profile/edit"
                  className="shrink-0 px-1 text-[15px] font-semibold text-[#2563EB]"
                >
                  {user.date_of_birth ? t("profile.change") : t("profile.editProfile")}
                </Link>
              )}
            </div>
          </div>

          {identityLocked ? (
            <section>
              <h2 className="mb-2 px-0.5 text-[12px] font-bold tracking-[0.06em] text-[#8A94A6]">
                {t("profile.identitySection")}
              </h2>
              <div className="rounded-2xl bg-white p-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)]">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#ECFDF5] text-[#15803D]">
                    <ShieldCheck className="size-[18px]" strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[16px] font-semibold text-[#0F172A]">
                        {t("profile.identityLockedTitle")}
                      </p>
                      <KycVerifiedBadge />
                    </div>
                    <p className="text-[13px] text-[#64748B]">{t("profile.identityLockedBody")}</p>
                    <dl className="space-y-2 border-t border-[#F1F5F9] pt-2.5 text-[14px]">
                      <IdentityFact label={t("profile.fullName")} value={legalName} />
                      {(user.nickname || "").trim() ? (
                        <IdentityFact label={t("profile.nickname")} value={user.nickname!} />
                      ) : null}
                      {(user.business_name || "").trim() ? (
                        <IdentityFact
                          label={t("profile.businessName")}
                          value={user.business_name!}
                        />
                      ) : null}
                      <IdentityFact
                        label={t("profile.dateOfBirth")}
                        value={<DateOfBirthDisplay value={user.date_of_birth} />}
                      />
                      <IdentityFact
                        label={t("profile.citizenshipNumber")}
                        value={citizenship || t("profile.citizenshipEmpty")}
                      />
                    </dl>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="mb-2 px-0.5 text-[12px] font-bold tracking-[0.06em] text-[#8A94A6]">
              {t("profile.account")}
            </h2>
            <div className="space-y-2.5">
              <SettingsRow
                to="/app/profile/edit"
                icon={UserRound}
                title={t("profile.editProfile")}
                subtitle={
                  identityLocked ? t("profile.editSubtitleLocked") : t("profile.editSubtitle")
                }
              />
              <SettingsRow
                to="/app/profile/kyc"
                icon={ShieldCheck}
                title={t("profile.kyc")}
                subtitle={
                  identityLocked ? t("profile.kycVerified") : t("profile.kycSubtitle")
                }
              />
            </div>
          </section>

          <section>
            <h2 className="mb-2 px-0.5 text-[12px] font-bold tracking-[0.06em] text-[#8A94A6]">
              {t("profile.security")}
            </h2>
            <div className="space-y-2.5">
              <SettingsRow
                to="/app/profile/password"
                icon={Lock}
                title={t("profile.changePassword")}
                subtitle={t("profile.passwordSubtitle")}
              />
              <SettingsRow
                to="/app/profile/pin"
                icon={KeyRound}
                title={
                  user.has_transaction_pin
                    ? t("pin.changeTitle")
                    : t("profile.transactionPin")
                }
                subtitle={
                  user.has_transaction_pin
                    ? t("profile.pinChangeSubtitle")
                    : t("profile.pinSubtitle")
                }
              />
            </div>
          </section>

          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={(open) => {
              setDeleteDialogOpen(open);
              if (!open) setDeletePassword("");
            }}
          >
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#F87171]/70 bg-white px-4 py-3.5 text-[16px] font-semibold text-[#EF4444] transition-colors hover:bg-[#FEF2F2]"
              >
                <Trash2 className="size-[18px]" strokeWidth={2} />
                {t("profile.deleteAccount")}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("profile.deleteConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("profile.deleteConfirmBody")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-1.5 py-1">
                <Label htmlFor="delete_account_password">{t("profile.deletePasswordLabel")}</Label>
                <PasswordInput
                  id="delete_account_password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoComplete="current-password"
                  className="h-11 rounded-xl"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deletingAccount}>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deletingAccount}
                  onClick={(e) => {
                    e.preventDefault();
                    void confirmDeleteAccount();
                  }}
                >
                  {deletingAccount ? t("profile.deletingAccount") : t("profile.deleteAccount")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#F87171]/70 bg-[#FEF2F2] px-4 py-3.5 text-[16px] font-semibold text-[#EF4444] transition-colors hover:bg-[#FEE2E2]"
              >
                <LogOut className="size-[18px]" strokeWidth={2} />
                {t("profile.logout")}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("profile.logoutConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("profile.logoutConfirmBody")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={loggingOut}>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={loggingOut}
                  onClick={(e) => {
                    e.preventDefault();
                    void confirmLogout();
                  }}
                >
                  {loggingOut ? t("profile.loggingOut") : t("profile.logOut")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </UserShell>
  );
}

function IdentityFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[12px] font-medium text-[#8A94A6]">{label}</dt>
      <dd className="min-w-0 text-right font-semibold text-[#0F172A]">{value}</dd>
    </div>
  );
}

function SettingsRow({
  to,
  icon: Icon,
  title,
  subtitle,
}: {
  to: "/app/profile/edit" | "/app/profile/kyc" | "/app/profile/password" | "/app/profile/pin";
  icon: typeof UserRound;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl bg-white px-3.5 py-3.5 text-left",
        "shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)]",
        "active:bg-[#F8FAFC]",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#1D4ED8]">
        <Icon className="size-[18px]" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-semibold text-[#0F172A]">{title}</p>
        <p className="mt-0.5 text-[13px] text-[#8A94A6]">{subtitle}</p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-[#C0C7D2]" strokeWidth={2} />
    </Link>
  );
}
