import { useRef, useState, type ReactNode, type Ref } from "react";
import { MessageCircle, PanelLeftClose, PanelLeftOpen, UserRound, Users } from "lucide-react";
import { selectTotalUnread, useAppStore } from "@/app/store";
import { cn } from "@/lib/cn";
import { readRememberedTab, rememberTab } from "@/lib/navigationMemory";
import { DESKTOP_QUERY, WIDE_QUERY, useMediaQuery } from "@/lib/viewport";
import { AdSlot } from "./AdSlot";
import { DetailsPaneContext, type DetailsPane } from "./detailsPane";

export type ShellTab = "online" | "chats" | "me";

export interface AppShellProps {
  online: ReactNode;
  chats: ReactNode;
  me: ReactNode;
  account: ReactNode;
  accountRail: ReactNode;
  chat: ReactNode | null;
  details: ReactNode | null;
  emptyChat?: ReactNode;
}

const TABS: { id: ShellTab; label: string; Icon: typeof Users }[] = [
  { id: "online", label: "Online", Icon: Users },
  { id: "chats", label: "Chats", Icon: MessageCircle },
  { id: "me", label: "Me", Icon: UserRound },
];

const PANELS_STORAGE_KEY = "swoony-panels";

interface PanelsOpen {
  list: boolean;
  details: boolean;
}

function readPanelsOpen(): PanelsOpen {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PANELS_STORAGE_KEY) ?? "{}");
    const saved = typeof stored === "object" && stored !== null ? stored : {};
    return {
      list: !("list" in saved) || saved.list !== false,
      details: !("details" in saved) || saved.details !== false,
    };
  } catch {
    return { list: true, details: true };
  }
}

function savePanelsOpen(open: PanelsOpen) {
  try {
    localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(open));
  } catch {
    return;
  }
}

function usePanelsOpen(): [PanelsOpen, (change: Partial<PanelsOpen>) => void] {
  const [open, setOpen] = useState(readPanelsOpen);
  function update(change: Partial<PanelsOpen>) {
    setOpen((previous) => {
      const next = { ...previous, ...change };
      savePanelsOpen(next);
      return next;
    });
  }
  return [open, update];
}

function isShellTab(value: unknown): value is ShellTab {
  return value === "online" || value === "chats" || value === "me";
}

function readTab(): ShellTab {
  const stored = readRememberedTab();
  return isShellTab(stored) ? stored : "online";
}

function useRememberedTab(): [ShellTab, (tab: ShellTab) => void] {
  const [tab, setTab] = useState(readTab);
  function select(next: ShellTab) {
    setTab(next);
    rememberTab(next);
  }
  return [tab, select];
}

function useUnreadTotal(): number {
  return useAppStore(selectTotalUnread);
}

function Wordmark() {
  return <span className="text-brand text-xl font-bold tracking-tight">swoony</span>;
}

function UnreadBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="bg-brand absolute -top-1 left-1/2 ml-2 min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function TabButton({
  tab,
  active,
  unread,
  onSelect,
  variant,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
  unread: number;
  onSelect: (tab: ShellTab) => void;
  variant: "bottom" | "segment" | "rail";
}) {
  const showsUnread = tab.id === "chats" && unread > 0;
  const label = showsUnread ? `${tab.label}, ${String(unread)} unread` : tab.label;
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={() => {
        onSelect(tab.id);
      }}
      className={cn(
        "relative flex min-h-11 flex-1 items-center justify-center font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        variant === "bottom" && "flex-col gap-0.5 rounded-xl text-xs",
        variant === "segment" && "gap-2 rounded-full text-sm",
        variant === "rail" && "size-11 flex-none rounded-xl hover:bg-muted",
        active
          ? variant === "segment"
            ? "bg-surface text-foreground shadow-sm"
            : variant === "rail"
              ? "bg-muted text-foreground"
              : "text-foreground"
          : "text-muted-foreground",
      )}
    >
      <span className="relative">
        <tab.Icon className="size-5" aria-hidden="true" />
        {showsUnread && <UnreadBadge count={unread} />}
      </span>
      {variant !== "rail" && <span aria-hidden="true">{tab.label}</span>}
    </button>
  );
}

function MobileShell({ online, chats, me, chat }: AppShellProps) {
  const [tab, setTab] = useRememberedTab();
  const unread = useUnreadTotal();
  const content = { online, chats, me }[tab];
  return (
    <>
      {chat && (
        <div className="h-app fixed inset-x-0 top-0 z-40 flex flex-col bg-background pb-safe">
          {chat}
        </div>
      )}
      <MobileTabs
        content={content}
        tab={tab}
        unread={unread}
        onSelect={setTab}
        covered={chat !== null}
      />
    </>
  );
}

function MobileTabs({
  content,
  tab,
  unread,
  onSelect,
  covered,
}: {
  content: ReactNode;
  tab: ShellTab;
  unread: number;
  onSelect: (tab: ShellTab) => void;
  covered: boolean;
}) {
  return (
    <div className="h-app flex flex-col" inert={covered} aria-hidden={covered ? true : undefined}>
      <header className="flex h-14 shrink-0 items-center px-4">
        <Wordmark />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{content}</main>
      <nav
        aria-label="Main"
        className="flex shrink-0 gap-1 border-t border-border bg-surface px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]"
      >
        {TABS.map((t) => (
          <TabButton
            key={t.id}
            tab={t}
            active={tab === t.id}
            unread={unread}
            onSelect={onSelect}
            variant="bottom"
          />
        ))}
      </nav>
    </div>
  );
}

function PanelToggle({
  label,
  Icon,
  onClick,
  ref,
}: {
  label: string;
  Icon: typeof Users;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  );
}

const RAIL_WIDTH = "4.25rem";
const PANEL_CARD =
  "min-h-0 overflow-hidden rounded-3xl border border-border/70 bg-surface shadow-panel";

function DesktopShell({
  online,
  chats,
  account,
  accountRail,
  chat,
  details,
  emptyChat,
}: AppShellProps) {
  const [rememberedTab, setTab] = useRememberedTab();
  const tab = rememberedTab === "me" ? "online" : rememberedTab;
  const [panels, setPanels] = usePanelsOpen();
  const unread = useUnreadTotal();
  const wide = useMediaQuery(WIDE_QUERY);
  const focusNextToggle = useRef(false);
  const listTabs = TABS.filter((t) => t.id !== "me");
  const selectTab = (next: ShellTab) => {
    if (next !== "me") setTab(next);
  };
  const toggleList = (list: boolean) => {
    focusNextToggle.current = true;
    setPanels({ list });
  };
  const focusIfToggled = (button: HTMLButtonElement | null) => {
    if (!button || !focusNextToggle.current) return;
    focusNextToggle.current = false;
    button.focus();
  };
  const detailsAvailable = details !== null && wide;
  const showDetails = detailsAvailable && panels.details;
  const pane: DetailsPane = detailsAvailable
    ? {
        shown: showDetails,
        toggle: () => {
          setPanels({ details: !panels.details });
        },
      }
    : { shown: false };
  return (
    <DetailsPaneContext value={pane}>
      <div
        className="h-app bg-canvas grid gap-3 p-3 transition-[grid-template-columns] duration-200 motion-reduce:transition-none"
        style={{
          gridTemplateColumns: `${panels.list ? "380px" : RAIL_WIDTH} minmax(0,1fr)${showDetails ? " 340px" : ""}`,
        }}
      >
        {panels.list ? (
          <aside className={cn(PANEL_CARD, "flex flex-col")}>
            <header className="flex h-14 shrink-0 items-center justify-between pr-2 pl-5">
              <Wordmark />
              <PanelToggle
                ref={focusIfToggled}
                label="Collapse sidebar"
                Icon={PanelLeftClose}
                onClick={() => {
                  toggleList(false);
                }}
              />
            </header>
            <nav aria-label="Main" className="mx-4 mb-3 flex gap-1 rounded-full bg-muted p-1">
              {listTabs.map((t) => (
                <TabButton
                  key={t.id}
                  tab={t}
                  active={tab === t.id}
                  unread={unread}
                  onSelect={selectTab}
                  variant="segment"
                />
              ))}
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "online" ? online : chats}
            </div>
            <footer className="shrink-0 p-3">{account}</footer>
          </aside>
        ) : (
          <aside className={cn(PANEL_CARD, "flex flex-col items-center gap-2 py-1.5")}>
            <PanelToggle
              ref={focusIfToggled}
              label="Expand sidebar"
              Icon={PanelLeftOpen}
              onClick={() => {
                toggleList(true);
              }}
            />
            <nav aria-label="Main" className="flex flex-col gap-1">
              {listTabs.map((t) => (
                <TabButton
                  key={t.id}
                  tab={t}
                  active={tab === t.id}
                  unread={unread}
                  onSelect={(next) => {
                    selectTab(next);
                    setPanels({ list: true });
                  }}
                  variant="rail"
                />
              ))}
            </nav>
            <footer className="mt-auto pb-1.5">{accountRail}</footer>
          </aside>
        )}
        <main className={cn(PANEL_CARD, "flex flex-col")}>
          {chat ?? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-muted-foreground">
              <span className="bg-brand-wash flex size-20 items-center justify-center rounded-full">
                <MessageCircle className="size-8 text-primary" aria-hidden="true" />
              </span>
              {emptyChat}
              <AdSlot placement="chat-empty" />
            </div>
          )}
        </main>
        {showDetails && (
          <aside
            aria-label="Chat details"
            className={cn(
              PANEL_CARD,
              "relative flex flex-col animate-in duration-200 fade-in-0 slide-in-from-right-4 motion-reduce:animate-none",
            )}
          >
            <div
              aria-hidden="true"
              className="bg-brand-wash pointer-events-none absolute inset-x-0 top-0 h-44"
            />
            <header className="relative flex h-14 shrink-0 items-center px-5">
              <span className="text-sm font-semibold text-muted-foreground">Chat details</span>
            </header>
            <div className="relative flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pb-5">
              {details}
            </div>
          </aside>
        )}
      </div>
    </DetailsPaneContext>
  );
}

export function AppShell(props: AppShellProps) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  return desktop ? <DesktopShell {...props} /> : <MobileShell {...props} />;
}
