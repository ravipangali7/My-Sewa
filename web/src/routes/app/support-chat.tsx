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
        content: "Chat with your assigned support contact.",
      },
    ],
  }),
  component: AppSupportChatPage,
});

function AppSupportChatPage() {
  const t = useT();
  return (
    <UserShell title={t("chat.title")} back="/app" disablePullToRefresh>
      <SupportChatPanel className="h-[calc(100dvh-11.5rem)] min-h-[26rem] lg:h-[calc(100dvh-8rem)]" />
    </UserShell>
  );
}
