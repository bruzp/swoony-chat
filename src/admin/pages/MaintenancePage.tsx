import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatPht } from "@shared/legal/time";
import { MAINTENANCE_MESSAGE_MAX, type MaintenanceState } from "@shared/protocol/admin";
import { useEffect, useId, useState } from "react";
import { ActionDialog, type PendingAction } from "../ActionDialog";
import { useAdmin, useAdminCall } from "../adminContext";
import { largeButton, Notice, Panel } from "../ui";

export function MaintenancePage() {
  const { api } = useAdmin();
  const call = useAdminCall();
  const messageId = useId();
  const [state, setState] = useState<MaintenanceState | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  useEffect(() => {
    void call(() => api.maintenance()).then((result) => {
      if (result.ok) setState(result.value);
      else setError(result.error);
    });
  }, [api, call]);

  function change(on: boolean) {
    setPending({
      title: on ? "Turn on maintenance mode?" : "Turn off maintenance mode?",
      target: on ? "Everyone online" : "Entry to Swoony",
      effect: on
        ? "Everyone is removed right away and all open chats end. New visitors see the maintenance screen."
        : "Entry opens again right away. Nobody is brought back; people enter again as new.",
      confirmLabel: on ? "Turn on" : "Turn off",
      run: async () => {
        const result = await call(() => api.setMaintenance(on, on ? message.trim() : ""));
        if (result.ok) {
          setState(result.value);
          setError(null);
        } else setError(result.error);
      },
    });
  }

  return (
    <Panel
      title="Maintenance mode"
      headingLevel={1}
      description="For risky database changes or emergencies. Normal updates do not need it: deploys switch over without downtime."
    >
      {error && <Notice tone="error">{error}</Notice>}
      {state?.on && (
        <Notice tone="error">
          On since {state.startedAt ? formatPht(state.startedAt) : "unknown"}
          {state.startedBy ? ` by ${state.startedBy}` : ""}. Visitors see the maintenance screen.
        </Notice>
      )}
      {state && !state.on && <Notice tone="success">Off. Swoony is open.</Notice>}
      {state && !state.on && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={messageId} className="text-sm font-semibold">
            Optional message for visitors
          </Label>
          <Textarea
            id={messageId}
            value={message}
            maxLength={MAINTENANCE_MESSAGE_MAX}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
          />
        </div>
      )}
      {state && (
        <Button
          variant={state.on ? "outline" : "destructive"}
          className={largeButton}
          onClick={() => {
            change(!state.on);
          }}
        >
          {state.on ? "Turn off maintenance mode" : "Turn on maintenance mode"}
        </Button>
      )}
      <ActionDialog
        action={pending}
        onClose={() => {
          setPending(null);
        }}
      />
    </Panel>
  );
}
