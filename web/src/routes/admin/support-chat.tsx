import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/layout/AdminShell";
import { SupportChatPanel } from "@/components/support-chat/SupportChatPanel";

export const Route = createFileRoute("/admin/support-chat")({
  head: () => ({
    meta: [
      { title: "Support Chat — MySewa Admin" },
      {
        name: "description",
        content: "Chat with any MySewa user. Conversations follow the support hierarchy.",
      },
    ],
  }),
  component: AdminSupportChatPage,
});

function AdminSupportChatPage() {
  return (
    <AdminShell
      title="Support Chat"
      description="Message any user. Agents, sub-agents and customers can only reach the people they are assigned to."
      dense
    >
      <SupportChatPanel className="h-[calc(100dvh-10.5rem)] min-h-[28rem]" />
    </AdminShell>
  );
}
