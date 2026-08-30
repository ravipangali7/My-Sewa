import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/layout/AdminShell";
import { SupportChatPanel } from "@/components/support-chat/SupportChatPanel";
import { SupportChatUnreadChip } from "@/hooks/use-support-chat-unread";

export const Route = createFileRoute("/admin/support-chat")({
  head: () => ({
    meta: [
      { title: "Support Chat — MySewa Admin" },
      {
        name: "description",
        content: "Reply to Support Chat from users and dealers.",
      },
    ],
  }),
  component: AdminSupportChatPage,
});

function AdminSupportChatPage() {
  return (
    <AdminShell
      title="Support Chat"
      description="View and reply to chats from users and dealers. Your name and phone stay hidden — they only see Super Admin."
      dense
      fillHeight
      actions={<SupportChatUnreadChip />}
    >
      <SupportChatPanel mode="admin" className="h-full min-h-0 md:min-h-[28rem]" />
    </AdminShell>
  );
}
