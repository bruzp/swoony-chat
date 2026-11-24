import type { ActiveHold } from "@shared/protocol/admin";
import { LIMITS } from "@shared/config";
import { formatPht } from "@shared/legal/time";
import { useEffect, useState } from "react";
import { useAdmin, useAdminCall } from "../adminContext";
import { Notice, Panel, TableBox, Td, Th } from "../ui";

const TABLE_LABELS: Record<ActiveHold["table"], string> = {
  connections: "Connection records",
  chats: "Chat records",
  content: "Saved messages",
};

export function HoldsPage() {
  const { api } = useAdmin();
  const call = useAdminCall();
  const [holds, setHolds] = useState<ActiveHold[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call(() => api.holds()).then((result) => {
      if (result.ok) setHolds(result.value.holds);
      else setError(result.error);
    });
  }, [api, call]);

  return (
    <Panel
      title="Holds"
      headingLevel={1}
      description="Records kept past their normal deletion date. Holds can be extended from Case lookup but never released early."
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!holds && !error && <Notice>Loading…</Notice>}
      {holds?.length === 0 && <Notice>No active holds.</Notice>}
      {holds?.length === LIMITS.activeHoldsShown && (
        <Notice>
          {`Showing the first ${String(LIMITS.activeHoldsShown)} holds, latest end date first. Search a case in Case lookup to see its records.`}
        </Notice>
      )}
      {holds && holds.length > 0 && (
        <TableBox>
          <thead>
            <tr>
              <Th>Target</Th>
              <Th>Kind</Th>
              <Th>Records</Th>
              <Th>Held until</Th>
            </tr>
          </thead>
          <tbody>
            {holds.map((hold) => (
              <tr key={`${hold.table}-${hold.target}`}>
                <Td mono>{hold.target}</Td>
                <Td>
                  {TABLE_LABELS[hold.table]} ({hold.targetKind === "user" ? "user" : "chat"})
                </Td>
                <Td>{hold.records}</Td>
                <Td>{formatPht(hold.until)}</Td>
              </tr>
            ))}
          </tbody>
        </TableBox>
      )}
    </Panel>
  );
}
