import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { AccessAuth, type AccessConfig } from "./accessAuth";

const TEAM = "https://swoony-test.cloudflareaccess.com";
const AUD = "test-aud-tag";
const OWNER = "owner@example.com";

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let privateKey: SigningKey;
let otherKey: SigningKey;
let jwks: { keys: JWK[] };

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] };
});

function auth(overrides: Partial<AccessConfig> = {}): AccessAuth {
  return new AccessAuth({
    teamDomain: TEAM,
    audience: AUD,
    emails: [OWNER],
    devEmail: null,
    keys: createLocalJWKSet(jwks),
    ...overrides,
  });
}

interface TokenOptions {
  aud?: string;
  iss?: string;
  email?: string;
  expiresIn?: string | number;
  key?: SigningKey;
}

function token(opts: TokenOptions = {}): Promise<string> {
  return new SignJWT({ email: opts.email ?? OWNER })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? TEAM)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "1h")
    .sign(opts.key ?? privateKey);
}

function request(jwt: string | null, url = "https://swoony.chat/s-admin"): Request {
  const headers: Record<string, string> = {};
  if (jwt !== null) headers["Cf-Access-Jwt-Assertion"] = jwt;
  return new Request(url, { headers });
}

describe("AccessAuth", () => {
  it("accepts a valid token and returns the signed-in email", async () => {
    expect(await auth().verify(request(await token()))).toBe(OWNER);
  });

  it("matches the allowed email without regard to case", async () => {
    const jwt = await token({ email: "Owner@Example.com" });
    expect(await auth().verify(request(jwt))).toBe(OWNER);
  });

  it.each([
    ["wrong audience", { aud: "other-app" }],
    ["wrong issuer", { iss: "https://evil.cloudflareaccess.com" }],
    ["expired", { expiresIn: Math.floor(Date.now() / 1000) - 60 }],
    ["unknown email", { email: "stranger@example.com" }],
  ])("refuses a token with %s", async (_label, opts: TokenOptions) => {
    expect(await auth().verify(request(await token(opts)))).toBeNull();
  });

  it("refuses a token signed by a key outside the team's key set", async () => {
    expect(await auth().verify(request(await token({ key: otherKey })))).toBeNull();
  });

  it("refuses a token that uses another algorithm", async () => {
    const hmac = await new SignJWT({ email: OWNER })
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-shared-secret-of-at-least-32-bytes!"));
    expect(await auth().verify(request(hmac))).toBeNull();
  });

  it("refuses a missing or garbage header", async () => {
    expect(await auth().verify(request(null))).toBeNull();
    expect(await auth().verify(request("not.a.jwt"))).toBeNull();
  });

  it("lets the dev email in only on localhost", async () => {
    const dev = auth({ devEmail: "dev@localhost" });
    expect(await dev.verify(request(null, "http://localhost:5173/s-admin"))).toBe("dev@localhost");
    expect(await dev.verify(request(null, "http://127.0.0.1:8787/s-admin"))).toBe("dev@localhost");
    expect(await dev.verify(request(null, "https://abc.trycloudflare.com/s-admin"))).toBeNull();
    expect(await dev.verify(request(null))).toBeNull();
  });

  it("refuses incomplete configuration", () => {
    expect(() => auth({ teamDomain: "" })).toThrow();
    expect(() => auth({ teamDomain: "http://swoony.cloudflareaccess.com" })).toThrow();
    expect(() => auth({ audience: "" })).toThrow();
    expect(() => auth({ emails: [] })).toThrow();
  });
});
