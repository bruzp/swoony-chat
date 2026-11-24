import { writeFile } from "node:fs/promises";
import { callAdmin, printJson, readOptions, runCli, toTimestamp } from "./client.ts";
import { connectionsCsv } from "../../shared/legal/csv.ts";
import type { ConnectionRecord } from "../../shared/legal/records.ts";

const USAGE =
  "Usage: node scripts/legal/lookup.ts (--nickname NAME | --user USER_ID) --from DATE --to DATE [--csv FILE]";

await runCli(async () => {
  const options = readOptions(
    {
      nickname: { type: "string" },
      user: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      csv: { type: "string" },
    },
    USAGE,
  );
  if (!options.from || !options.to) throw new Error(USAGE);
  const records = (await callAdmin("lookup", {
    ...(options.nickname ? { nickname: options.nickname } : {}),
    ...(options.user ? { userId: options.user } : {}),
    from: toTimestamp(options.from, "from"),
    to: toTimestamp(options.to, "to", { endOfDay: true }),
  })) as { connections: ConnectionRecord[] };
  if (options.csv) {
    await writeFile(options.csv, connectionsCsv(records.connections), { flag: "wx" });
    process.stderr.write(`Wrote ${String(records.connections.length)} rows to ${options.csv}\n`);
  }
  printJson(records);
});
