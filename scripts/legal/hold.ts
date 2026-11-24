import { callAdmin, printJson, readOptions, runCli, toTimestamp } from "./client.ts";

const USAGE = "Usage: node scripts/legal/hold.ts (--user USER_ID | --chat CHAT_ID) --until DATE";

await runCli(async () => {
  const options = readOptions(
    { user: { type: "string" }, chat: { type: "string" }, until: { type: "string" } },
    USAGE,
  );
  if (!options.until || (!options.user && !options.chat)) throw new Error(USAGE);
  printJson(
    await callAdmin("hold", {
      ...(options.user ? { userId: options.user } : {}),
      ...(options.chat ? { chatId: options.chat } : {}),
      until: toTimestamp(options.until, "until", { endOfDay: true }),
    }),
  );
});
