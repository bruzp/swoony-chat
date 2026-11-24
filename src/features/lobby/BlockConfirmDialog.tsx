import type { PublicUser } from "@shared/profile";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface BlockConfirmDialogProps {
  user: PublicUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function BlockConfirmDialog({
  user,
  open,
  onOpenChange,
  onConfirm,
}: BlockConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Block ${user.nickname}?`}
      description="You won't see each other for the rest of this visit, and any chat between you ends."
      confirmLabel="Block"
      onConfirm={onConfirm}
    />
  );
}
