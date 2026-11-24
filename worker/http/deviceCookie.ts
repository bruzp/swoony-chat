import { MIN_SECRET_LENGTH } from "../moderation/identityHash";
import { fromBase64Url, toBase64Url } from "../support/base64url";
import { importHmacKey } from "../support/hash";

export const DEVICE_COOKIE = "sw_dev";

const ONE_YEAR_SECONDS = 31_536_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

export class DeviceCookies {
  private readonly signingKey: Promise<CryptoKey>;
  private readonly verifyingKeys: Promise<CryptoKey>[];

  constructor(
    secrets: string[],
    private readonly secure: boolean,
  ) {
    const [current] = secrets;
    if (current === undefined) throw new Error("DeviceCookies needs at least one secret");
    if (secrets.some((secret) => secret.length < MIN_SECRET_LENGTH)) {
      throw new Error(`DeviceCookies secrets must be at least ${String(MIN_SECRET_LENGTH)} chars`);
    }
    this.signingKey = importHmacKey(current, ["sign"]);
    this.verifyingKeys = secrets.map((secret) => importHmacKey(secret, ["verify"]));
  }

  async read(request: Request): Promise<string | null> {
    const value = cookieValue(request, DEVICE_COOKIE);
    const parts = value?.split(".");
    if (parts?.length !== 2) return null;
    const [deviceId = "", encodedSignature = ""] = parts;
    const signature = fromBase64Url(encodedSignature);
    if (!UUID.test(deviceId) || !signature) return null;
    for (const key of this.verifyingKeys) {
      if (await crypto.subtle.verify("HMAC", await key, signature, encoder.encode(deviceId))) {
        return deviceId;
      }
    }
    return null;
  }

  async issue(
    deviceId: string = crypto.randomUUID(),
  ): Promise<{ deviceId: string; setCookie: string }> {
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.signingKey,
      encoder.encode(deviceId),
    );
    const attributes = [
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      `Max-Age=${String(ONE_YEAR_SECONDS)}`,
    ];
    if (this.secure) attributes.push("Secure");
    const setCookie = [
      `${DEVICE_COOKIE}=${deviceId}.${toBase64Url(signature)}`,
      ...attributes,
    ].join("; ");
    return { deviceId, setCookie };
  }
}
