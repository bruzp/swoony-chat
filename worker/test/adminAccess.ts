import { env } from "cloudflare:workers";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { handleRequest } from "../app";
import { ACCESS_JWT_HEADER, AccessAuth } from "../admin/accessAuth";
import type { AppDeps } from "../deps";
import { deps, ORIGIN, uniqueIp } from "./helpers";

export const ADMIN_EMAIL = "owner@example.com";
const TEAM_DOMAIN = env.ACCESS_TEAM_DOMAIN;
const AUDIENCE = env.ACCESS_AUD;

const keyPair = await generateKeyPair("RS256", { extractable: true });
const jwks = { keys: [{ ...(await exportJWK(keyPair.publicKey)), kid: "test", alg: "RS256" }] };

export const adminDeps: AppDeps = {
  ...deps,
  access: new AccessAuth({
    teamDomain: TEAM_DOMAIN,
    audience: AUDIENCE,
    emails: [ADMIN_EMAIL],
    devEmail: null,
    keys: createLocalJWKSet(jwks),
  }),
};

export function adminToken(email = ADMIN_EMAIL): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(TEAM_DOMAIN)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keyPair.privateKey);
}

export const servedAssets: string[] = [];

export const fakeAssets = {
  fetch(input: Request | string): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input.url);
    servedAssets.push(url.pathname);
    if (url.pathname === "/s-admin/" || url.pathname === "/s-admin") {
      return Promise.resolve(new Response("<h1>admin</h1>", { status: 200 }));
    }
    return Promise.resolve(new Response("<h1>Page not found</h1>", { status: 404 }));
  },
} as unknown as Fetcher;

export const adminEnv: Env = { ...env, ASSETS: fakeAssets };

export interface WebAdminOptions {
  token?: string | null;
  ip?: string;
  origin?: string | null;
  method?: string;
  contentType?: string | null;
  appDeps?: AppDeps;
  rawBody?: string;
  country?: string;
  appEnv?: Env;
}

export async function webAdminCall(
  path: string,
  body: unknown = {},
  opts: WebAdminOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { "CF-Connecting-IP": opts.ip ?? uniqueIp() };
  const token = opts.token === undefined ? await adminToken() : opts.token;
  if (token !== null) headers[ACCESS_JWT_HEADER] = token;
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin !== null) headers.Origin = origin;
  const contentType = opts.contentType === undefined ? "application/json" : opts.contentType;
  if (contentType !== null) headers["Content-Type"] = contentType;
  const method = opts.method ?? "POST";
  return handleRequest(
    new Request(`${ORIGIN}/api/s-admin/${path}`, {
      method,
      headers,
      body: method === "GET" ? null : (opts.rawBody ?? JSON.stringify(body)),
      cf: { country: opts.country ?? "PH" },
    }),
    opts.appEnv ?? adminEnv,
    opts.appDeps ?? adminDeps,
  );
}

export async function adminPage(path: string, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { "CF-Connecting-IP": uniqueIp() };
  if (token !== null) headers[ACCESS_JWT_HEADER] = token;
  return handleRequest(new Request(`${ORIGIN}${path}`, { headers }), adminEnv, adminDeps);
}
