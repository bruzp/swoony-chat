import { sha256Hex } from "../support/hash";

export function chatIdFor(userA: string, userB: string): Promise<string> {
  return sha256Hex([userA, userB].sort().join(":"));
}
