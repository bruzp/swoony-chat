import { useVirtualizer } from "@tanstack/react-virtual";
import { MoreVertical } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ADS_ENABLED } from "@shared/config";
import { countryName } from "@shared/countries";
import type { PublicUser } from "@shared/profile";
import { useAppStore } from "@/app/store";
import { AdSlot } from "@/components/AdSlot";
import { LetterTile } from "@/components/LetterTile";
import { ShortMeta } from "@/components/ShortMeta";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { longMeta } from "@/lib/userMeta";
import { BlockConfirmDialog } from "./BlockConfirmDialog";
import { useLobby } from "./lobbyContext";
import { ProfileDialog } from "./ProfileDialog";
import { ReportDialog } from "./ReportDialog";

const ROW_HEIGHT_ESTIMATE = 72;
const PREFETCH_WITHIN_ROWS = 5;
const AD_AFTER_ROW = 5;
const AT_TOP_WITHIN_PX = 16;
export const NEW_PEOPLE_BATCH_MS = 2000;
export const AUTO_RELOAD_MIN_GAP_MS = 5000;

type ListRow =
  | { kind: "user"; user: PublicUser; position: number }
  | { kind: "ad" }
  | { kind: "header"; label: string; key: string };

function buildRows(users: PublicUser[], myCountry: string | undefined): ListRow[] {
  const rows: ListRow[] = [];
  let currentGroupIsMine: boolean | null = null;
  let adPlaced = !ADS_ENABLED;
  users.forEach((user, index) => {
    const isMine = user.country === myCountry;
    if (isMine !== currentGroupIsMine) {
      currentGroupIsMine = isMine;
      const label = isMine && myCountry ? countryName(myCountry) : "Everywhere else";
      rows.push({ kind: "header", label, key: isMine ? "header-mine" : "header-rest" });
    } else if (!adPlaced && index >= AD_AFTER_ROW) {
      rows.push({ kind: "ad" });
      adPlaced = true;
    }
    rows.push({ kind: "user", user, position: index + 1 });
  });
  return rows;
}

function rowKey(row: ListRow | undefined, index: number): string {
  if (!row) return String(index);
  if (row.kind === "user") return row.user.userId;
  return row.kind === "header" ? row.key : "ad";
}

function newPeopleAddedLabel(count: number): string {
  return count === 1
    ? "1 new person added to the list"
    : `${String(count)} new people added to the list`;
}

function othersOnlineLabel(count: number): string {
  return count === 1 ? "1 other online" : `${String(count)} others online`;
}

function isScrolledToTop(scroller: HTMLElement | null): boolean {
  return (scroller?.scrollTop ?? 0) <= AT_TOP_WITHIN_PX;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => {
      setVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return visible;
}

const UserRow = memo(function UserRow({
  user,
  position,
  total,
  onChat,
  onViewProfile,
  onBlock,
  onReport,
}: {
  user: PublicUser;
  position: number;
  total: number;
  onChat: (user: PublicUser) => void;
  onViewProfile: (user: PublicUser) => void;
  onBlock: (user: PublicUser) => void;
  onReport: (user: PublicUser) => void;
}) {
  return (
    <div
      role="listitem"
      aria-label={`${user.nickname}, ${longMeta(user)}`}
      aria-setsize={total}
      aria-posinset={position}
      className="flex items-center gap-1 px-2 py-1"
    >
      <button
        type="button"
        aria-label={`Chat with ${user.nickname}`}
        onClick={() => {
          onChat(user);
        }}
        className="group flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="relative shrink-0">
          <LetterTile name={user.nickname} gender={user.gender} />
          <span
            aria-hidden="true"
            className="absolute right-0 bottom-0 size-3 rounded-full bg-emerald-500 ring-2 ring-surface"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{user.nickname}</span>
            <ShortMeta user={user} className="shrink-0 text-xs text-muted-foreground" />
          </span>
          {user.bio && (
            <span className="truncate text-sm text-muted-foreground italic">{user.bio}</span>
          )}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More options for ${user.nickname}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <MoreVertical className="size-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="min-h-11"
            onSelect={() => {
              onViewProfile(user);
            }}
          >
            View profile
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11"
            onSelect={() => {
              onBlock(user);
            }}
          >
            Block
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            className="min-h-11"
            onSelect={() => {
              onReport(user);
            }}
          >
            Report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

export function OnlineList() {
  const users = useAppStore((state) => state.lobby.users);
  const online = useAppStore((state) => state.lobby.online);
  const nextCursor = useAppStore((state) => state.lobby.nextCursor);
  const loading = useAppStore((state) => state.lobby.request !== null);
  const listPaused = useAppStore((state) => state.lobby.listPaused);
  const filtered = useAppStore((state) => Object.keys(state.lobby.filter).length > 0);
  const hasNewPeople = useAppStore((state) => state.lobby.pendingJoins.size > 0);
  const myCountry = useAppStore((state) => state.session.me?.country);
  const requestList = useAppStore((state) => state.requestList);
  const { send } = useLobby();
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const profileUser = users.find((user) => user.userId === profileUserId) ?? null;
  const [reportUser, setReportUser] = useState<PublicUser | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockUser, setBlockUser] = useState<PublicUser | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const pageVisible = usePageVisible();
  const lastAutoReloadAt = useRef(Number.NEGATIVE_INFINITY);
  const [announcement, setAnnouncement] = useState("");
  const rows = useMemo(() => buildRows(users, myCountry), [users, myCountry]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    getItemKey: (index) => rowKey(rows[index], index),
    overscan: 6,
  });
  const items = virtualizer.getVirtualItems();
  const lastVisibleIndex = items.at(-1)?.index ?? -1;

  useEffect(() => {
    if (nextCursor === null || loading || listPaused) return;
    if (lastVisibleIndex >= rows.length - PREFETCH_WITHIN_ROWS) send(requestList(nextCursor));
  }, [nextCursor, loading, listPaused, lastVisibleIndex, rows.length, send, requestList]);

  useEffect(() => {
    if (!hasNewPeople || !atTop || !pageVisible || loading || listPaused) return;
    const sinceLast = Date.now() - lastAutoReloadAt.current;
    const delay = Math.max(NEW_PEOPLE_BATCH_MS, AUTO_RELOAD_MIN_GAP_MS - sinceLast);
    const timer = setTimeout(() => {
      if (!isScrolledToTop(scrollRef.current)) {
        setAtTop(false);
        return;
      }
      lastAutoReloadAt.current = Date.now();
      setAnnouncement(newPeopleAddedLabel(useAppStore.getState().lobby.pendingJoins.size));
      send(requestList(null));
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [hasNewPeople, atTop, pageVisible, loading, listPaused, send, requestList]);

  const openChat = useCallback(
    (user: PublicUser) => {
      setProfileUserId(null);
      send({ type: "openChat", userId: user.userId });
    },
    [send],
  );
  const viewProfile = useCallback((user: PublicUser) => {
    setProfileUserId(user.userId);
  }, []);
  const askToBlock = useCallback((user: PublicUser) => {
    setBlockUser(user);
    setBlockOpen(true);
  }, []);
  const askToReport = useCallback((user: PublicUser) => {
    setReportUser(user);
    setReportOpen(true);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="px-4 pb-1 text-xs font-medium text-muted-foreground">
        {othersOnlineLabel(online)}
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          data-testid="online-scroller"
          onScroll={(event) => {
            setAtTop(isScrolledToTop(event.currentTarget));
          }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {loading
                ? "Loading…"
                : filtered
                  ? "No one matches these filters right now."
                  : "No one else is online right now."}
            </p>
          ) : (
            <div
              role="list"
              aria-label="People online"
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {items.map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${String(item.start)}px)` }}
                  >
                    {row.kind === "header" ? (
                      <div
                        role="presentation"
                        className="px-4 pt-3 pb-1 text-xs font-semibold text-muted-foreground"
                      >
                        {row.label}
                      </div>
                    ) : row.kind === "ad" ? (
                      <div role="listitem" className="flex justify-center py-2">
                        <AdSlot placement="list-inline" />
                      </div>
                    ) : (
                      <UserRow
                        user={row.user}
                        position={row.position}
                        total={users.length}
                        onChat={openChat}
                        onViewProfile={viewProfile}
                        onBlock={askToBlock}
                        onReport={askToReport}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <ProfileDialog
        user={profileUser}
        onClose={() => {
          setProfileUserId(null);
        }}
        onChat={openChat}
      />
      {blockUser && (
        <BlockConfirmDialog
          user={blockUser}
          open={blockOpen}
          onOpenChange={setBlockOpen}
          onConfirm={() => {
            send({ type: "block", userId: blockUser.userId });
          }}
        />
      )}
      {reportUser && (
        <ReportDialog
          user={reportUser}
          open={reportOpen}
          onOpenChange={setReportOpen}
          onSubmit={(reason) => {
            send({ type: "report", userId: reportUser.userId, reason });
          }}
        />
      )}
    </div>
  );
}
