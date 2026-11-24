import { handleRequest } from "./app";
import { depsFor } from "./deps";
import { runDailyCleanup } from "./health/cleanup";

export { ChatRoom } from "./chat/ChatRoom";
export { Lobby } from "./lobby/Lobby";

export default {
  fetch(request, env) {
    return handleRequest(request, env, depsFor(env));
  },
  async scheduled(_controller, env) {
    await runDailyCleanup(env, depsFor(env), Date.now());
  },
} satisfies ExportedHandler<Env>;
