import { Button } from "@/components/ui/button";
import { cn } from "cn";
import {
  Activity,
  BookOpen,
  HeartPulse,
  LockKeyhole,
  Search,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { adminApi as defaultApi, type AdminApi } from "./adminApi";
import { AdminContext, useAdmin, useAdminCall } from "./adminContext";
import { ActivityPage } from "./pages/ActivityPage";
import { CaseLookupPage } from "./pages/CaseLookupPage";
import { HealthPage } from "./pages/HealthPage";
import { HoldsPage } from "./pages/HoldsPage";
import { MaintenancePage } from "./pages/MaintenancePage";
import { RunbookPage } from "./pages/RunbookPage";

type PageId = "lookup" | "holds" | "activity" | "health" | "maintenance" | "runbook";

const PAGES: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: "lookup", label: "Case lookup", icon: Search },
  { id: "holds", label: "Holds", icon: LockKeyhole },
  { id: "activity", label: "Activity log", icon: Activity },
  { id: "health", label: "System health", icon: HeartPulse },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "runbook", label: "Runbook", icon: BookOpen },
];

function SignedInAs() {
  const { api } = useAdmin();
  const call = useAdminCall();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    void call(() => api.whoami()).then((result) => {
      if (result.ok) setEmail(result.value.email);
    });
  }, [api, call]);
  if (!email) return null;
  return (
    <div className="flex flex-col gap-1 border-t px-2 pt-4 text-xs text-muted-foreground">
      <span>Signed in as</span>
      <span className="text-sm font-semibold break-all text-foreground">{email}</span>
    </div>
  );
}

function SessionEnded() {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <span>Your session ended. Sign in again.</span>
      <Button
        className="min-h-11 rounded-full px-5"
        onClick={() => {
          window.location.reload();
        }}
      >
        Sign in again
      </Button>
    </div>
  );
}

function PageView({ page }: { page: PageId }): ReactNode {
  switch (page) {
    case "lookup":
      return null;
    case "holds":
      return <HoldsPage />;
    case "activity":
      return <ActivityPage />;
    case "health":
      return <HealthPage />;
    case "maintenance":
      return <MaintenancePage />;
    case "runbook":
      return <RunbookPage />;
  }
}

export function AdminApp({ api = defaultApi }: { api?: AdminApi }) {
  const [page, setPage] = useState<PageId>("lookup");
  const [sessionEnded, setSessionEnded] = useState(false);
  const endSession = useCallback(() => {
    setSessionEnded(true);
  }, []);
  const context = useMemo(() => ({ api, endSession }), [api, endSession]);

  return (
    <AdminContext.Provider value={context}>
      <div className="flex min-h-dvh flex-wrap gap-4 bg-[var(--canvas)] p-4">
        <nav
          aria-label="Admin"
          className="flex w-full flex-col gap-1 rounded-3xl border bg-card p-4 md:w-60 md:shrink-0"
        >
          <div className="flex items-baseline gap-2 px-2 pb-3">
            <span className="text-xl font-extrabold tracking-tight text-brand-to">swoony</span>
            <span className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Admin
            </span>
          </div>
          <div className="flex flex-wrap gap-1 md:flex-col">
            {PAGES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={page === id ? "page" : undefined}
                onClick={() => {
                  setPage(id);
                }}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-medium",
                  page === id
                    ? "bg-violet-100 font-semibold text-violet-900 dark:bg-violet-950 dark:text-violet-100"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </button>
            ))}
          </div>
          <div className="mt-auto pt-4">
            <SignedInAs />
          </div>
        </nav>
        <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
          {sessionEnded && <SessionEnded />}
          <div hidden={page !== "lookup"} className="contents">
            <CaseLookupPage />
          </div>
          {page !== "lookup" && <PageView page={page} />}
        </main>
      </div>
    </AdminContext.Provider>
  );
}
