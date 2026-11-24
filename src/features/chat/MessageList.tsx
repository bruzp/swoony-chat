import { memo, useEffect, useLayoutEffect, useRef } from "react";
import type { ChatMessage } from "@shared/protocol/chat";
import type { PendingMessage } from "@/app/store";
import { cn } from "@/lib/cn";
import { isEmojiOnly } from "./emojiOnly";
import { failureCopy } from "./failureCopy";

const NEAR_BOTTOM_PX = 64;

interface MessageListProps {
  messages: ChatMessage[];
  pending: PendingMessage[];
  myUserId: string | undefined;
  peerSeen: number;
  peerTyping: boolean;
  canRetry: boolean;
  onRetry: (clientId: string) => void;
}

const SentBubble = memo(function SentBubble({
  own,
  text,
  seen,
}: {
  own: boolean;
  text: string;
  seen: boolean;
}) {
  return (
    <div data-own={String(own)} className="flex flex-col">
      <Bubble own={own}>{text}</Bubble>
      {seen && <span className="self-end px-1 text-xs text-muted-foreground">Seen</span>}
    </div>
  );
});

function Bubble({ own, children, faded }: { own: boolean; children: string; faded?: boolean }) {
  const emojiOnly = isEmojiOnly(children);
  return (
    <p
      data-emoji-only={emojiOnly ? "true" : undefined}
      className={cn(
        "max-w-[80%] break-words whitespace-pre-wrap",
        emojiOnly
          ? "text-4xl leading-tight"
          : own
            ? "bg-brand rounded-2xl rounded-br-md px-3.5 py-2 text-[15px] leading-snug text-white"
            : "rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-[15px] leading-snug",
        own ? "self-end" : "self-start",
        faded && "opacity-60",
      )}
    >
      {children}
    </p>
  );
}

function PendingBubble({
  message,
  canRetry,
  onRetry,
}: {
  message: PendingMessage;
  canRetry: boolean;
  onRetry: (clientId: string) => void;
}) {
  return (
    <div data-own="true" className="flex flex-col items-end gap-1">
      <Bubble own faded>
        {message.text}
      </Bubble>
      {message.failed === "not_sent" && canRetry ? (
        <button
          type="button"
          onClick={() => {
            onRetry(message.clientId);
          }}
          className="min-h-11 px-1 text-xs font-medium text-destructive"
        >
          {failureCopy("not_sent")}
        </button>
      ) : message.failed === "not_sent" ? (
        <span className="px-1 text-xs text-destructive">Not sent.</span>
      ) : message.failed ? (
        <span className="px-1 text-xs text-destructive">{failureCopy(message.failed)}</span>
      ) : (
        <span className="px-1 text-xs text-muted-foreground">Sending…</span>
      )}
    </div>
  );
}

function lastSeenOwnSeq(messages: ChatMessage[], myUserId: string | undefined, peerSeen: number) {
  return messages.findLast((m) => m.from === myUserId && m.seq <= peerSeen)?.seq ?? null;
}

const TYPING_DOT_DELAYS = ["0ms", "150ms", "300ms"];

function TypingBubble() {
  return (
    <div
      data-typing="true"
      aria-hidden="true"
      className="flex items-center gap-1 self-start rounded-2xl rounded-bl-md bg-muted px-3.5 py-3"
    >
      {TYPING_DOT_DELAYS.map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: delay }}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

export function MessageList({
  messages,
  pending,
  myUserId,
  peerSeen,
  peerTyping,
  canRetry,
  onRetry,
}: MessageListProps) {
  const seenAt = lastSeenOwnSeq(messages, myUserId, peerSeen);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const pendingCount = pending.length;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && nearBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && pendingCount > 0) element.scrollTop = element.scrollHeight;
  }, [pendingCount]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && peerTyping && nearBottom.current) element.scrollTop = element.scrollHeight;
  }, [peerTyping]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={scroller}
      role="log"
      aria-label="Messages"
      onScroll={(event) => {
        const element = event.currentTarget;
        nearBottom.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
      }}
      className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain px-4 py-3"
    >
      {messages.map((message) => (
        <SentBubble
          key={message.seq}
          own={message.from === myUserId}
          text={message.text}
          seen={message.seq === seenAt}
        />
      ))}
      {pending.map((message) => (
        <PendingBubble
          key={message.clientId}
          message={message}
          canRetry={canRetry}
          onRetry={onRetry}
        />
      ))}
      {peerTyping && <TypingBubble />}
    </div>
  );
}
