import { importHmacKey, toHex } from "../support/hash";

export const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();

export class IdentityHasher {
  private readonly key: Promise<CryptoKey>;

  constructor(secret: string) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`IdentityHasher secret must be at least ${String(MIN_SECRET_LENGTH)} chars`);
    }
    this.key = importHmacKey(secret, ["sign"]);
  }

  async hash(value: string): Promise<string> {
    return toHex(await crypto.subtle.sign("HMAC", await this.key, encoder.encode(value)));
  }
}
