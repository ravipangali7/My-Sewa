import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Search, Send, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { liveQueryOptions } from "@/lib/refresh";
import type { SupportChatThread, SupportChatUser } from "@/lib/types";
import { cn } from "@/lib/utils";

function initials(user: SupportChatUser) {
  return (
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || user.phone.slice(0, 2)
  );
}

function PersonRow({
  name,
  phone,
  roleLabel,
  avatarUrl,
  preview,
  unread,
  active,
  onClick,
}: {
  name: string;
  phone: string;
  roleLabel: string;
  avatarUrl: string | null;
  preview?: string;
  unread?: number;
  active?: boolean;
  onClick: () => void;
}) {
  const person: SupportChatUser = {
    id: 0,
    phone,
    name,
    role: "customer",
    role_label: roleLabel,
    is_staff: false,
    is_superuser: false,
    avatar_url: avatarUrl,
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        active ? "bg-brand-soft text-brand-dark" : "hover:bg-muted",
      )}
    >
      <Avatar className="size-10 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
        <AvatarFallback className="bg-muted text-xs font-semibold">
          {initials(person)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{name}</p>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {roleLabel}
          </span>
        </div>
        <p className="truncate text-[12px] text-muted-foreground">{preview || phone}</p>
      </div>
      {unread && unread > 0 ? (
        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </button>
  );
}

export function SupportChatPanel({ className }: { className?: string }) {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const threadsQuery = useQuery({
    queryKey: ["support-chat", "threads"],
    queryFn: () => apiClient.supportChatThreads(),
    ...liveQueryOptions(8_000),
  });
  const contactsQuery = useQuery({
    queryKey: ["support-chat", "contacts", debouncedQuery],
    queryFn: () => apiClient.supportChatContacts(debouncedQuery),
    ...liveQueryOptions(30_000),
  });
  const messagesQuery = useQuery({
    queryKey: ["support-chat", "messages", selectedThreadId],
    queryFn: () => apiClient.supportChatMessages(selectedThreadId!),
    enabled: selectedThreadId != null,
    ...liveQueryOptions(3_000),
  });

  const startMutation = useMutation({
    mutationFn: (userId: number) => apiClient.supportChatStartThread(userId),
    onSuccess: (thread) => {
      setSelectedThreadId(thread.id);
      void queryClient.invalidateQueries({ queryKey: ["support-chat"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t("chat.startFailed"));
    },
  });

  const sendMutation = useMutation({
    mutationFn: (body: string) => apiClient.supportChatSendMessage(selectedThreadId!, body),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["support-chat"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t("chat.sendFailed"));
    },
  });

  const threads = threadsQuery.data?.items ?? [];
  const contacts = contactsQuery.data?.items ?? [];
  const messages = messagesQuery.data?.items ?? [];
  const searching = Boolean(debouncedQuery);
  const threadByUserId = useMemo(() => {
    const map = new Map<number, SupportChatThread>();
    for (const thread of threads) map.set(thread.other_user.id, thread);
    return map;
  }, [threads]);

  const listItems = useMemo(() => {
    if (searching) {
      return contacts.map((contact) => {
        const existing = threadByUserId.get(contact.id);
        return {
          key: `c-${contact.id}`,
          user: contact,
          thread: existing ?? null,
          preview: existing?.last_message_preview || contact.phone,
          unread: existing?.unread_count ?? 0,
        };
      });
    }
    const seen = new Set<number>();
    const items: Array<{
      key: string;
      user: SupportChatUser;
      thread: SupportChatThread | null;
      preview: string;
      unread: number;
    }> = [];
    for (const thread of threads) {
      seen.add(thread.other_user.id);
      items.push({
        key: `t-${thread.id}`,
        user: thread.other_user,
        thread,
        preview: thread.last_message_preview || thread.other_user.phone,
        unread: thread.unread_count,
      });
    }
    const leftover = contacts.filter((contact) => !seen.has(contact.id));
    if (leftover.length <= 20) {
      for (const contact of leftover) {
        items.push({
          key: `c-${contact.id}`,
          user: contact,
          thread: null,
          preview: contact.phone,
          unread: 0,
        });
      }
    }
    return items;
  }, [contacts, searching, threadByUserId, threads]);

  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? null;
  const selectedUser = selectedThread?.other_user
    ?? listItems.find((item) => item.thread?.id === selectedThreadId)?.user
    ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, selectedThreadId]);

  const openPerson = (person: SupportChatUser, thread: SupportChatThread | null) => {
    if (thread) {
      setSelectedThreadId(thread.id);
      return;
    }
    startMutation.mutate(person.id);
  };

  const send = () => {
    const body = draft.trim();
    if (!body || selectedThreadId == null || sendMutation.isPending) return;
    sendMutation.mutate(body);
  };

  const showChat = selectedThreadId != null;

  return (
    <div
      className={cn(
        "flex min-h-[min(36rem,calc(100dvh-11rem))] overflow-hidden rounded-2xl border border-border bg-surface",
        className,
      )}
    >
      <aside
        className={cn(
          "flex w-full flex-col border-border md:w-[20rem] md:border-r",
          showChat ? "hidden md:flex" : "flex",
        )}
      >
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("chat.searchPlaceholder")}
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <p className="mt-2 px-0.5 text-[11px] text-muted-foreground">{t("chat.authorizedHint")}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {threadsQuery.isLoading || contactsQuery.isLoading ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : listItems.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-12 text-center">
              <MessageCircle className="mb-3 size-10 text-muted-foreground/50" />
              <p className="text-sm font-medium">{t("chat.emptyTitle")}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{t("chat.emptyBody")}</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {listItems.map((item) => (
                <PersonRow
                  key={item.key}
                  name={item.user.name}
                  phone={item.user.phone}
                  roleLabel={item.user.role_label}
                  avatarUrl={item.user.avatar_url}
                  preview={item.preview}
                  unread={item.unread}
                  active={item.thread?.id === selectedThreadId}
                  onClick={() => openPerson(item.user, item.thread)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <section
        className={cn(
          "min-w-0 flex-1 flex-col",
          showChat ? "flex" : "hidden md:flex",
        )}
      >
        {selectedThreadId == null || !selectedUser ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <MessageCircle className="mb-3 size-12 text-muted-foreground/40" />
            <p className="text-sm font-medium">{t("chat.selectTitle")}</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{t("chat.selectBody")}</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <button
                type="button"
                className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-muted md:hidden"
                aria-label={t("common.goBack")}
                onClick={() => setSelectedThreadId(null)}
              >
                <ArrowLeft className="size-4" />
              </button>
              <Avatar className="size-9">
                {selectedUser.avatar_url ? (
                  <AvatarImage src={selectedUser.avatar_url} alt={selectedUser.name} />
                ) : null}
                <AvatarFallback className="text-xs">{initials(selectedUser)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{selectedUser.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {selectedUser.role_label} · {selectedUser.phone}
                </p>
              </div>
            </header>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 px-3 py-4">
              {messagesQuery.isLoading ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : messages.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("chat.noMessages")}</p>
              ) : (
                messages.map((message) => {
                  const mine = message.sender_id === user?.id;
                  return (
                    <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                          mine
                            ? "rounded-br-md bg-brand text-primary-foreground"
                            : "rounded-bl-md bg-background text-foreground",
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{message.body}</p>
                        <p
                          className={cn(
                            "mt-1 text-[10px]",
                            mine ? "text-primary-foreground/80" : "text-muted-foreground",
                          )}
                        >
                          {formatDateTime(message.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>
            <form
              className="flex items-end gap-2 border-t border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("chat.typePlaceholder")}
                className="h-11 rounded-xl"
                maxLength={4000}
                autoComplete="off"
              />
              <Button
                type="submit"
                size="icon"
                className="size-11 shrink-0 rounded-xl"
                disabled={!draft.trim() || sendMutation.isPending}
                aria-label={t("chat.send")}
              >
                <Send className="size-4" />
              </Button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
