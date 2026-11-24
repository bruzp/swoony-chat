import { useAppStore } from "@/app/store";

export function LiveAnnouncer() {
  const announcement = useAppStore((state) => state.announcement);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement && <span key={announcement.id}>{announcement.text}</span>}
    </div>
  );
}
