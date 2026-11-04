import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { LogOut, BookmarkCheck, ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { isAccountSaved } from "@/lib/saved-accounts";
import { useT } from "@/lib/i18n";

interface LogoutConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogoutConfirmDialog({ open, onOpenChange }: LogoutConfirmDialogProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const [loadingAction, setLoadingAction] = useState<"save" | "nosave" | null>(null);

  if (!user) return null;

  const alreadySaved = isAccountSaved(user.id);
  const fullName =
    `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.phone || "Account";
  const avatarUrl = user.avatar_url || user.avatar;
  const initial = (user.first_name?.[0] || user.phone?.[0] || "U").toUpperCase();

  const handleAction = async (saveOnDevice: boolean) => {
    setLoadingAction(saveOnDevice ? "save" : "nosave");
    try {
      await logout({ saveOnDevice });
      if (saveOnDevice) {
        toast.success(t("auth.savedAccountToast"));
      } else {
        toast.success(t("nav.logOut"));
      }
      onOpenChange(false);
      navigate({ to: "/" });
    } catch (err) {
      console.error("Logout failed:", err);
      toast.error(t("common.requestFailed"));
    } finally {
      setLoadingAction(null);
    }
  };

  const isBusy = loadingAction !== null;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isBusy && onOpenChange(next)}>
      <AlertDialogContent className="max-w-md rounded-2xl p-6 sm:p-7">
        <AlertDialogHeader className="space-y-3">
          <div className="flex items-center gap-3.5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <BookmarkCheck className="size-6 text-primary" />
            </div>
            <div>
              <AlertDialogTitle className="text-xl font-bold tracking-tight">
                {t("auth.saveLoginInfoTitle")}
              </AlertDialogTitle>
              <p className="text-xs text-muted-foreground">
                {alreadySaved ? "Device login info active" : "One-tap login like Facebook"}
              </p>
            </div>
          </div>

          {/* Account Profile Preview */}
          <div className="flex items-center gap-3.5 rounded-xl border border-border/80 bg-muted/40 p-3">
            <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-tr from-primary to-primary/70 text-lg font-bold text-primary-foreground shadow-sm">
              {avatarUrl ? (
                <img src={avatarUrl} alt={fullName} className="size-full object-cover" />
              ) : (
                <span>{initial}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{user.phone || user.email}</p>
            </div>
            {alreadySaved && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                <BookmarkCheck className="size-3" /> Saved
              </span>
            )}
          </div>

          <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
            {t("auth.saveLoginInfoDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="mt-4 flex-col gap-2 sm:flex-col sm:space-x-0">
          {/* Action 1: Yes, Save / Keep Saved */}
          <Button
            type="button"
            disabled={isBusy}
            onClick={() => handleAction(true)}
            className="h-11 w-full gap-2 rounded-xl text-sm font-semibold shadow-sm"
          >
            <BookmarkCheck className="size-4" />
            {loadingAction === "save"
              ? t("profile.loggingOut")
              : alreadySaved
                ? "Keep Saved & Log Out"
                : t("auth.saveAndLogOut")}
          </Button>

          {/* Action 2: No, Don't Save / Remove */}
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={() => handleAction(false)}
            className="h-11 w-full gap-2 rounded-xl border-destructive/30 text-sm font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="size-4" />
            {loadingAction === "nosave"
              ? t("profile.loggingOut")
              : alreadySaved
                ? "Remove from Device & Log Out"
                : t("auth.logOutWithoutSaving")}
          </Button>

          {/* Action 3: Cancel */}
          <AlertDialogCancel
            disabled={isBusy}
            className="h-10 w-full rounded-xl border-transparent text-sm text-muted-foreground hover:bg-muted"
          >
            {t("common.cancel")}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
