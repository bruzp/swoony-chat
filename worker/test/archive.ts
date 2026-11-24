import type { RetainedMessage } from "@shared/legal/records";
import type { ContentArchive } from "../retention/ContentArchive";

export async function archivedMessages(
  archive: ContentArchive,
  chatId: string,
): Promise<RetainedMessage[]> {
  const rows = await archive.rowsForChats(
    [chatId],
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  const bundles = await Promise.all(rows.map((row) => archive.open(row)));
  return bundles.flat().sort((a, b) => a.sentAt - b.sentAt);
}
