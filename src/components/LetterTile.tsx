import type { CSSProperties } from "react";
import type { Gender } from "@shared/profile";
import { cn } from "@/lib/cn";

const GENDER_HUES: Record<Gender, number> = { female: 330, male: 215, other: 270 };

const SIZE_CLASSES = {
  sm: "size-8 text-sm",
  md: "size-11 text-base",
  lg: "size-16 text-2xl",
} as const;

export function LetterTile({
  name,
  gender,
  size = "md",
  className,
}: {
  name: string;
  gender: Gender;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  const letter = Array.from(name)[0]?.toUpperCase() ?? "?";
  const style = { "--tile-hue": GENDER_HUES[gender] } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        "letter-tile inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {letter}
    </span>
  );
}
