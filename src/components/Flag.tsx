import { cn } from "@/lib/cn";

const flagUrls = import.meta.glob<string>("./*.svg", {
  base: "/node_modules/country-flag-icons/3x2/",
  query: "?url",
  import: "default",
  eager: true,
});

function flagUrl(code: string): string | undefined {
  return /^[A-Z]{2}$/.test(code) ? flagUrls[`./${code}.svg`] : undefined;
}

export function Flag({ code, className }: { code: string; className?: string }) {
  const src = flagUrl(code);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      width={16}
      height={11}
      className={cn(
        "inline-block h-[0.6875rem] w-4 shrink-0 rounded-[2px] object-cover",
        className,
      )}
    />
  );
}
