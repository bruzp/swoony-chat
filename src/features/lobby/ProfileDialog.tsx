import type { PublicUser } from "@shared/profile";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PeerDetails } from "@/features/chat/PeerDetails";

export function ProfileDialog({
  user,
  onClose,
  onChat,
}: {
  user: PublicUser | null;
  onClose: () => void;
  onChat: (user: PublicUser) => void;
}) {
  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="gap-5 p-6">
        {user && (
          <>
            <PeerDetails peer={user} inDialog />
            <button
              type="button"
              onClick={() => {
                onChat(user);
              }}
              className="bg-brand min-h-12 rounded-full px-6 font-semibold text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Chat
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
