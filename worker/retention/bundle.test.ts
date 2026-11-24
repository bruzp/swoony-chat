import { describe, expect, it } from "vitest";
import type { RetainedMessage } from "@shared/legal/records";
import { Encryptor } from "./Encryptor";
import { openBundle, sealBundle } from "./bundle";

const base64Bytes = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const encryptor = new Encryptor(base64Bytes(new Uint8Array(32).map((_, i) => i)));

const phrases = [
  "hey how are you doing tonight",
  "haha same, just got home from work",
  "where are you from? i'm from cebu",
  "nice! i've always wanted to visit there someday",
  "what do you usually do on weekends",
  "mostly sleep and watch movies lol, you?",
];

const typicalMessages = (count: number): RetainedMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    from: i % 2 === 0 ? "user-a1b2c3" : "user-d4e5f6",
    text: `${phrases[i % phrases.length] ?? ""} ${String(i)}`,
    sentAt: 1_790_000_000_000 + i * 4_000,
  }));

describe("message bundles", () => {
  it("a sealed bundle opens to the same messages", async () => {
    const messages = typicalMessages(5);
    expect(await openBundle(encryptor, await sealBundle(encryptor, messages))).toEqual(messages);
  });

  it("a bundle of 100 typical messages is under 40% of its JSON size", async () => {
    const messages = typicalMessages(100);
    const sealed = await sealBundle(encryptor, messages);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(messages)).length;
    expect(sealed.length).toBeLessThan(jsonBytes * 0.4);
  });

  it("a changed byte makes the bundle fail to open", async () => {
    const sealed = await sealBundle(encryptor, typicalMessages(3));
    const tampered = sealed.slice();
    tampered[20] = (tampered[20] ?? 0) ^ 1;
    await expect(openBundle(encryptor, tampered)).rejects.toThrow();
  });

  it("another key cannot open the bundle", async () => {
    const sealed = await sealBundle(encryptor, typicalMessages(3));
    const other = new Encryptor(base64Bytes(new Uint8Array(32).fill(9)));
    await expect(openBundle(other, sealed)).rejects.toThrow();
  });

  it.each([
    ["not a list", { from: "a", text: "hi", sentAt: 1 }],
    ["a list of numbers", [1, 2]],
    ["a message without sentAt", [{ from: "a", text: "hi" }]],
  ])("a sealed payload that is %s fails to open", async (_label, payload) => {
    const gzipped = await new Response(
      new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    const sealed = await encryptor.encryptBytes(new Uint8Array(gzipped));
    await expect(openBundle(encryptor, sealed)).rejects.toThrow("Malformed message bundle");
  });
});
