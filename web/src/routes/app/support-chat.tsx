import { createFileRoute } from "@tanstack/react-router";
import { UserShell } from "@/components/layout/UserShell";
import { SupportChatPanel } from "@/components/support-chat/SupportChatPanel";
import { useAuth } from "@/lib/auth";
import { isNetworkRole } from "@/lib/auth-destination";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/support-chat")({
  head: () => ({
    meta: [
      { title: "Support Chat — MySewa" },
      {
        name: "description",
        content: "Chat with MySewa Admin. Users and dealers cannot message each other.",
      },
    ],
  }),
  component: AppSupportChatPage,
});

function AppSupportChatPage() {
  const t = useT();
  const { user } = useAuth();
  const dealer = isNetworkRole(user);
  return (
    <UserShell title={t("chat.title")} {...(dealer ? {} : { back: "/app" })} disablePullToRefresh>
      <SupportChatPanel
        mode="user"
        className={cn(
          "min-h-[26rem] lg:h-[calc(100dvh-8rem)]",
          dealer ? "h-[calc(100dvh-10.25rem)]" : "h-[calc(100dvh-11.5rem)]",
        )}
      />
    </UserShell>
  );
}
