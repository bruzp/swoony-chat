import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { PublicUser } from "@shared/profile";
import type { LobbyClientMessage } from "@shared/protocol/lobby";
import { LobbyContext } from "./lobbyContext";

export function lobbyUser(userId: string, over: Partial<PublicUser> = {}): PublicUser {
  return {
    userId,
    nickname: `n_${userId}`,
    gender: "female",
    age: 25,
    country: "PH",
    bio: "",
    ...over,
  };
}

export function renderWithLobby(ui: ReactElement) {
  const send = vi.fn((_message: LobbyClientMessage) => true);
  const view = render(ui, {
    wrapper: ({ children }) => <LobbyContext value={{ send }}>{children}</LobbyContext>,
  });
  return { ...view, send };
}

export function sentOfType<T extends LobbyClientMessage["type"]>(
  send: ReturnType<typeof renderWithLobby>["send"],
  type: T,
): Extract<LobbyClientMessage, { type: T }>[] {
  return send.mock.calls
    .map(([message]) => message)
    .filter(
      (message): message is Extract<LobbyClientMessage, { type: T }> => message.type === type,
    );
}
