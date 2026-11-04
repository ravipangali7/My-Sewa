import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Users, Plus, Check, Loader2, LogOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  type SavedAccount,
  useSavedAccounts,
  saveAccount,
} from "@/lib/saved-accounts";
import { useAuth } from "@/lib/auth";
import { homePathForUser } from "@/lib/auth-destination";
import { ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface SwitchAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddAccount?: () => void;
}

export function SwitchAccountModal({
  open,
  onOpenChange,
  onAddAccount,
}: SwitchAccountModalProps) {
  const { user, token, loginWithSavedAccount, logout } = useAuth();
  const accounts = useSavedAccounts();
  const navigate = useNavigate();
  const t = useT();
  const [switchingId, setSwitchingId] = useState<number | null>(null);

  const handleSwitch = async (target: SavedAccount) => {
    if (target.id === user?.id) {
      onOpenChange(false);
      return;
    }
    setSwitchingId(target.id);
    try {
      // 1. Ensure current active user is saved on device before switching
      if (user && token) {
        const fullName =
          `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.phone || "Account";
        saveAccount({
          id: user.id,
          phone: user.phone,
          email: user.email,
          name: fullName,
          avatarUrl: user.avatar_url || user.avatar,
          role: user.role,
          token: token,
        });
      }

      // 2. Switch to target account
      const profile = await loginWithSavedAccount(target);
      toast.success(t("auth.loggingInAs", { name: target.name }));
      onOpenChange(false);
      navigate({ to: homePathForUser(profile) });
    } catch (err) {
      console.error("Account switch failed:", err);
      const msg = err instanceof ApiError ? err.message : t("auth.loginFailed");
      toast.error(msg);
    } finally {
      setSwitchingId(null);
    }
  };

  const handleAddNewAccount = async () => {
    // Save current account first if user is logged in
    if (user && token) {
      const fullName =
        `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.phone || "Account";
      saveAccount({
        id: user.id,
        phone: user.phone,
        email: user.email,
        name: fullName,
        avatarUrl: user.avatar_url || user.avatar,
        role: user.role,
        token: token,
      });
    }
    await logout({ saveOnDevice: true });
    onOpenChange(false);
    if (onAddAccount) {
      onAddAccount();
    } else {
      navigate({ to: "/" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl p-6">
        <DialogHeader className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Users className="size-5" />
            </div>
            <DialogTitle className="text-lg font-bold">{t("auth.switchAccount")}</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Switch between saved accounts on this device instantly without entering password.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 space-y-2 max-h-[320px] overflow-y-auto pr-0.5">
          {accounts.map((acc) => {
            const isCurrent = acc.id === user?.id;
            const isSwitching = switchingId === acc.id;
            const initial = (acc.name?.[0] || acc.phone?.[0] || "U").toUpperCase();

            return (
              <button
                key={acc.id}
                type="button"
                disabled={isSwitching}
                onClick={() => handleSwitch(acc)}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                  isCurrent
                    ? "border-primary/50 bg-primary/5 cursor-default"
                    : "border-border/70 hover:border-primary/40 hover:bg-muted/40 cursor-pointer"
                }`}
              >
                <div className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-tr from-primary to-primary/80 font-bold text-primary-foreground shadow-xs">
                  {acc.avatarUrl ? (
                    <img src={acc.avatarUrl} alt={acc.name} className="size-full object-cover" />
                  ) : (
                    <span>{initial}</span>
                  )}
                  {isSwitching && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="size-4 animate-spin text-white" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{acc.name}</p>
                    {isCurrent && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        <Check className="size-2.5" /> Current
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {acc.phone || acc.email}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleAddNewAccount}
            className="h-11 w-full gap-2 rounded-xl text-xs font-semibold"
          >
            <Plus className="size-4" />
            {t("auth.logIntoAnotherAccount")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
