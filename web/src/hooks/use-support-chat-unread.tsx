import { useQuery, type QueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { liveQueryOptions } from "@/lib/refresh";
import type { SupportChatThread } from "@/lib/types";
import { cn } from "@/lib/utils";

type ThreadsCache = { items: SupportChatThread[]; count: number };
type UnreadCache = { count: number };

const NAV_BADGE_CLASS =
  "ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[#FF3B30] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white";
const ICON_BADGE_CLASS =
  "absolute top-1 right-1 flex size-[16px] items-center justify-center rounded-full bg-[#FF3B30] text-[9px] font-bold text-white ring-2 ring-[#0B4A8F]/70";
const ROW_BADGE_CLASS =
  "inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-[#FF3B30] px-1.5 py-0.5 text-[10px] font-semibold text-white";

export function formatUnreadCount(count: number, compact = false) {
  if (count <= 0) return "";
  if (compact) return count > 9 ? "9+" : String(count);
  return count > 99 ? "99+" : String(count);
}

export function markSupportChatThreadReadInCache(queryClient: QueryClient, threadId: number) {
  const current = queryClient.getQueryData<ThreadsCache>(["support-chat", "threads"]);
  if (!current?.items) {
    void queryClient.invalidateQueries({ queryKey: ["support-chat", "unread"] });
    return;
  }
  const cleared = current.items.find((item) => item.id === threadId)?.unread_count ?? 0;
  if (cleared <= 0) return;
  queryClient.setQueryData<ThreadsCache>(["support-chat", "threads"], {
    ...current,
    items: current.items.map((item) =>
      item.id === threadId ? { ...item, unread_count: 0 } : item,
    ),
  });
  queryClient.setQueryData<UnreadCache>(["support-chat", "unread"], (old) => ({
    count: Math.max(0, (old?.count ?? 0) - cleared),
  }));
}

export function useSupportChatUnread() {
  return useQuery({
    queryKey: ["support-chat", "unread"],
    queryFn: () => apiClient.supportChatUnread(),
    ...liveQueryOptions(5_000),
    refetchOnMount: "always",
  });
}

export function SupportChatUnreadBadge({
  className,
  variant = "nav",
}: {
  className?: string;
  variant?: "nav" | "icon" | "row";
}) {
  const unread = useSupportChatUnread();
  const count = unread.data?.count ?? 0;
  if (count <= 0) return null;
  const compact = variant === "icon";
  const base =
    variant === "icon" ? ICON_BADGE_CLASS : variant === "row" ? ROW_BADGE_CLASS : NAV_BADGE_CLASS;
  return <span className={cn(base, className)}>{formatUnreadCount(count, compact)}</span>;
}

export function SupportChatUnreadChip({ className }: { className?: string }) {
  const t = useT();
  const unread = useSupportChatUnread();
  const count = unread.data?.count ?? 0;
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-[#FF3B30] px-2.5 py-1 text-xs font-semibold text-white",
        className,
      )}
    >
      {count === 1 ? t("chat.newMessage") : t("chat.newMessages", { count })}
    </span>
  );
}

export function ConversationUnreadBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span className={className ?? ROW_BADGE_CLASS}>{formatUnreadCount(count)}</span>
  );
}
