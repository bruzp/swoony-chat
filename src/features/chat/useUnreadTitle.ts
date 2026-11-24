import { useEffect, useState } from "react";

const BASE_TITLE = "Swoony";

function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  useEffect(() => {
    const update = () => {
      setHidden(document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return hidden;
}

export function useUnreadTitle(totalUnread: number): void {
  const hidden = usePageHidden();
  useEffect(() => {
    document.title =
      hidden && totalUnread > 0 ? `(${String(totalUnread)}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [hidden, totalUnread]);
}
