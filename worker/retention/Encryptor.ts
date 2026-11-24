import { fromBase64Url, toBase64Url } from "../support/base64url";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function decodeKey(base64Key: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(base64Key), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("Encryptor key must be base64");
  }
}

export class Encryptor {
  private readonly key: Promise<CryptoKey>;

  constructor(base64Key: string) {
    const raw = decodeKey(base64Key);
    if (raw.length !== KEY_BYTES) {
      throw new Error(`Encryptor key must decode to ${String(KEY_BYTES)} bytes`);
    }
    this.key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async encrypt(value: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const plaintext = encoder.encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await this.key,
      plaintext,
    );
    return `${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
  }

  async decrypt<T>(payload: string): Promise<T> {
    const [encodedIv = "", encodedCiphertext = "", extra] = payload.split(".");
    const iv = fromBase64Url(encodedIv);
    const ciphertext = fromBase64Url(encodedCiphertext);
    if (extra !== undefined || iv?.length !== IV_BYTES || !ciphertext) {
      throw new Error("Malformed encrypted payload");
    }
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await this.key,
      ciphertext,
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  }

  async encryptBytes(plain: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.key, plain);
    const sealed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
    sealed.set(iv);
    sealed.set(new Uint8Array(ciphertext), IV_BYTES);
    return sealed;
  }

  async decryptBytes(sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    if (sealed.length <= IV_BYTES) throw new Error("Malformed encrypted payload");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.slice(0, IV_BYTES) },
      await this.key,
      sealed.slice(IV_BYTES),
    );
    return new Uint8Array(plaintext);
  }
}
