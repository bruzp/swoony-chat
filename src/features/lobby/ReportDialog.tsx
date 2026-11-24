import { useId, useState } from "react";
import { REPORT_REASONS, type ReportReason } from "@shared/config";
import type { PublicUser } from "@shared/profile";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  harassment: "Harassment",
  underage: "Seems under 18",
  sexual: "Sexual content",
  other: "Something else",
};

interface ReportDialogProps {
  user: PublicUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: ReportReason) => void;
}

export function ReportDialog({ user, open, onOpenChange, onSubmit }: ReportDialogProps) {
  const id = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);

  function changeOpen(next: boolean) {
    if (!next) setReason(null);
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report {user.nickname}</DialogTitle>
          <DialogDescription>
            Reporting also blocks {user.nickname} and ends your chat. What went wrong?
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={reason ?? ""}
          onValueChange={(value) => {
            setReason(value as ReportReason);
          }}
          className="gap-1"
        >
          {REPORT_REASONS.map((option) => (
            <Label
              key={option}
              htmlFor={`${id}-${option}`}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 font-normal hover:bg-muted"
            >
              <RadioGroupItem id={`${id}-${option}`} value={option} />
              {REASON_LABELS[option]}
            </Label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11 rounded-full"
            onClick={() => {
              changeOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="min-h-11 rounded-full"
            disabled={reason === null}
            onClick={() => {
              if (reason === null) return;
              onSubmit(reason);
              changeOpen(false);
            }}
          >
            Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
