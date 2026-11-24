import { ArrowLeft, Info, MoreVertical } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "@/app/store";
import { useDetailsPane } from "@/components/detailsPane";
import { LetterTile } from "@/components/LetterTile";
import { ShortMeta } from "@/components/ShortMeta";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLobby } from "@/features/lobby/lobbyContext";
import { BlockConfirmDialog } from "@/features/lobby/BlockConfirmDialog";
import { ReportDialog } from "@/features/lobby/ReportDialog";
import { cn } from "@/lib/cn";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { PeerDetails } from "./PeerDetails";
import { retryChatMessage, sendChatSeen, sendChatText, sendChatTyping } from "./useChatConnection";

function useMarkReadWhenVisible(chatId: string) {
  const setActiveChat = useAppStore((state) => state.setActiveChat);
  useEffect(() => {
    const markRead = () => {
      if (document.visibilityState === "visible") setActiveChat(chatId);
    };
    document.addEventListener("visibilitychange", markRead);
    return () => {
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [chatId, setActiveChat]);
}

function useMarkSeenWhenVisible(chatId: string, newestPeerSeq: number, connected: boolean) {
  useEffect(() => {
    if (newestPeerSeq === 0 || !connected) return;
    const markSeen = () => {
      if (document.visibilityState === "visible") sendChatSeen(chatId, newestPeerSeq);
    };
    markSeen();
    document.addEventListener("visibilitychange", markSeen);
    return () => {
      document.removeEventListener("visibilitychange", markSeen);
    };
  }, [chatId, newestPeerSeq, connected]);
}

export function ChatScreen({ chatId }: { chatId: string }) {
  const chat = useAppStore((state) => state.chats[chatId]);
  const myUserId = useAppStore((state) => state.session.me?.userId);
  const setActiveChat = useAppStore((state) => state.setActiveChat);
  const closeChat = useAppStore((state) => state.closeChat);
  const { send } = useLobby();
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pane = useDetailsPane();
  useMarkReadWhenVisible(chatId);
  const newestPeerSeq = chat?.messages.findLast((message) => message.from !== myUserId)?.seq ?? 0;
  useMarkSeenWhenVisible(chatId, newestPeerSeq, chat?.connected ?? false);

  if (!chat) return null;
  const { peer } = chat;

  return (
    <section aria-label={`Chat with ${peer.nickname}`} className="flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => {
            setActiveChat(null);
          }}
          className="flex size-11 items-center justify-center rounded-full hover:bg-muted lg:hidden"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        <LetterTile name={peer.nickname} gender={peer.gender} size="sm" className="lg:ml-2" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{peer.nickname}</h2>
          <p className="flex items-center text-xs text-muted-foreground">
            <ShortMeta user={peer} />
            {!chat.ended && !chat.connected && <span className="ml-1">· Connecting…</span>}
          </p>
        </div>
        <button
          type="button"
          aria-label="Chat details"
          aria-expanded={pane.toggle ? pane.shown : undefined}
          onClick={() => {
            if (pane.toggle) pane.toggle();
            else setDetailsOpen(true);
          }}
          className={cn(
            "flex size-11 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
            pane.shown && "bg-muted",
          )}
        >
          <Info className="size-5" aria-hidden="true" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Chat options"
              className="flex size-11 items-center justify-center rounded-full hover:bg-muted"
            >
              <MoreVertical className="size-5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={chat.ended}
              className="min-h-11"
              onSelect={() => {
                setBlockOpen(true);
              }}
            >
              Block
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              className="min-h-11"
              onSelect={() => {
                setReportOpen(true);
              }}
            >
              Report
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <MessageList
        messages={chat.messages}
        pending={chat.pending}
        myUserId={myUserId}
        peerSeen={chat.peerSeen}
        peerTyping={chat.peerTyping && !chat.ended}
        canRetry={!chat.ended}
        onRetry={(clientId) => {
          retryChatMessage(chatId, clientId);
        }}
      />
      {chat.ended && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-1 text-sm">
          <span className="text-muted-foreground">
            {chat.endedByMe ? `You blocked ${peer.nickname}.` : `${peer.nickname} left`}
          </span>
          <button
            type="button"
            onClick={() => {
              closeChat(chatId);
            }}
            className="min-h-11 rounded-full px-3 font-medium text-primary"
          >
            Close chat
          </button>
        </div>
      )}
      <Composer
        disabled={chat.ended}
        onSend={(text) => sendChatText(chatId, text)}
        onTyping={() => {
          sendChatTyping(chatId);
        }}
      />
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="p-6">
          <PeerDetails peer={peer} inDialog />
        </DialogContent>
      </Dialog>
      <BlockConfirmDialog
        user={peer}
        open={blockOpen}
        onOpenChange={setBlockOpen}
        onConfirm={() => {
          send({ type: "block", userId: peer.userId });
        }}
      />
      <ReportDialog
        user={peer}
        open={reportOpen}
        onOpenChange={setReportOpen}
        onSubmit={(reason) => {
          send({ type: "report", userId: peer.userId, reason });
        }}
      />
    </section>
  );
}
