import { Mars, NonBinary, Venus } from "lucide-react";
import { useId } from "react";
import { countryName } from "@shared/countries";
import type { Gender, Profile } from "@shared/profile";
import { Flag } from "@/components/Flag";
import { cn } from "@/lib/cn";
import { GENDER_LABELS } from "@/lib/userMeta";

const ICON_CLASS = "size-3.5 shrink-0";
const ICON_STROKE = 2.75;
const RAINBOW = ["#ef4444", "#f97316", "#ca8a04", "#22c55e", "#3b82f6", "#8b5cf6"];

function RainbowNonBinary() {
  const gradientId = `rainbow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <NonBinary
      aria-hidden="true"
      strokeWidth={ICON_STROKE}
      stroke={`url(#${gradientId})`}
      className="-my-0.5 size-[1.05rem] shrink-0"
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="24"
          y2="24"
        >
          {RAINBOW.map((color, index) => (
            <stop key={color} offset={index / (RAINBOW.length - 1)} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
    </NonBinary>
  );
}

const SOLID_ICONS: Record<Exclude<Gender, "other">, { Icon: typeof Venus; color: string }> = {
  female: { Icon: Venus, color: "text-pink-600 dark:text-pink-400" },
  male: { Icon: Mars, color: "text-blue-600 dark:text-blue-400" },
};

function GenderIcon({ gender }: { gender: Gender }) {
  if (gender === "other") return <RainbowNonBinary />;
  const { Icon, color } = SOLID_ICONS[gender];
  return <Icon aria-hidden="true" strokeWidth={ICON_STROKE} className={cn(ICON_CLASS, color)} />;
}

export function ShortMeta({ user, className }: { user: Profile; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="sr-only">
        {`${GENDER_LABELS[user.gender]}, ${String(user.age)}, ${countryName(user.country)}`}
      </span>
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        <GenderIcon gender={user.gender} />
        {`${String(user.age)} · `}
        <Flag code={user.country} />
        {user.country}
      </span>
    </span>
  );
}
