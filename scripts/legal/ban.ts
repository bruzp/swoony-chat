import { callAdmin, printJson, readOptions, runCli } from "./client.ts";

const USAGE = "Usage: node scripts/legal/ban.ts --user USER_ID";

await runCli(async () => {
  const options = readOptions({ user: { type: "string" } }, USAGE);
  if (!options.user) throw new Error(USAGE);
  printJson(await callAdmin("ban", { userId: options.user }));
});
