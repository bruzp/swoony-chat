import { MIN_SECRET_LENGTH } from "../moderation/identityHash";

const BEARER_PREFIX = "Bearer ";
const KEY_BYTES = 32;
const encoder = new TextEncoder();

export class AdminAuth {
  private readonly key: Promise<CryptoKey>;
  private readonly expectedMac: Promise<ArrayBuffer>;

  constructor(token: string) {
    if (token.length < MIN_SECRET_LENGTH) {
      throw new Error(`ADMIN_TOKEN must be at least ${String(MIN_SECRET_LENGTH)} chars`);
    }
    this.key = crypto.subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(KEY_BYTES)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    this.expectedMac = this.key.then((key) =>
      crypto.subtle.sign("HMAC", key, encoder.encode(token)),
    );
  }

  async verify(authorization: string | null): Promise<boolean> {
    if (!authorization?.startsWith(BEARER_PREFIX)) return false;
    const provided = encoder.encode(authorization.slice(BEARER_PREFIX.length));
    return crypto.subtle.verify("HMAC", await this.key, await this.expectedMac, provided);
  }
}
