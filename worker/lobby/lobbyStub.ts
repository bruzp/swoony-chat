import type { Lobby } from "./Lobby";

const LOBBY_NAME = "global";

export function lobbyStub(env: Env): DurableObjectStub<Lobby> {
  return env.LOBBY.get(env.LOBBY.idFromName(LOBBY_NAME), { locationHint: "apac" });
}
