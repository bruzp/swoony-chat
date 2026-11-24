import { LogOut } from "lucide-react";
import { useId, useState } from "react";
import { LIMITS } from "@shared/config";
import { useAppStore } from "@/app/store";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LetterTile } from "@/components/LetterTile";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Textarea } from "@/components/ui/textarea";
import { useLobby } from "@/features/lobby/lobbyContext";
import { bioError } from "@/lib/bioRules";
import { longMeta } from "@/lib/userMeta";

function BioEditor({ initial, onDone }: { initial: string; onDone: () => void }) {
  const id = useId();
  const { send } = useLobby();
  const [bio, setBio] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id}-error`;
  const counterId = `${id}-count`;

  function save() {
    const problem = bioError(bio);
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    if (send({ type: "setBio", bio: bio.trim() })) onDone();
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-bio`} className="text-sm font-medium text-muted-foreground">
        Bio
      </label>
      <Textarea
        id={`${id}-bio`}
        rows={3}
        maxLength={LIMITS.bioMax}
        className="rounded-xl px-3 text-base"
        value={bio}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : "", counterId].filter(Boolean).join(" ")}
        onChange={(event) => {
          setBio(event.target.value);
          setError(null);
        }}
      />
      <div className="flex justify-between gap-3">
        <p id={errorId} aria-live="polite" className="text-sm text-destructive empty:hidden">
          {error}
        </p>
        <span id={counterId} className="ml-auto text-xs text-muted-foreground">
          {bio.length}/{LIMITS.bioMax}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          className="bg-brand min-h-11 rounded-full px-5 text-sm font-semibold text-white"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 rounded-full border border-border px-5 text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function MeSettings() {
  const me = useAppStore((state) => state.session.me);
  const [editingBio, setEditingBio] = useState(false);
  return (
    <>
      {me &&
        (editingBio ? (
          <BioEditor
            initial={me.bio}
            onDone={() => {
              setEditingBio(false);
            }}
          />
        ) : (
          <div className="flex flex-col items-start gap-2">
            <span className="text-sm font-medium text-muted-foreground">Bio</span>
            <p className="text-sm break-words whitespace-pre-line">
              {me.bio || <span className="text-muted-foreground">No bio yet.</span>}
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingBio(true);
              }}
              className="min-h-11 rounded-full border border-border px-5 text-sm font-medium"
            >
              Edit bio
            </button>
          </div>
        ))}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-muted-foreground">Theme</span>
        <ThemeToggle />
      </div>
    </>
  );
}

export function LeaveButton({ compact = false }: { compact?: boolean }) {
  const { send } = useLobby();
  const [confirmLeave, setConfirmLeave] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={compact ? "Leave Swoony" : undefined}
        title={compact ? "Leave Swoony" : undefined}
        onClick={() => {
          setConfirmLeave(true);
        }}
        className={
          compact
            ? "flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50"
            : "min-h-11 self-start rounded-full border border-border px-5 text-sm font-medium"
        }
      >
        {compact ? <LogOut className="size-5" aria-hidden="true" /> : "Leave Swoony"}
      </button>
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave Swoony?"
        description="Your profile and all your chats end now. You can come back with a new nickname any time."
        confirmLabel="Leave"
        onConfirm={() => {
          send({ type: "leave" });
        }}
      />
    </>
  );
}

export function MePanel() {
  const me = useAppStore((state) => state.session.me);
  return (
    <section aria-label="Me" className="flex flex-col gap-5 p-4">
      {me && (
        <div className="flex items-center gap-3">
          <LetterTile name={me.nickname} gender={me.gender} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{me.nickname}</p>
            <p className="text-sm text-muted-foreground">{longMeta(me)}</p>
          </div>
        </div>
      )}
      <MeSettings />
      <LeaveButton />
    </section>
  );
}
