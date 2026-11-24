import { Button } from "@/components/ui/button";
import { LIMITS } from "@shared/config";
import type { AuditChainStatus, AuditPage, AuditRow } from "@shared/protocol/admin";
import { formatPht } from "@shared/legal/time";
import { useCallback, useEffect, useState } from "react";
import { useAdmin, useAdminCall } from "../adminContext";
import { largeButton, Notice, Panel, TableBox, Td, Th } from "../ui";

const ACTION_LABELS: Record<string, string> = {
  lookup: "Search",
  ban: "Ban",
  takedown: "Take down",
  hold: "Hold",
  export: "Export",
  maintenance_on: "Maintenance on",
  maintenance_off: "Maintenance off",
  checkpoint: "Clean-up checkpoint",
};

function short(hash: string | null): string {
  return hash ? `${hash.slice(0, 10)}…` : "";
}

function details(row: AuditRow): string {
  const parts: string[] = [];
  if (row.targetKind && row.targetKind !== "window")
    parts.push(`${row.targetKind} ${short(row.targetHash)}`);
  if (row.resultCount !== null) parts.push(`${String(row.resultCount)} records`);
  if (row.exportSha256) parts.push(`file SHA-256 ${row.exportSha256}`);
  return parts.join(" · ");
}

function ChainStatus({ chain }: { chain: AuditChainStatus }) {
  if (chain.intact && !chain.complete) {
    return (
      <Notice>
        {`The first ${chain.checked.toLocaleString("en-US")} entries check out. Newer entries were not checked because the log is too long to check in one go.`}
      </Notice>
    );
  }
  if (chain.intact) {
    return (
      <Notice tone="success">
        Chain intact: all {chain.checked} entries check out. Nothing was edited or removed.
      </Notice>
    );
  }
  return (
    <Notice tone="error">
      Chain broken at entry {chain.brokenAt}: an entry was edited or removed. Keep a copy of this
      page and tell your lawyer.
    </Notice>
  );
}

export function ActivityPage() {
  const { api } = useAdmin();
  const call = useAdminCall();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [chain, setChain] = useState<AuditChainStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((page: AuditPage, append: boolean) => {
    if (page.chain) setChain(page.chain);
    setRows((current) => (append ? [...current, ...page.rows] : page.rows));
    setHasMore(page.rows.length === LIMITS.adminAuditPageSize);
  }, []);

  useEffect(() => {
    void call(() => api.audit()).then((result) => {
      setLoading(false);
      if (result.ok) apply(result.value, false);
      else setError(result.error);
    });
  }, [api, call, apply]);

  async function loadOlder() {
    if (loading) return;
    setLoading(true);
    const result = await call(() => api.audit(rows.at(-1)?.id));
    setLoading(false);
    if (result.ok) apply(result.value, true);
    else setError(result.error);
  }

  return (
    <Panel
      title="Activity log"
      headingLevel={1}
      description="Every search, download and action. Entries can't be edited or deleted. Kept 1 year. Sign-ins are in the Cloudflare Zero Trust dashboard."
    >
      {chain && <ChainStatus chain={chain} />}
      {error && <Notice tone="error">{error}</Notice>}
      {loading && rows.length === 0 && <Notice>Loading…</Notice>}
      {!loading && !error && rows.length === 0 && <Notice>No activity yet.</Notice>}
      {rows.length > 0 && (
        <TableBox>
          <thead>
            <tr>
              <Th>When (PHT)</Th>
              <Th>Event</Th>
              <Th>Details</Th>
              <Th>Case ref</Th>
              <Th>By</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td>{formatPht(row.at)}</Td>
                <Td>{ACTION_LABELS[row.action] ?? row.action}</Td>
                <Td mono>{details(row)}</Td>
                <Td mono>{row.caseRef ?? ""}</Td>
                <Td>
                  {row.actor}
                  {row.adminCountry ? ` (${row.adminCountry})` : ""}
                </Td>
                <Td>{row.result}</Td>
              </tr>
            ))}
          </tbody>
        </TableBox>
      )}
      {hasMore && (
        <Button
          variant="outline"
          className={largeButton}
          disabled={loading}
          onClick={() => void loadOlder()}
        >
          Show older entries
        </Button>
      )}
    </Panel>
  );
}
