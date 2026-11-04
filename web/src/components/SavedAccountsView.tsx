import { useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Plus, X, Loader2, UserCheck, ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  type SavedAccount,
  removeSavedAccount,
  useSavedAccounts,
} from "@/lib/saved-accounts";
import { useAuth } from "@/lib/auth";
import { homePathForUser } from "@/lib/auth-destination";
import { ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSiteBranding } from "@/hooks/use-site-branding";

interface SavedAccountsViewProps {
  onAddAccount: () => void;
  onSessionExpiredPrefill?: (identifier: string) => void;
}

export function SavedAccountsView({
  onAddAccount,
  onSessionExpiredPrefill,
}: SavedAccountsViewProps) {
  const accounts = useSavedAccounts();
  const { loginWithSavedAccount } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const { logoUrl } = useSiteBranding();

  const [activeLoggingInId, setActiveLoggingInId] = useState<number | null>(null);
  const [accountToRemove, setAccountToRemove] = useState<SavedAccount | null>(null);

  const handleAccountClick = async (account: SavedAccount) => {
    if (activeLoggingInId !== null) return;
    setActiveLoggingInId(account.id);
    try {
      const profile = await loginWithSavedAccount(account);
      toast.success(t("auth.loginSuccess"));
      navigate({ to: homePathForUser(profile) });
    } catch (err) {
      console.error("Saved account login failed:", err);
      if (err instanceof ApiError && err.status === 401) {
        toast.error(t("auth.sessionExpiredForUser", { name: account.name }));
        // Clean up the expired token from saved accounts list
        removeSavedAccount(account.id);
        if (onSessionExpiredPrefill) {
          onSessionExpiredPrefill(account.phone || account.email || "");
        }
      } else {
        const msg = err instanceof ApiError ? err.message : t("auth.loginFailed");
        toast.error(msg);
      }
    } finally {
      setActiveLoggingInId(null);
    }
  };

  const handleConfirmRemove = () => {
    if (!accountToRemove) return;
    removeSavedAccount(accountToRemove.id, { revokeOnServer: true });
    toast.success(t("auth.accountRemovedToast"));
    setAccountToRemove(null);
  };

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-col items-center text-center lg:items-start lg:text-left">
        <img
          src={logoUrl}
          alt="MySewa"
          className="size-14 rounded-md object-cover lg:hidden"
        />
        <h1 className="mt-4 text-[28px] font-bold tracking-tight text-foreground sm:text-[32px] lg:mt-0">
          {t("auth.savedAccountsTitle")}
        </h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {t("auth.savedAccountsSubtitle")}
        </p>
      </div>

      {/* Grid of Saved Accounts like Facebook */}
      <div className="grid grid-cols-2 gap-3.5 sm:gap-4">
        {accounts.map((account) => {
          const isLoggingIn = activeLoggingInId === account.id;
          const initial = (account.name?.[0] || account.phone?.[0] || "U").toUpperCase();

          return (
            <div
              key={account.id}
              className={`group relative flex flex-col items-center justify-between overflow-hidden rounded-md border bg-card p-4 text-center shadow-xs transition-all duration-200 select-none ${
                isLoggingIn
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border/80 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md cursor-pointer active:scale-[0.98]"
              }`}
              onClick={() => handleAccountClick(account)}
            >
              {/* Delete / Remove "X" Button */}
              <button
                type="button"
                aria-label={t("auth.removeAccountFromDevice")}
                title={t("auth.removeAccountFromDevice")}
                disabled={activeLoggingInId !== null}
                className="absolute top-2.5 right-2.5 z-10 flex size-7 items-center justify-center rounded-full bg-muted/80 text-muted-foreground opacity-80 backdrop-blur-xs transition-all hover:bg-destructive hover:text-destructive-foreground hover:opacity-100 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setAccountToRemove(account);
                }}
              >
                <X className="size-3.5" />
              </button>

              {/* Avatar */}
              <div className="relative mt-2 flex size-16 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-gradient-to-tr from-primary to-primary/80 font-bold text-primary-foreground shadow-sm sm:size-20">
                {account.avatarUrl ? (
                  <img
                    src={account.avatarUrl}
                    alt={account.name}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="text-xl sm:text-2xl">{initial}</span>
                )}

                {isLoggingIn && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
                    <Loader2 className="size-6 animate-spin text-white" />
                  </div>
                )}
              </div>

              {/* Account Meta */}
              <div className="mt-3 w-full">
                <p className="truncate text-[14px] font-semibold text-foreground sm:text-[15px]">
                  {account.name}
                </p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {account.phone || account.email}
                </p>
              </div>

              {/* Status / CTA indicator */}
              <div className="mt-3 w-full pt-1">
                {isLoggingIn ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary">
                    <Loader2 className="size-3 animate-spin" />
                    {t("auth.signingIn")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary/80 group-hover:text-primary">
                    <UserCheck className="size-3" /> Tap to log in
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Add Account Card */}
        <div
          role="button"
          tabIndex={0}
          onClick={onAddAccount}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onAddAccount();
          }}
          className="group flex flex-col items-center justify-center rounded-md border-2 border-dashed border-border/80 bg-muted/20 p-4 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-muted/40 hover:shadow-xs cursor-pointer active:scale-[0.98]"
        >
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-105 sm:size-16">
            <Plus className="size-7" />
          </div>
          <p className="mt-3 text-[14px] font-semibold text-foreground sm:text-[15px]">
            {t("auth.logIntoAnotherAccount")}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Password or OTP</p>
        </div>
      </div>

      {/* Footer navigation */}
      <div className="mt-8 flex flex-col items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onAddAccount}
          className="h-11 w-full rounded-sm text-sm font-semibold"
        >
          {t("auth.logIntoAnotherAccount")}
        </Button>

        <p className="text-center text-[13px] text-muted-foreground">
          {t("auth.newTo")}{" "}
          <Link
            to="/register"
            className="font-semibold text-foreground underline-offset-2 hover:underline"
          >
            {t("auth.createAccount")}
          </Link>
        </p>
      </div>

      {/* Remove Account Confirmation Dialog */}
      <AlertDialog
        open={accountToRemove !== null}
        onOpenChange={(open) => !open && setAccountToRemove(null)}
      >
        <AlertDialogContent className="max-w-sm rounded-md p-6">
          <AlertDialogHeader className="space-y-2">
            <AlertDialogTitle className="text-lg font-bold">
              {t("auth.removeAccountConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              {t("auth.removeAccountConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="rounded-sm">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              className="rounded-sm bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("auth.removeAccountCta")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
