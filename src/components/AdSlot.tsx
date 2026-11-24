import { ADS_ENABLED } from "@shared/config";

export type AdPlacement = "list-inline" | "chat-empty";

const AD_SIZES: Record<AdPlacement, { width: number; height: number }> = {
  "list-inline": { width: 320, height: 50 },
  "chat-empty": { width: 300, height: 250 },
};

export function AdSlotBox({ placement }: { placement: AdPlacement }) {
  return (
    <div
      data-ad-placement={placement}
      style={AD_SIZES[placement]}
      className="mx-auto max-w-full shrink-0 overflow-hidden"
    />
  );
}

export function AdSlot({ placement }: { placement: AdPlacement }) {
  if (!ADS_ENABLED) return null;
  return <AdSlotBox placement={placement} />;
}
