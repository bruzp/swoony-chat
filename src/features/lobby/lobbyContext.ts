import { createContext, useContext } from "react";
import type { LobbyClientMessage } from "@shared/protocol/lobby";

export interface LobbyConnection {
  send: (message: LobbyClientMessage) => boolean;
}

export const LobbyContext = createContext<LobbyConnection | null>(null);

export function useLobby(): LobbyConnection {
  const connection = useContext(LobbyContext);
  if (!connection) throw new Error("useLobby must be used inside a LobbyContext");
  return connection;
}
