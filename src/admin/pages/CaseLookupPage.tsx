import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LegalQuery, LegalRecords } from "@shared/legal/records";
import { messageCount } from "@shared/legal/records";
import { formatPht } from "@shared/legal/time";
import { LIMITS } from "@shared/config";
import { CASE_REF_PATTERN, type ExportFormat } from "@shared/protocol/admin";
import { cn } from "cn";
import { Download, FileText } from "lucide-react";
import { useId, useState, type SyntheticEvent } from "react";
import { ActionDialog, type PendingAction } from "../ActionDialog";
import type { ExportScope } from "../adminApi";
import { useAdmin, useAdminCall } from "../adminContext";
import { saveFile } from "../saveFile";
import { buildQuery, ONE_YEAR_MS, phtDateInput } from "../searchInput";
import { largeButton, Notice, Panel, smallButton, TableBox, Td, Th } from "../ui";

type Tab = "connections" | "chats" | "messages";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CASE_REF_HELP = "Enter a case reference: 3 to 40 letters, digits, - or /.";

function oneYearFromNow(): number {
  return Date.now() + ONE_YEAR_MS;
}

function heldText(target: string, { changed }: { changed: number }): string {
  return changed === 0
    ? `Nothing was held for ${target}: no records matched.`
    : `Held ${String(changed)} records for ${target} for 1 year.`;
}

interface Search {
  caseRef: string;
  query: LegalQuery;
  label: string;
}

type FoundRecords = LegalRecords & { truncated?: boolean };

interface ChatParts {
  chatId: string;
  format: ExportFormat;
  parts: number;
}

function ChatPartsPanel({
  chatParts,
  exporting,
  onPart,
}: {
  chatParts: ChatParts;
  exporting: boolean;
  onPart: (part: number) => void;
}) {
  const { chatId, format, parts } = chatParts;
  return (
    <div className="flex flex-col gap-2">
      <Notice>{`Chat ${chatId} is too long for one file, so it comes in ${String(parts)} parts. Download each part.`}</Notice>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: parts }, (_, index) => index + 1).map((part) => (
          <Button
            key={part}
            variant="outline"
            className={smallButton}
            disabled={exporting}
            onClick={() => {
              onPart(part);
            }}
          >
            {`${format.toUpperCase()} part ${String(part)} of ${String(parts)}`}
          </Button>
        ))}
      </div>
    </div>
  );
}

interface LookupAction extends Omit<PendingAction, "run"> {
  run: () => Promise<string>;
}

interface Feedback {
  tone: "error" | "success";
  text: string;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-describedby={describedBy}
        className="min-h-11 rounded-xl"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function SearchForm({ onSearch, busy }: { onSearch: (search: Search) => void; busy: boolean }) {
  const [who, setWho] = useState("");
  const [fromDate, setFromDate] = useState(() => phtDateInput(Date.now() - WEEK_MS));
  const [toDate, setToDate] = useState(() => phtDateInput(Date.now()));
  const [caseRef, setCaseRef] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const caseRefHintId = useId();

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const ref = caseRef.trim();
    if (!CASE_REF_PATTERN.test(ref)) {
      setProblem(CASE_REF_HELP);
      return;
    }
    const query = buildQuery(who, fromDate, toDate);
    if (!query) {
      setProblem("Pick a start date on or before the end date.");
      return;
    }
    const unfiltered = query.nickname === undefined && query.userId === undefined;
    if (unfiltered && query.to - query.from > LIMITS.adminUnfilteredLookupMaxMs) {
      setProblem("Without a nickname or user ID, pick one day (From and To the same).");
      return;
    }
    setProblem(null);
    onSearch({ caseRef: ref, query, label: who.trim() || "everyone" });
  }

  return (
    <Panel
      title="Case lookup"
      headingLevel={1}
      description="Times are Philippine time (PHT, UTC+8). Every search is written to the Activity log."
    >
      <form
        noValidate
        onSubmit={submit}
        className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] items-end gap-3"
      >
        <Field label="Nickname or user ID" value={who} onChange={setWho} />
        <Field label="From" type="date" value={fromDate} onChange={setFromDate} />
        <Field label="To" type="date" value={toDate} onChange={setToDate} />
        <Field
          label="Case reference"
          value={caseRef}
          onChange={setCaseRef}
          placeholder="e.g. NBI-2026-1142"
          describedBy={caseRefHintId}
        />
        <Button type="submit" disabled={busy} className={cn(largeButton, "bg-brand-to text-white")}>
          Search records
        </Button>
      </form>
      <p id={caseRefHintId} className="text-xs text-muted-foreground">
        The number on the notice. No number? Use your own, like SWOONY-2026-001.
      </p>
      {problem && <Notice tone="error">{problem}</Notice>}
    </Panel>
  );
}

function TabButton({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "min-h-11 rounded-full px-4 text-sm font-semibold",
        selected ? "bg-card shadow-sm" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Results({
  search,
  records,
  onAction,
  onExport,
  exporting,
}: {
  search: Search;
  records: FoundRecords;
  onAction: (action: LookupAction) => void;
  onExport: (format: ExportFormat, scope: ExportScope) => void;
  exporting: boolean;
}) {
  const [tab, setTab] = useState<Tab>("connections");
  const { api } = useAdmin();
  const caseRef = search.caseRef;

  const holdUser = (userId: string) => {
    onAction({
      title: "Hold this user's records for 1 year?",
      target: userId,
      caseRef,
      effect: "Their connection records, chats and saved messages will not be deleted for 1 year.",
      confirmLabel: "Hold for 1 year",
      run: async () => heldText(userId, await api.hold(caseRef, { userId }, oneYearFromNow())),
    });
  };
  const banUser = (userId: string) => {
    onAction({
      title: "Ban this user?",
      target: userId,
      caseRef,
      effect:
        "Their device is banned for 7 days, their network for 1 hour, and they are removed now.",
      confirmLabel: "Ban user",
      run: async () => {
        const result = await api.ban(caseRef, userId);
        const removed = result.kicked ? " They were online and have been removed." : "";
        return `Banned ${userId} until ${formatPht(result.deviceUntil)}.${removed}`;
      },
    });
  };
  const holdChat = (chatId: string) => {
    onAction({
      title: "Hold this chat's records for 1 year?",
      target: chatId,
      caseRef,
      effect: "The chat record and its saved messages will not be deleted for 1 year.",
      confirmLabel: "Hold for 1 year",
      run: async () => heldText(chatId, await api.hold(caseRef, { chatId }, oneYearFromNow())),
    });
  };
  const takeDown = (chatId: string) => {
    onAction({
      title: "Take down this chat?",
      target: chatId,
      caseRef,
      effect:
        "The chat ends now. Its live messages are saved as held evidence, then wiped from the chat. Its archived messages are held for 1 year.",
      confirmLabel: "Take down chat",
      run: async () => {
        const result = await api.takedown(caseRef, chatId);
        return `Took down ${chatId}. Evidence saved: ${String(result.evidenceSaved)} messages; records held: ${String(result.contentHeld)}.`;
      },
    });
  };

  const scope: ExportScope = { query: search.query };
  return (
    <Panel
      title={`Results for ${search.label}`}
      description={`${formatPht(search.query.from)} to ${formatPht(search.query.to)} · case ${caseRef}`}
      actions={
        <>
          <Button
            variant="outline"
            className={largeButton}
            disabled={exporting}
            onClick={() => {
              onExport("csv", scope);
            }}
          >
            <Download aria-hidden="true" />
            Download CSV
          </Button>
          <Button
            className={cn(largeButton, "bg-foreground text-background hover:bg-foreground/85")}
            disabled={exporting}
            onClick={() => {
              onExport("pdf", scope);
            }}
          >
            <FileText aria-hidden="true" />
            Export case file (PDF)
          </Button>
        </>
      }
    >
      {exporting && <Notice>Preparing file…</Notice>}
      {records.truncated && (
        <Notice tone="error">
          {`Showing the first ${LIMITS.exportMaxRows.toLocaleString("en-US")} records of each type. Narrow the dates or search one nickname to see everything; exports of this search are refused until then.`}
        </Notice>
      )}
      <div
        role="tablist"
        aria-label="Record type"
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-full bg-muted p-1"
      >
        <TabButton
          selected={tab === "connections"}
          onSelect={() => {
            setTab("connections");
          }}
        >{`Connections (${String(records.connections.length)})`}</TabButton>
        <TabButton
          selected={tab === "chats"}
          onSelect={() => {
            setTab("chats");
          }}
        >{`Chats (${String(records.chats.length)})`}</TabButton>
        <TabButton
          selected={tab === "messages"}
          onSelect={() => {
            setTab("messages");
          }}
        >{`Saved messages (${String(messageCount(records))})`}</TabButton>
      </div>

      {tab === "connections" && records.connections.length === 0 && (
        <Notice>No connections for this search.</Notice>
      )}
      {tab === "connections" && records.connections.length > 0 && (
        <TableBox>
          <thead>
            <tr>
              <Th>User ID</Th>
              <Th>Nickname</Th>
              <Th>IP address</Th>
              <Th>Country</Th>
              <Th>Joined</Th>
              <Th>Left</Th>
              <Th end>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {records.connections.map((row) => (
              <tr key={`${row.userId}-${String(row.joinedAt)}`}>
                <Td mono>{row.userId}</Td>
                <Td>{row.nickname}</Td>
                <Td mono>{row.ip}</Td>
                <Td>
                  {row.country}
                  {row.detectedCountry && row.detectedCountry !== row.country
                    ? ` (detected ${row.detectedCountry})`
                    : ""}
                </Td>
                <Td>{formatPht(row.joinedAt)}</Td>
                <Td>{row.leftAt === null ? "Still online" : formatPht(row.leftAt)}</Td>
                <Td end>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      className={smallButton}
                      aria-label={`Hold ${row.userId}`}
                      onClick={() => {
                        holdUser(row.userId);
                      }}
                    >
                      Hold 1 year
                    </Button>
                    <Button
                      variant="destructive"
                      className={smallButton}
                      aria-label={`Ban ${row.userId}`}
                      onClick={() => {
                        banUser(row.userId);
                      }}
                    >
                      Ban
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableBox>
      )}

      {tab === "chats" && records.chats.length === 0 && <Notice>No chats for this search.</Notice>}
      {tab === "chats" && records.chats.length > 0 && (
        <TableBox>
          <thead>
            <tr>
              <Th>Chat ID</Th>
              <Th>Between</Th>
              <Th>Started</Th>
              <Th>Ended</Th>
              <Th end>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {records.chats.map((chat) => (
              <tr key={chat.chatId}>
                <Td mono>{chat.chatId}</Td>
                <Td mono>
                  {chat.userA}
                  <br />
                  {chat.userB}
                </Td>
                <Td>{formatPht(chat.startedAt)}</Td>
                <Td>{chat.endedAt === null ? "Live now" : formatPht(chat.endedAt)}</Td>
                <Td end>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      className={smallButton}
                      aria-label={`Hold ${chat.chatId}`}
                      onClick={() => {
                        holdChat(chat.chatId);
                      }}
                    >
                      Hold 1 year
                    </Button>
                    <Button
                      variant="destructive"
                      className={smallButton}
                      aria-label={`Take down ${chat.chatId}`}
                      onClick={() => {
                        takeDown(chat.chatId);
                      }}
                    >
                      Take down
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableBox>
      )}

      {tab === "messages" && (
        <div className="flex flex-col gap-3">
          {records.content.length === 0 && <Notice>No saved messages for this search.</Notice>}
          {records.content.map((entry) => (
            <article
              key={`${entry.chatId}-${entry.kind}-${String(entry.createdAt)}`}
              className="flex flex-col gap-3 rounded-2xl border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="font-mono text-xs break-all">Chat {entry.chatId}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.kind.replace("_", " ")}
                    {entry.reason ? ` · reason ${entry.reason}` : ""} · saved{" "}
                    {formatPht(entry.createdAt)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  className={smallButton}
                  disabled={exporting}
                  aria-label={`PDF of chat ${entry.chatId}`}
                  onClick={() => {
                    onExport("pdf", { chatId: entry.chatId });
                  }}
                >
                  <Download aria-hidden="true" />
                  PDF
                </Button>
              </div>
              <ol className="flex flex-col gap-1.5 text-sm">
                {entry.messages.map((message, index) => (
                  <li
                    key={`${String(message.sentAt)}-${String(index)}`}
                    className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-xl bg-muted px-3 py-2 md:grid-cols-[150px_200px_minmax(0,1fr)]"
                  >
                    <span className="text-xs text-muted-foreground">
                      {formatPht(message.sentAt)}
                    </span>
                    <span className="font-mono text-xs break-all">{message.from}</span>
                    <span className="col-span-2 break-words whitespace-pre-wrap md:col-span-1">
                      {message.text}
                    </span>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function CaseLookupPage() {
  const { api } = useAdmin();
  const call = useAdminCall();
  const [search, setSearch] = useState<Search | null>(null);
  const [records, setRecords] = useState<FoundRecords | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [chatParts, setChatParts] = useState<ChatParts | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  async function runSearch(next: Search) {
    setBusy(true);
    setFeedback(null);
    const result = await call(() => api.lookup(next.caseRef, next.query));
    setBusy(false);
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    setSearch(next);
    setChatParts(null);
    setRecords(result.value);
  }

  async function runExport(caseRef: string, format: ExportFormat, scope: ExportScope) {
    if (exporting) return;
    setFeedback(null);
    setExporting(true);
    const result = await call(() => api.exportFile(caseRef, format, scope));
    setExporting(false);
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    saveFile(result.value);
    if ("chatId" in scope) {
      setChatParts(
        result.value.parts > 1 ? { chatId: scope.chatId, format, parts: result.value.parts } : null,
      );
    }
    setFeedback({
      tone: "success",
      text: `Downloaded ${result.value.fileName}. File fingerprint (SHA-256): ${result.value.sha256}`,
    });
  }

  function confirmAction(action: LookupAction) {
    setPending({
      ...action,
      run: async () => {
        const result = await call(action.run);
        if (!result.ok) {
          setFeedback({ tone: "error", text: result.error });
          return;
        }
        if (search) await runSearch(search);
        setFeedback({ tone: "success", text: result.value });
      },
    });
  }

  return (
    <>
      <SearchForm busy={busy} onSearch={(next) => void runSearch(next)} />
      {busy && <Notice>Searching…</Notice>}
      {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
      {search && chatParts && (
        <ChatPartsPanel
          chatParts={chatParts}
          exporting={exporting}
          onPart={(part) =>
            void runExport(search.caseRef, chatParts.format, { chatId: chatParts.chatId, part })
          }
        />
      )}
      {search && records && (
        <Results
          search={search}
          records={records}
          onAction={confirmAction}
          onExport={(format, scope) => void runExport(search.caseRef, format, scope)}
          exporting={exporting}
        />
      )}
      <ActionDialog
        action={pending}
        onClose={() => {
          setPending(null);
        }}
      />
    </>
  );
}
