import { useAppStore, type ChatState } from "@/app/store";
import { LetterTile } from "@/components/LetterTile";
import { cn } from "@/lib/cn";

function lastActivity(chat: ChatState): number {
  return chat.messages.at(-1)?.sentAt ?? 0;
}

function preview(chat: ChatState, myUserId: string | undefined): string {
  if (chat.ended) return chat.endedByMe ? "Blocked" : "Chat ended";
  const last = chat.messages.at(-1);
  if (!last) return "";
  return last.from === myUserId ? `You: ${last.text}` : last.text;
}

export function ChatsList() {
  const chats = useAppStore((state) => state.chats);
  const activeChatId = useAppStore((state) => state.activeChatId);
  const myUserId = useAppStore((state) => state.session.me?.userId);
  const setActiveChat = useAppStore((state) => state.setActiveChat);
  const entries = Object.entries(chats).sort(([, a], [, b]) => lastActivity(b) - lastActivity(a));

  if (entries.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No chats yet. Say hi to someone from the Online list.
      </p>
    );
  }

  return (
    <ul aria-label="Chats" className="flex flex-col py-1">
      {entries.map(([chatId, chat]) => {
        const unreadLabel = chat.unread > 0 ? `, ${String(chat.unread)} unread` : "";
        const active = activeChatId === chatId;
        return (
          <li key={chatId}>
            <button
              type="button"
              aria-label={`${chat.peer.nickname}${unreadLabel}`}
              aria-current={active ? "true" : undefined}
              onClick={() => {
                setActiveChat(chatId);
              }}
              className={cn(
                "flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/60",
                active && "bg-muted",
              )}
            >
              <LetterTile name={chat.peer.nickname} gender={chat.peer.gender} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{chat.peer.nickname}</span>
                <span
                  className={cn(
                    "truncate text-sm",
                    chat.unread > 0 ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {preview(chat, myUserId)}
                </span>
              </span>
              {chat.unread > 0 && (
                <span
                  aria-hidden="true"
                  className="bg-brand min-w-6 rounded-full px-1.5 text-center text-xs leading-6 font-semibold text-white"
                >
                  {chat.unread > 99 ? "99+" : chat.unread}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
