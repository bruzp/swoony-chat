import { cn } from "cn";
import type { ReactNode } from "react";

export function Panel({
  title,
  description,
  actions,
  children,
  headingLevel = 2,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className="flex flex-col gap-4 rounded-3xl border bg-card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Heading className={cn("font-bold", headingLevel === 1 ? "text-2xl" : "text-lg")}>
            {title}
          </Heading>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm break-words",
        tone === "error" &&
          "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
        tone === "info" && "bg-muted text-foreground",
      )}
    >
      {children}
    </p>
  );
}

export function TableBox({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border">
      <table className="w-full min-w-[720px] border-collapse text-sm tabular-nums">
        {children}
      </table>
    </div>
  );
}

export function Th({ children, end = false }: { children?: ReactNode; end?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "bg-muted px-3.5 py-3 text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase",
        end && "text-right",
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  mono = false,
  end = false,
}: {
  children?: ReactNode;
  mono?: boolean;
  end?: boolean;
}) {
  return (
    <td
      className={cn(
        "border-t px-3.5 py-3 align-top",
        mono && "font-mono text-xs break-all",
        end && "text-right whitespace-nowrap",
      )}
    >
      {children}
    </td>
  );
}

export const smallButton = "min-h-11 rounded-full px-3 text-xs font-semibold";
export const largeButton = "min-h-11 rounded-full px-5 font-semibold";
