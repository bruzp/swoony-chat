import type { PublicUser } from "@shared/profile";
import { useAppStore } from "@/app/store";
import { LetterTile } from "@/components/LetterTile";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { longMeta } from "@/lib/userMeta";

export function PeerDetails({ peer, inDialog = false }: { peer: PublicUser; inDialog?: boolean }) {
  const Name = inDialog ? DialogTitle : "h2";
  const Meta = inDialog ? DialogDescription : "p";
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <LetterTile name={peer.nickname} gender={peer.gender} size="lg" />
      <div className="flex flex-col gap-1">
        <Name className="text-xl font-semibold break-words">{peer.nickname}</Name>
        <Meta className="text-sm text-muted-foreground">{longMeta(peer)}</Meta>
      </div>
      <div className="flex w-full flex-col gap-1.5 text-left">
        <span className="text-sm font-medium text-muted-foreground">Bio</span>
        <p className="text-sm break-words whitespace-pre-line">
          {peer.bio || <span className="text-muted-foreground">No bio yet.</span>}
        </p>
      </div>
    </div>
  );
}

export function PeerDetailsPane({ chatId }: { chatId: string }) {
  const peer = useAppStore((state) => state.chats[chatId]?.peer);
  if (!peer) return null;
  return <PeerDetails peer={peer} />;
}
