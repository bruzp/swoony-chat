import type { ReactNode } from "react";

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;
const SAFE_URL = /^(https:\/\/|mailto:)/;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = String(index);
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    const link = LINK.exec(part);
    if (link) {
      const [, label = "", href = ""] = link;
      return SAFE_URL.test(href) ? (
        <a key={key} href={href} rel="noreferrer noopener" target="_blank" className="underline">
          {label}
        </a>
      ) : (
        <span key={key}>{label}</span>
      );
    }
    return part;
  });
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

interface Block {
  kind: "heading" | "paragraph" | "list" | "ordered" | "code" | "table";
  lines: string[];
  level?: number;
}

function blocks(source: string): Block[] {
  const result: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        code.push(lines[index] ?? "");
        index++;
      }
      index++;
      result.push({ kind: "code", lines: code });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      result.push({ kind: "heading", level: heading[1]?.length ?? 1, lines: [heading[2] ?? ""] });
      index++;
      continue;
    }
    if (!trimmed) {
      index++;
      continue;
    }
    const kind: Block["kind"] = trimmed.startsWith("|")
      ? "table"
      : /^[-*]\s/.test(trimmed)
        ? "list"
        : /^\d+\.\s/.test(trimmed)
          ? "ordered"
          : "paragraph";
    const group: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      const currentTrimmed = current.trim();
      if (!currentTrimmed || currentTrimmed.startsWith("```") || /^#{1,4}\s/.test(currentTrimmed))
        break;
      const startsItem = /^([-*]|\d+\.)\s/.test(currentTrimmed);
      if (kind === "paragraph" && (startsItem || currentTrimmed.startsWith("|"))) break;
      if ((kind === "list" || kind === "ordered") && startsItem) group.push(currentTrimmed);
      else if (kind === "list" || kind === "ordered") {
        group[group.length - 1] = `${group.at(-1) ?? ""} ${currentTrimmed}`;
      } else group.push(currentTrimmed);
      index++;
    }
    result.push({ kind, lines: group });
  }
  return result;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      const text = inline(block.lines[0] ?? "");
      if (block.level === 1)
        return (
          <h1 key={key} className="text-2xl font-bold">
            {text}
          </h1>
        );
      if (block.level === 2)
        return (
          <h2 key={key} className="mt-4 text-lg font-bold">
            {text}
          </h2>
        );
      return (
        <h3 key={key} className="mt-2 font-bold">
          {text}
        </h3>
      );
    }
    case "code":
      return (
        <pre key={key} className="overflow-x-auto rounded-xl bg-muted p-3 font-mono text-xs">
          {block.lines.join("\n")}
        </pre>
      );
    case "list":
      return (
        <ul key={key} className="ml-5 list-disc space-y-1">
          {block.lines.map((item, index) => (
            <li key={String(index)}>{inline(item.replace(/^[-*]\s+/, ""))}</li>
          ))}
        </ul>
      );
    case "ordered":
      return (
        <ol key={key} className="ml-5 list-decimal space-y-1">
          {block.lines.map((item, index) => (
            <li key={String(index)}>{inline(item.replace(/^\d+\.\s+/, ""))}</li>
          ))}
        </ol>
      );
    case "table": {
      const [header = "", , ...rows] = block.lines;
      return (
        <div key={key} className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr>
                {tableCells(header).map((cell, index) => (
                  <th key={String(index)} className="bg-muted px-3 py-2 text-left font-semibold">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={String(rowIndex)}>
                  {tableCells(row).map((cell, index) => (
                    <td key={String(index)} className="border-t px-3 py-2 align-top">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "paragraph":
      return <p key={key}>{inline(block.lines.join(" "))}</p>;
  }
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      {blocks(source).map(renderBlock)}
    </div>
  );
}
