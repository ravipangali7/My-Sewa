import { createFileRoute } from "@tanstack/react-router";
import { UserShell } from "@/components/layout/UserShell";
import { SupportChatPanel } from "@/components/support-chat/SupportChatPanel";
import { useT } from "@/lib/i18n";

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
  return (
    <UserShell title={t("chat.title")} back="/app" disablePullToRefresh>
      <SupportChatPanel mode="user" className="h-[calc(100dvh-11.5rem)] min-h-[26rem] lg:h-[calc(100dvh-8rem)]" />
    </UserShell>
  );
}
