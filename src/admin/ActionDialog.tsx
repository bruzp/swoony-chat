import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface PendingAction {
  title: string;
  target: string;
  caseRef?: string;
  effect: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

interface ActionDialogProps {
  action: PendingAction | null;
  onClose: () => void;
}

export function ActionDialog({ action, onClose }: ActionDialogProps) {
  const [shown, setShown] = useState(action);
  const [running, setRunning] = useState(false);
  if (action !== null && action !== shown) setShown(action);

  async function confirm() {
    if (!shown || running) return;
    setRunning(true);
    try {
      await shown.run();
    } finally {
      setRunning(false);
      onClose();
    }
  }

  return (
    <AlertDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open && !running) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{shown?.title}</AlertDialogTitle>
          <AlertDialogDescription>{shown?.effect}</AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Target</dt>
          <dd className="font-mono break-all">{shown?.target}</dd>
          {shown?.caseRef && (
            <>
              <dt className="text-muted-foreground">Case reference</dt>
              <dd className="font-mono">{shown.caseRef}</dd>
            </>
          )}
        </dl>
        <AlertDialogFooter>
          <Button
            variant="outline"
            className="min-h-11 rounded-full"
            disabled={running}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="min-h-11 rounded-full"
            disabled={running}
            onClick={() => void confirm()}
          >
            {running ? "Working…" : shown?.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
