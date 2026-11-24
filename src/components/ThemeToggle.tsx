import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/cn";

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "Auto", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex rounded-full border border-border bg-surface p-1"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          onClick={() => {
            setChoice(value);
          }}
          className={cn(
            "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            choice === value && "bg-brand text-white",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
