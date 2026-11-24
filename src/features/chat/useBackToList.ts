import { useEffect, useRef } from "react";

const CHAT_ENTRY_KEY = "swoonyChat";

function isChatEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && CHAT_ENTRY_KEY in state;
}

export function useBackToList(activeChatId: string | null, close: () => void): void {
  const ownsEntry = useRef(false);

  useEffect(() => {
    if (activeChatId === null) {
      if (ownsEntry.current && isChatEntry(history.state)) history.back();
      ownsEntry.current = false;
      return;
    }
    const entry = { [CHAT_ENTRY_KEY]: activeChatId };
    if (isChatEntry(history.state)) history.replaceState(entry, "");
    else history.pushState(entry, "");
    ownsEntry.current = true;
    const onPopState = () => {
      ownsEntry.current = false;
      close();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [activeChatId, close]);
}
