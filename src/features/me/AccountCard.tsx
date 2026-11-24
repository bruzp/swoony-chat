import { ChevronsUpDown } from "lucide-react";
import { useAppStore } from "@/app/store";
import { LetterTile } from "@/components/LetterTile";
import { ShortMeta } from "@/components/ShortMeta";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { LeaveButton, MeSettings } from "./MePanel";

export function AccountCard({ compact = false }: { compact?: boolean }) {
  const me = useAppStore((state) => state.session.me);
  if (!me) return null;
  return (
    <div
      className={cn(
        "flex gap-1 rounded-2xl bg-muted/60 p-1.5",
        compact ? "flex-col items-center" : "items-center",
      )}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="My profile and settings"
            title={compact ? me.nickname : undefined}
            className={cn(
              "flex items-center rounded-xl text-left transition-colors outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/50",
              compact ? "size-11 justify-center" : "min-h-12 min-w-0 flex-1 gap-3 px-1.5",
            )}
          >
            <LetterTile name={me.nickname} gender={me.gender} size="sm" />
            {!compact && (
              <>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{me.nickname}</span>
                  <ShortMeta user={me} className="text-xs text-muted-foreground" />
                </span>
                <ChevronsUpDown
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side={compact ? "right" : "top"}
          align={compact ? "end" : "start"}
          aria-label="My profile and settings"
          className="flex w-80 flex-col gap-5 rounded-2xl p-4"
        >
          <MeSettings />
        </PopoverContent>
      </Popover>
      <LeaveButton compact />
    </div>
  );
}
