import type { RetainedMessage } from "@shared/legal/records";
import type { Encryptor } from "./Encryptor";

const decoder = new TextDecoder();

async function transform(
  input: string | Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const output = new Blob([input]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

function isRetainedMessage(value: unknown): value is RetainedMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "from" in value &&
    typeof value.from === "string" &&
    "text" in value &&
    typeof value.text === "string" &&
    "sentAt" in value &&
    typeof value.sentAt === "number"
  );
}

export async function sealBundle(
  encryptor: Encryptor,
  messages: RetainedMessage[],
): Promise<Uint8Array<ArrayBuffer>> {
  const compressed = await transform(JSON.stringify(messages), new CompressionStream("gzip"));
  return encryptor.encryptBytes(compressed);
}

export async function openBundle(
  encryptor: Encryptor,
  sealed: Uint8Array<ArrayBuffer>,
): Promise<RetainedMessage[]> {
  const compressed = await encryptor.decryptBytes(sealed);
  const json = await transform(compressed, new DecompressionStream("gzip"));
  const parsed: unknown = JSON.parse(decoder.decode(json));
  if (!Array.isArray(parsed) || !parsed.every(isRetainedMessage)) {
    throw new Error("Malformed message bundle");
  }
  return parsed;
}
