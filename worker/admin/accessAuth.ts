import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const remoteKeySets = new Map<string, JWTVerifyGetKey>();

export interface AccessConfig {
  teamDomain: string;
  audience: string;
  emails: string[];
  devEmail: string | null;
  keys?: JWTVerifyGetKey;
}

function teamKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = remoteKeySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", teamDomain));
    remoteKeySets.set(teamDomain, keys);
  }
  return keys;
}

export function isLocalRequest(request: Request): boolean {
  return LOCAL_HOSTNAMES.has(new URL(request.url).hostname);
}

export class AccessAuth {
  private readonly teamDomain: string;
  private readonly audience: string;
  private readonly emails: Set<string>;
  private readonly devEmail: string | null;
  private readonly keys: JWTVerifyGetKey;

  constructor(config: AccessConfig) {
    if (!config.teamDomain.startsWith("https://")) {
      throw new Error("ACCESS_TEAM_DOMAIN must be an https:// URL");
    }
    if (!config.audience) throw new Error("ACCESS_AUD is required");
    if (config.emails.length === 0) throw new Error("ADMIN_EMAILS is required");
    this.teamDomain = config.teamDomain.replace(/\/+$/, "");
    this.audience = config.audience;
    this.emails = new Set(config.emails.map((email) => email.toLowerCase()));
    this.devEmail = config.devEmail;
    this.keys = config.keys ?? teamKeys(this.teamDomain);
  }

  async verify(request: Request): Promise<string | null> {
    if (this.devEmail && isLocalRequest(request)) return this.devEmail;
    const token = request.headers.get(ACCESS_JWT_HEADER);
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.teamDomain,
        audience: this.audience,
        algorithms: ["RS256"],
      });
      const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
      return email && this.emails.has(email) ? email : null;
    } catch {
      return null;
    }
  }
}
