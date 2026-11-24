import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { LiveAnnouncer } from "@/components/LiveAnnouncer";
import { Toaster } from "@/components/ui/sonner";
import { ChatScreen } from "@/features/chat/ChatScreen";
import { ChatsList } from "@/features/chat/ChatsList";
import { useBackToList } from "@/features/chat/useBackToList";
import { useChatConnection } from "@/features/chat/useChatConnection";
import { useUnreadTitle } from "@/features/chat/useUnreadTitle";
import { EntryScreen } from "@/features/entry/EntryScreen";
import { RulesDialog } from "@/features/entry/RulesDialog";
import { FilterBar } from "@/features/lobby/FilterBar";
import { LobbyContext } from "@/features/lobby/lobbyContext";
import { OnlineList } from "@/features/lobby/OnlineList";
import { useLobbyConnection } from "@/features/lobby/useLobbyConnection";
import { AccountCard } from "@/features/me/AccountCard";
import { MePanel } from "@/features/me/MePanel";
import { PeerDetailsPane } from "@/features/chat/PeerDetails";
import { ApiRequestError, fetchSession, MaintenanceError } from "@/lib/api";
import { formatLocalDateTime } from "@/lib/formatTime";
import { applyTheme, useTheme } from "@/lib/theme";
import { installViewportHeight } from "@/lib/viewport";
import { useShallow } from "zustand/react/shallow";
import { selectTotalUnread, useAppStore } from "./store";

type LoadError = "offline" | null;

const UNAVAILABLE_PAGE = "/unavailable/";

function useThemeOnDocument() {
  const { theme } = useTheme();
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return theme;
}

function useBootstrap(): { error: LoadError; retry: () => void } {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const maintenance = useAppStore((state) => state.maintenance);
  const [error, setError] = useState<LoadError>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchSession().then(
      (boot) => {
        if (!cancelled) bootstrap(boot);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof MaintenanceError) {
          maintenance(err.notice);
          return;
        }
        if (err instanceof ApiRequestError && err.code === "region_unavailable") {
          window.location.replace(UNAVAILABLE_PAGE);
          return;
        }
        setError("offline");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bootstrap, maintenance, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);
  return { error, retry };
}

function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <main className="h-app flex flex-col items-center justify-center gap-4 p-6 text-center pb-safe">
      <span className="text-brand text-4xl font-bold tracking-tight">swoony</span>
      {children}
    </main>
  );
}

function MaintenanceScreen({ message }: { message: string }) {
  const maintenance = useAppStore((state) => state.maintenance);
  useEffect(() => {
    let cancelled = false;
    fetchSession().catch((err: unknown) => {
      if (!cancelled && err instanceof MaintenanceError && err.notice) maintenance(err.notice);
    });
    return () => {
      cancelled = true;
    };
  }, [maintenance]);
  return (
    <CenteredScreen>
      <p className="text-muted-foreground">
        Swoony is down for a short update. Please come back soon.
      </p>
      {message && <p className="max-w-md break-words">{message}</p>}
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
        className="bg-brand min-h-11 rounded-full px-6 font-semibold text-white"
      >
        Try again
      </button>
    </CenteredScreen>
  );
}

function OnlinePanel() {
  return (
    <section aria-label="Online" className="flex h-full min-h-0 flex-col pt-2">
      <FilterBar />
      <OnlineList />
    </section>
  );
}

function ChatConnection({ chatId }: { chatId: string }) {
  useChatConnection(chatId);
  return null;
}

function ChatConnections() {
  const liveChatIds = useAppStore(
    useShallow((state) =>
      Object.entries(state.chats)
        .filter(([, chat]) => !chat.ended)
        .map(([chatId]) => chatId),
    ),
  );
  return liveChatIds.map((chatId) => <ChatConnection key={chatId} chatId={chatId} />);
}

function UnreadTitle() {
  useUnreadTitle(useAppStore(selectTotalUnread));
  return null;
}

function useChatNavigation(): string | null {
  const activeChatId = useAppStore((state) => state.activeChatId);
  const setActiveChat = useAppStore((state) => state.setActiveChat);
  const closeActiveChat = useCallback(() => {
    setActiveChat(null);
  }, [setActiveChat]);
  useBackToList(activeChatId, closeActiveChat);
  return activeChatId;
}

function LobbyScreen() {
  const connection = useLobbyConnection();
  const activeChatId = useChatNavigation();
  const rulesPending = useAppStore((state) => state.session.rulesPending);
  const rulesAgreed = useAppStore((state) => state.rulesAgreed);
  return (
    <LobbyContext value={connection}>
      <ChatConnections />
      <UnreadTitle />
      <AppShell
        online={<OnlinePanel />}
        chats={<ChatsList />}
        me={<MePanel />}
        account={<AccountCard />}
        accountRail={<AccountCard compact />}
        chat={activeChatId ? <ChatScreen key={activeChatId} chatId={activeChatId} /> : null}
        details={activeChatId ? <PeerDetailsPane chatId={activeChatId} /> : null}
        emptyChat="Pick someone from the list to start a chat."
      />
      <RulesDialog open={rulesPending} onAgree={rulesAgreed} />
    </LobbyContext>
  );
}

function Screen() {
  const session = useAppStore((state) => state.session);
  const entered = useAppStore((state) => state.entered);
  const { error, retry } = useBootstrap();

  if (error === "offline") {
    return (
      <CenteredScreen>
        <p className="text-muted-foreground">We couldn't reach Swoony. Check your connection.</p>
        <button
          type="button"
          onClick={retry}
          className="bg-brand min-h-11 rounded-full px-6 font-semibold text-white"
        >
          Try again
        </button>
      </CenteredScreen>
    );
  }

  switch (session.status) {
    case "loading":
      return (
        <CenteredScreen>
          <p className="text-muted-foreground">Loading…</p>
        </CenteredScreen>
      );
    case "entry":
      return <EntryScreen suggestedCountry={session.suggestedCountry} onEntered={entered} />;
    case "kicked":
      return (
        <CenteredScreen>
          <p className="text-muted-foreground">
            {session.kickReason === "idle"
              ? "You were signed out after 30 minutes without activity."
              : "You were removed for breaking the chat rules."}
          </p>
        </CenteredScreen>
      );
    case "banned":
      return (
        <CenteredScreen>
          <p className="text-muted-foreground">
            You can't chat right now
            {session.banUntil ? `. Try again after ${formatLocalDateTime(session.banUntil)}.` : "."}
          </p>
        </CenteredScreen>
      );
    case "maintenance":
      return <MaintenanceScreen message={session.maintenanceMessage} />;
    case "elsewhere":
      return (
        <CenteredScreen>
          <p className="text-muted-foreground">Swoony is open in another tab.</p>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            className="bg-brand min-h-11 rounded-full px-6 font-semibold text-white"
          >
            Use Swoony here
          </button>
        </CenteredScreen>
      );
    case "lobby":
      return <LobbyScreen />;
  }
}

export function App() {
  const theme = useThemeOnDocument();
  useEffect(() => installViewportHeight(), []);
  return (
    <>
      <Screen />
      <LiveAnnouncer />
      <Toaster position="top-center" theme={theme} />
    </>
  );
}
