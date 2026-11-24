import { callAdmin, printJson, readOptions, runCli } from "./client.ts";

const USAGE = "Usage: node scripts/legal/takedown.ts --chat CHAT_ID";

await runCli(async () => {
  const options = readOptions({ chat: { type: "string" } }, USAGE);
  if (!options.chat) throw new Error(USAGE);
  printJson(await callAdmin("takedown", { chatId: options.chat }));
});
